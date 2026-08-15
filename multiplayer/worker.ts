import { DurableObject } from "cloudflare:workers";

type Role = "host" | "guest";

type SocketAttachment = {
  role: Role;
  connectionId: string;
  joinedAt: number;
};

type PlayerInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
};

const ROOM_CODE = /^[A-Z2-9]{6}$/;
const MAX_MESSAGE_BYTES = 20_000;

function json(data: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (origin) headers.set("access-control-allow-origin", origin);
  return Response.json(data, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlayerInput(value: unknown): value is PlayerInput {
  if (!isRecord(value)) return false;
  return ["left", "right", "jump", "attack"].every(
    (key) => typeof value[key] === "boolean",
  );
}

function isFighterSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.id === 1 || value.id === 2) &&
    [
      "x",
      "y",
      "vx",
      "vy",
      "hp",
      "attack",
      "cooldown",
      "hurt",
      "coyote",
      "wins",
    ].every((key) => isFiniteNumber(value[key])) &&
    (value.facing === 1 || value.facing === -1) &&
    typeof value.hitDone === "boolean" &&
    typeof value.onGround === "boolean"
  );
}

function isGameSnapshot(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.fighters)) return false;
  return (
    value.fighters.length === 2 &&
    value.fighters.every(isFighterSnapshot) &&
    ["round", "roundEndTime", "introTime", "shake"].every((key) =>
      isFiniteNumber(value[key]),
    ) &&
    ["playing", "roundOver", "matchOver"].includes(String(value.state)) &&
    (value.winner === 1 || value.winner === 2 || value.winner === null) &&
    typeof value.paused === "boolean"
  );
}

function getAttachment(socket: WebSocket): SocketAttachment | null {
  const value = socket.deserializeAttachment();
  if (!isRecord(value)) return null;
  if (value.role !== "host" && value.role !== "guest") return null;
  if (typeof value.connectionId !== "string" || !isFiniteNumber(value.joinedAt)) {
    return null;
  }
  return {
    role: value.role,
    connectionId: value.connectionId,
    joinedAt: value.joinedAt,
  };
}

export class GameRoom extends DurableObject<Env> {
  private socketFor(role: Role): WebSocket | null {
    return this.ctx.getWebSockets(role).find((socket) => socket.readyState === 1) ?? null;
  }

  private send(role: Role, message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets(role)) {
      if (socket.readyState !== 1) continue;
      try {
        socket.send(payload);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "websocket send failed",
            role,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }

    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== "create" && mode !== "join") {
      return json({ error: "Mode must be create or join" }, 400);
    }

    const role: Role = mode === "create" ? "host" : "guest";
    const host = this.socketFor("host");
    const guest = this.socketFor("guest");

    if (role === "host" && (host || guest)) {
      return json({ error: "Room code is already in use" }, 409);
    }
    if (role === "guest" && !host) {
      return json({ error: "Room does not exist" }, 404);
    }
    if (role === "guest" && guest) {
      return json({ error: "Room is full" }, 409);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      role,
      connectionId: crypto.randomUUID(),
      joinedAt: Date.now(),
    };

    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [role]);
    server.send(JSON.stringify({ type: "welcome", role }));

    if (role === "guest") {
      this.send("host", { type: "ready" });
      this.send("guest", { type: "ready" });
    }

    console.log(
      JSON.stringify({
        message: "player connected",
        role,
        connectionId: attachment.connectionId,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): void {
    const attachment = getAttachment(socket);
    if (!attachment) {
      socket.close(1008, "Missing connection metadata");
      return;
    }
    if (typeof rawMessage !== "string") {
      socket.close(1003, "Text messages only");
      return;
    }
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Message too large");
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      socket.close(1007, "Invalid JSON");
      return;
    }
    if (!isRecord(message) || typeof message.type !== "string") {
      socket.close(1008, "Invalid message");
      return;
    }

    if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
      return;
    }

    if (
      attachment.role === "guest" &&
      message.type === "input" &&
      Number.isSafeInteger(message.seq) &&
      isPlayerInput(message.input)
    ) {
      this.send("host", {
        type: "input",
        seq: message.seq,
        input: message.input,
      });
      return;
    }

    if (
      attachment.role === "host" &&
      message.type === "snapshot" &&
      Number.isSafeInteger(message.tick) &&
      isGameSnapshot(message.game)
    ) {
      this.send("guest", {
        type: "snapshot",
        tick: message.tick,
        game: message.game,
      });
      return;
    }

    socket.close(1008, "Message not allowed for this role");
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    const attachment = getAttachment(socket);
    if (attachment) {
      const peerRole: Role = attachment.role === "host" ? "guest" : "host";
      this.send(peerRole, { type: "peer_left", role: attachment.role });
      console.log(
        JSON.stringify({
          message: "player disconnected",
          role: attachment.role,
          connectionId: attachment.connectionId,
          code,
          reason,
          wasClean,
        }),
      );
    }
  }

  webSocketError(socket: WebSocket, error: unknown): void {
    const attachment = getAttachment(socket);
    console.error(
      JSON.stringify({
        message: "websocket error",
        role: attachment?.role ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  return allowed.includes(origin) ? origin : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const origin = allowedOrigin(request, env);

      if (request.method === "GET" && url.pathname === "/") {
        return json(
          {
            service: "Bitwa pod Mostem multiplayer",
            status: "ok",
            transport: "websocket",
          },
          200,
          origin ?? undefined,
        );
      }

      if (!origin) {
        return json({ error: "Origin is not allowed" }, 403);
      }

      const match = /^\/room\/([A-Z2-9]{6})$/i.exec(url.pathname);
      if (request.method !== "GET" || !match) {
        return json({ error: "Not found" }, 404, origin);
      }

      const roomCode = match[1].toUpperCase();
      if (!ROOM_CODE.test(roomCode)) {
        return json({ error: "Invalid room code" }, 400, origin);
      }

      console.log(
        JSON.stringify({
          message: "room request",
          roomCode,
          mode: url.searchParams.get("mode"),
        }),
      );
      const room = env.GAME_ROOMS.getByName(roomCode);
      return await room.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "unhandled request error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

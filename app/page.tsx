"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WORLD_W = 1280;
const WORLD_H = 720;
const GROUND_Y = 584;
const ATTACK_TIME = 0.42;

type Fighter = {
  id: 1 | 2;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  attack: number;
  cooldown: number;
  hitDone: boolean;
  hurt: number;
  onGround: boolean;
  coyote: number;
  wins: number;
  color: string;
  dark: string;
  accent: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

type RoundState = "playing" | "roundOver" | "matchOver";

type Game = {
  fighters: [Fighter, Fighter];
  particles: Particle[];
  keys: Set<string>;
  state: RoundState;
  round: number;
  winner: 1 | 2 | null;
  roundEndTime: number;
  introTime: number;
  shake: number;
  paused: boolean;
  lastTime: number;
};

type NetworkRole = "host" | "guest";
type NetworkStatus =
  | "offline"
  | "menu"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

type PlayerInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
};

type FighterSnapshot = Pick<
  Fighter,
  | "id"
  | "x"
  | "y"
  | "vx"
  | "vy"
  | "facing"
  | "hp"
  | "attack"
  | "cooldown"
  | "hitDone"
  | "hurt"
  | "onGround"
  | "coyote"
  | "wins"
>;

type GameSnapshot = {
  fighters: [FighterSnapshot, FighterSnapshot];
  state: RoundState;
  round: number;
  winner: 1 | 2 | null;
  roundEndTime: number;
  introTime: number;
  shake: number;
  paused: boolean;
};

type NetworkRuntime = {
  socket: WebSocket | null;
  role: NetworkRole | null;
  roomCode: string;
  ready: boolean;
  manuallyClosed: boolean;
  localInput: PlayerInput;
  remoteInput: PlayerInput;
  appliedRemoteInput: PlayerInput;
  inputSequence: number;
  snapshotTick: number;
  lastSnapshotAt: number;
  targetSnapshot: GameSnapshot | null;
  heartbeatId: ReturnType<typeof setInterval> | null;
};

const MULTIPLAYER_ENDPOINT =
  "wss://ostrze-polnocy-multiplayer.maciek-m-stempniak.workers.dev";
const EMPTY_INPUT: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  attack: false,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayerInput(value: unknown): value is PlayerInput {
  return (
    isObjectRecord(value) &&
    typeof value.left === "boolean" &&
    typeof value.right === "boolean" &&
    typeof value.jump === "boolean" &&
    typeof value.attack === "boolean"
  );
}

function isSnapshotFighter(value: unknown): value is FighterSnapshot {
  if (!isObjectRecord(value)) return false;
  const numericFields = [
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
  ];
  return (
    (value.id === 1 || value.id === 2) &&
    numericFields.every(
      (field) => typeof value[field] === "number" && Number.isFinite(value[field]),
    ) &&
    (value.facing === 1 || value.facing === -1) &&
    typeof value.hitDone === "boolean" &&
    typeof value.onGround === "boolean"
  );
}

function isGameSnapshot(value: unknown): value is GameSnapshot {
  if (!isObjectRecord(value) || !Array.isArray(value.fighters)) return false;
  return (
    value.fighters.length === 2 &&
    value.fighters.every(isSnapshotFighter) &&
    ["round", "roundEndTime", "introTime", "shake"].every(
      (field) =>
        typeof value[field] === "number" && Number.isFinite(value[field]),
    ) &&
    ["playing", "roundOver", "matchOver"].includes(String(value.state)) &&
    (value.winner === 1 || value.winner === 2 || value.winner === null) &&
    typeof value.paused === "boolean"
  );
}

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

const platforms = [
  { x: 104, y: 442, w: 280, h: 22 },
  { x: 896, y: 442, w: 280, h: 22 },
  { x: 510, y: 332, w: 260, h: 22 },
];

function makeFighter(id: 1 | 2, wins = 0): Fighter {
  const isFirst = id === 1;
  return {
    id,
    name: isFirst ? "RUNA" : "BJØRN",
    x: isFirst ? 310 : 970,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: isFirst ? 1 : -1,
    hp: 100,
    attack: 0,
    cooldown: 0,
    hitDone: false,
    hurt: 0,
    onGround: true,
    coyote: 0.1,
    wins,
    color: isFirst ? "#f04f3d" : "#35a7a0",
    dark: isFirst ? "#6e201d" : "#145c5d",
    accent: isFirst ? "#ffc36c" : "#a8eee3",
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const actionsRef = useRef<{ resetMatch: () => void } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const networkRef = useRef<NetworkRuntime>({
    socket: null,
    role: null,
    roomCode: "",
    ready: false,
    manuallyClosed: false,
    localInput: { ...EMPTY_INPUT },
    remoteInput: { ...EMPTY_INPUT },
    appliedRemoteInput: { ...EMPTY_INPUT },
    inputSequence: 0,
    snapshotTick: 0,
    lastSnapshotAt: 0,
    targetSnapshot: null,
    heartbeatId: null,
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("offline");
  const [networkRole, setNetworkRole] = useState<NetworkRole | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [announcement, setAnnouncement] = useState(
    "Runda pierwsza. Walka rozpoczęta.",
  );

  const sendGuestInput = useCallback((key: string, pressed: boolean): boolean => {
    const network = networkRef.current;
    if (network.role !== "guest" || !network.socket || !network.ready) {
      return false;
    }

    const normalized = key.toLowerCase();
    const field =
      normalized === "a" || normalized === "arrowleft"
        ? "left"
        : normalized === "d" || normalized === "arrowright"
          ? "right"
          : normalized === "w" || normalized === "arrowup"
            ? "jump"
            : normalized === "f" || normalized === "l"
              ? "attack"
              : null;
    if (!field) return false;
    if (network.localInput[field] === pressed) return true;

    network.localInput[field] = pressed;
    network.inputSequence += 1;
    if (network.socket.readyState === WebSocket.OPEN) {
      network.socket.send(
        JSON.stringify({
          type: "input",
          seq: network.inputSequence,
          input: network.localInput,
        }),
      );
    }
    return true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const game: Game = {
      fighters: [makeFighter(1), makeFighter(2)],
      particles: [],
      keys: new Set(),
      state: "playing",
      round: 1,
      winner: null,
      roundEndTime: 0,
      introTime: 1.25,
      shake: 0,
      paused: false,
      lastTime: performance.now(),
    };
    gameRef.current = game;

    const ensureAudio = () => {
      if (!soundEnabledRef.current) return null;
      if (!audioRef.current) {
        audioRef.current = new AudioContext();
      }
      if (audioRef.current.state === "suspended") {
        void audioRef.current.resume();
      }
      return audioRef.current;
    };

    const sound = (
      frequency: number,
      duration: number,
      type: OscillatorType = "square",
      volume = 0.045,
    ) => {
      const audio = ensureAudio();
      if (!audio) return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(45, frequency * 0.55),
        audio.currentTime + duration,
      );
      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audio.currentTime + duration,
      );
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration);
    };

    const resetRound = () => {
      const [one, two] = game.fighters;
      game.fighters = [makeFighter(1, one.wins), makeFighter(2, two.wins)];
      game.particles = [];
      game.state = "playing";
      game.winner = null;
      game.round += 1;
      game.roundEndTime = 0;
      game.introTime = 1.15;
      setAnnouncement(`Runda ${game.round}. Walka rozpoczęta.`);
    };

    const resetMatch = () => {
      game.fighters = [makeFighter(1), makeFighter(2)];
      game.particles = [];
      game.state = "playing";
      game.round = 1;
      game.winner = null;
      game.roundEndTime = 0;
      game.introTime = 1.25;
      game.shake = 0;
      setAnnouncement("Nowy pojedynek. Runda pierwsza.");
    };
    actionsRef.current = { resetMatch };

    const continueGame = () => {
      if (game.state === "roundOver" && game.roundEndTime > 0.55) {
        resetRound();
      } else if (game.state === "matchOver" && game.roundEndTime > 0.55) {
        resetMatch();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const network = networkRef.current;
      if (
        ["a", "d", "w", "f", "arrowleft", "arrowright", "arrowup", "l", " ", "enter", "p"].includes(
          key,
        )
      ) {
        event.preventDefault();
      }
      if (event.repeat && ["w", "arrowup", "f", "l", "p"].includes(key)) {
        return;
      }
      if (network.role === "guest" && network.ready) {
        if (sendGuestInput(key, true)) {
          ensureAudio();
        }
        return;
      }
      if (
        network.role === "host" &&
        network.ready &&
        ["arrowleft", "arrowright", "arrowup", "l"].includes(key)
      ) {
        return;
      }
      if (key === "p") {
        game.paused = !game.paused;
        setPaused(game.paused);
        return;
      }
      if ((key === "enter" || key === " ") && game.state !== "playing") {
        continueGame();
        return;
      }
      game.keys.add(key);
      ensureAudio();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const network = networkRef.current;
      if (network.role === "guest" && network.ready) {
        sendGuestInput(key, false);
        return;
      }
      if (
        network.role === "host" &&
        network.ready &&
        ["arrowleft", "arrowright", "arrowup", "l"].includes(key)
      ) {
        return;
      }
      game.keys.delete(key);
    };

    const handleBlur = () => {
      game.keys.clear();
      const network = networkRef.current;
      if (network.role === "guest" && network.ready) {
        for (const key of ["a", "d", "w", "f"]) {
          sendGuestInput(key, false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    const spawnHitParticles = (x: number, y: number, color: string) => {
      for (let i = 0; i < 13; i += 1) {
        const angle = (Math.PI * 2 * i) / 13 + Math.random() * 0.45;
        const speed = 120 + Math.random() * 260;
        game.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 80,
          life: 0.38 + Math.random() * 0.28,
          size: 3 + Math.random() * 6,
          color,
        });
      }
    };

    const tryAttack = (fighter: Fighter, attackKey: string) => {
      if (
        game.keys.has(attackKey) &&
        fighter.cooldown <= 0 &&
        fighter.hurt <= 0 &&
        game.introTime < 0.8
      ) {
        fighter.attack = ATTACK_TIME;
        fighter.cooldown = 0.58;
        fighter.hitDone = false;
        game.keys.delete(attackKey);
        sound(215, 0.1, "sawtooth", 0.026);
      }
    };

    const updateFighter = (
      fighter: Fighter,
      opponent: Fighter,
      dt: number,
      leftKey: string,
      rightKey: string,
      jumpKey: string,
      attackKey: string,
    ) => {
      fighter.cooldown = Math.max(0, fighter.cooldown - dt);
      fighter.hurt = Math.max(0, fighter.hurt - dt);
      fighter.attack = Math.max(0, fighter.attack - dt);
      fighter.coyote = fighter.onGround
        ? 0.11
        : Math.max(0, fighter.coyote - dt);

      const canMove = fighter.hurt <= 0 && game.introTime < 0.8;
      const direction = canMove
        ? Number(game.keys.has(rightKey)) - Number(game.keys.has(leftKey))
        : 0;
      const acceleration = fighter.onGround ? 2500 : 1450;
      const maxSpeed = 335;

      if (direction !== 0) {
        fighter.vx += direction * acceleration * dt;
        fighter.vx = Math.max(-maxSpeed, Math.min(maxSpeed, fighter.vx));
        if (fighter.attack <= 0) fighter.facing = direction > 0 ? 1 : -1;
      } else if (fighter.onGround) {
        const drag = 2400 * dt;
        fighter.vx =
          Math.abs(fighter.vx) <= drag
            ? 0
            : fighter.vx - Math.sign(fighter.vx) * drag;
      }

      if (game.keys.has(jumpKey) && fighter.coyote > 0 && canMove) {
        fighter.vy = -690;
        fighter.onGround = false;
        fighter.coyote = 0;
        game.keys.delete(jumpKey);
        sound(145, 0.08, "triangle", 0.025);
      }

      tryAttack(fighter, attackKey);

      if (fighter.attack > 0 && !fighter.hitDone) {
        const phase = 1 - fighter.attack / ATTACK_TIME;
        if (phase > 0.3 && phase < 0.68) {
          const dx = opponent.x - fighter.x;
          const dy = opponent.y - fighter.y;
          const inFront = dx * fighter.facing > -10;
          const distance = Math.hypot(dx, dy * 0.8);
          if (inFront && distance < 148 && Math.abs(dy) < 112) {
            fighter.hitDone = true;
            opponent.hp = Math.max(0, opponent.hp - 18);
            opponent.vx = fighter.facing * (470 + (100 - opponent.hp) * 2.1);
            opponent.vy = -245 - (100 - opponent.hp) * 0.75;
            opponent.hurt = 0.28;
            game.shake = 13;
            spawnHitParticles(
              opponent.x - fighter.facing * 14,
              opponent.y - 72,
              fighter.accent,
            );
            sound(92, 0.16, "square", 0.07);

            if (opponent.hp <= 0) {
              fighter.wins += 1;
              game.winner = fighter.id;
              game.state = fighter.wins >= 3 ? "matchOver" : "roundOver";
              game.roundEndTime = 0;
              setAnnouncement(
                fighter.wins >= 3
                  ? `${fighter.name} wygrywa cały pojedynek.`
                  : `${fighter.name} wygrywa rundę ${game.round}.`,
              );
              sound(64, 0.48, "sawtooth", 0.075);
            }
          }
        }
      }

      const previousY = fighter.y;
      fighter.vy += 1770 * dt;
      fighter.x += fighter.vx * dt;
      fighter.y += fighter.vy * dt;
      fighter.x = Math.max(48, Math.min(WORLD_W - 48, fighter.x));
      fighter.onGround = false;

      if (fighter.y >= GROUND_Y) {
        fighter.y = GROUND_Y;
        fighter.vy = 0;
        fighter.onGround = true;
      } else if (fighter.vy >= 0) {
        for (const platform of platforms) {
          const crossedTop = previousY <= platform.y && fighter.y >= platform.y;
          const abovePlatform =
            fighter.x > platform.x - 28 && fighter.x < platform.x + platform.w + 28;
          if (crossedTop && abovePlatform) {
            fighter.y = platform.y;
            fighter.vy = 0;
            fighter.onGround = true;
            break;
          }
        }
      }
    };

    const applyRemoteInput = () => {
      const network = networkRef.current;
      const input = network.remoteInput;
      const previous = network.appliedRemoteInput;

      if (input.left) game.keys.add("arrowleft");
      else game.keys.delete("arrowleft");
      if (input.right) game.keys.add("arrowright");
      else game.keys.delete("arrowright");
      if (input.jump && !previous.jump) game.keys.add("arrowup");
      if (!input.jump) game.keys.delete("arrowup");
      if (input.attack && !previous.attack) game.keys.add("l");
      if (!input.attack) game.keys.delete("l");

      network.appliedRemoteInput = { ...input };
    };

    const applyTargetSnapshot = (dt: number) => {
      const snapshot = networkRef.current.targetSnapshot;
      if (!snapshot) return;
      const blend = 1 - Math.exp(-24 * dt);

      for (let index = 0; index < 2; index += 1) {
        const fighter = game.fighters[index];
        const next = snapshot.fighters[index];
        fighter.x += (next.x - fighter.x) * blend;
        fighter.y += (next.y - fighter.y) * blend;
        fighter.vx = next.vx;
        fighter.vy = next.vy;
        fighter.facing = next.facing;
        fighter.hp = next.hp;
        fighter.attack = next.attack;
        fighter.cooldown = next.cooldown;
        fighter.hitDone = next.hitDone;
        fighter.hurt = next.hurt;
        fighter.onGround = next.onGround;
        fighter.coyote = next.coyote;
        fighter.wins = next.wins;
      }

      game.state = snapshot.state;
      game.round = snapshot.round;
      game.winner = snapshot.winner;
      game.roundEndTime = snapshot.roundEndTime;
      game.introTime = snapshot.introTime;
      game.shake = snapshot.shake;
      if (game.paused !== snapshot.paused) {
        game.paused = snapshot.paused;
        setPaused(snapshot.paused);
      }
    };

    const createSnapshot = (): GameSnapshot => ({
      fighters: game.fighters.map((fighter) => ({
        id: fighter.id,
        x: fighter.x,
        y: fighter.y,
        vx: fighter.vx,
        vy: fighter.vy,
        facing: fighter.facing,
        hp: fighter.hp,
        attack: fighter.attack,
        cooldown: fighter.cooldown,
        hitDone: fighter.hitDone,
        hurt: fighter.hurt,
        onGround: fighter.onGround,
        coyote: fighter.coyote,
        wins: fighter.wins,
      })) as [FighterSnapshot, FighterSnapshot],
      state: game.state,
      round: game.round,
      winner: game.winner,
      roundEndTime: game.roundEndTime,
      introTime: game.introTime,
      shake: game.shake,
      paused: game.paused,
    });

    const update = (dt: number) => {
      const network = networkRef.current;
      if (network.role === "guest" && network.ready) {
        applyTargetSnapshot(dt);
        return;
      }
      if (network.role === "host" && network.ready) {
        applyRemoteInput();
      }
      if (game.paused) return;
      game.introTime = Math.max(0, game.introTime - dt);

      if (game.state === "playing") {
        const [one, two] = game.fighters;
        updateFighter(one, two, dt, "a", "d", "w", "f");
        updateFighter(two, one, dt, "arrowleft", "arrowright", "arrowup", "l");

        const dx = two.x - one.x;
        const dy = Math.abs(two.y - one.y);
        if (Math.abs(dx) < 64 && dy < 100) {
          const overlap = (64 - Math.abs(dx)) / 2;
          const sign = dx >= 0 ? 1 : -1;
          one.x -= overlap * sign;
          two.x += overlap * sign;
        }
      } else {
        game.roundEndTime += dt;
        for (const fighter of game.fighters) {
          fighter.vy += 1770 * dt;
          fighter.x += fighter.vx * dt;
          fighter.y = Math.min(GROUND_Y, fighter.y + fighter.vy * dt);
          fighter.vx *= Math.pow(0.04, dt);
        }
      }

      game.particles = game.particles.filter((particle) => {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 720 * dt;
        return particle.life > 0;
      });
      game.shake = Math.max(0, game.shake - 42 * dt);
    };

    const drawBackground = (time: number) => {
      const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
      sky.addColorStop(0, "#171320");
      sky.addColorStop(0.56, "#41303a");
      sky.addColorStop(1, "#c16b43");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      ctx.fillStyle = "rgba(255, 205, 119, 0.11)";
      ctx.beginPath();
      ctx.arc(1020, 118, 84, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f6c06c";
      ctx.beginPath();
      ctx.arc(1020, 118, 54, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#2b2530";
      ctx.beginPath();
      ctx.moveTo(0, 402);
      ctx.lineTo(148, 224);
      ctx.lineTo(260, 350);
      ctx.lineTo(394, 173);
      ctx.lineTo(562, 382);
      ctx.lineTo(735, 205);
      ctx.lineTo(920, 387);
      ctx.lineTo(1090, 235);
      ctx.lineTo(1280, 398);
      ctx.lineTo(1280, 620);
      ctx.lineTo(0, 620);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#19191f";
      ctx.beginPath();
      ctx.moveTo(0, 470);
      ctx.lineTo(205, 340);
      ctx.lineTo(392, 478);
      ctx.lineTo(614, 338);
      ctx.lineTo(812, 480);
      ctx.lineTo(1015, 350);
      ctx.lineTo(1280, 472);
      ctx.lineTo(1280, 620);
      ctx.lineTo(0, 620);
      ctx.closePath();
      ctx.fill();

      for (let i = 0; i < 14; i += 1) {
        const x = ((i * 173 + 41) % WORLD_W) + Math.sin(time * 0.0003 + i) * 7;
        const y = 185 + ((i * 79) % 270);
        ctx.fillStyle = `rgba(255, 203, 125, ${0.08 + (i % 3) * 0.035})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + (i % 2), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawPlatform = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = "#17171b";
      ctx.fillRect(x - 6, y + 5, w + 12, h + 18);
      ctx.fillStyle = "#685444";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#b58657";
      ctx.fillRect(x, y, w, 5);
      ctx.strokeStyle = "rgba(27, 21, 21, 0.5)";
      ctx.lineWidth = 3;
      for (let i = x + 34; i < x + w; i += 52) {
        ctx.beginPath();
        ctx.moveTo(i, y + 4);
        ctx.lineTo(i - 8, y + h);
        ctx.stroke();
      }
    };

    const drawArena = () => {
      for (const platform of platforms) {
        drawPlatform(platform.x, platform.y, platform.w, platform.h);
      }

      ctx.fillStyle = "#111318";
      ctx.fillRect(0, GROUND_Y, WORLD_W, WORLD_H - GROUND_Y);
      ctx.fillStyle = "#77583e";
      ctx.fillRect(0, GROUND_Y, WORLD_W, 20);
      ctx.fillStyle = "#c18a4d";
      ctx.fillRect(0, GROUND_Y, WORLD_W, 5);

      ctx.strokeStyle = "#32251f";
      ctx.lineWidth = 5;
      for (let x = -20; x < WORLD_W; x += 72) {
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y + 4);
        ctx.lineTo(x + 38, GROUND_Y + 20);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(246, 190, 103, 0.16)";
      for (let i = 0; i < 7; i += 1) {
        ctx.fillRect(80 + i * 188, 650 + (i % 2) * 13, 78, 3);
      }
    };

    const drawAxe = (fighter: Fighter) => {
      const phase = fighter.attack > 0 ? 1 - fighter.attack / ATTACK_TIME : 0;
      const angle =
        fighter.attack > 0
          ? -1.92 + Math.sin(Math.min(1, phase) * Math.PI * 0.94) * 2.6
          : -0.42;

      ctx.save();
      ctx.translate(18, -72);
      ctx.rotate(angle);
      ctx.strokeStyle = "#6d492f";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(91, 0);
      ctx.stroke();
      ctx.strokeStyle = "#b88452";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, -2);
      ctx.lineTo(86, -2);
      ctx.stroke();

      ctx.translate(84, 0);
      ctx.fillStyle = "#d6d2c6";
      ctx.strokeStyle = "#24262b";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-7, -25);
      ctx.quadraticCurveTo(22, -36, 38, -21);
      ctx.lineTo(27, 0);
      ctx.lineTo(38, 21);
      ctx.quadraticCurveTo(20, 35, -7, 24);
      ctx.lineTo(1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const drawFighter = (fighter: Fighter, time: number) => {
      const moving = Math.abs(fighter.vx) > 35 && fighter.onGround;
      const stride = moving ? Math.sin(time * 0.018) * 13 : 0;
      const bob = moving ? Math.abs(Math.sin(time * 0.018)) * 4 : 0;
      const defeated = fighter.hp <= 0;

      ctx.save();
      ctx.globalAlpha = defeated ? 0.72 : 1;
      ctx.fillStyle = "rgba(0,0,0,0.33)";
      ctx.beginPath();
      ctx.ellipse(fighter.x, fighter.y + 4, defeated ? 72 : 43, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(fighter.x, fighter.y - bob);
      ctx.scale(fighter.facing, 1);
      if (defeated) {
        ctx.rotate(-fighter.facing * 1.2);
        ctx.translate(-28, -28);
      }

      ctx.strokeStyle = "#202027";
      ctx.lineWidth = 15;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-15, -45);
      ctx.lineTo(-17 + stride, -4);
      ctx.moveTo(16, -45);
      ctx.lineTo(18 - stride, -4);
      ctx.stroke();
      ctx.strokeStyle = fighter.dark;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-17 + stride, -4);
      ctx.lineTo(-31 + stride, 0);
      ctx.moveTo(18 - stride, -4);
      ctx.lineTo(33 - stride, 0);
      ctx.stroke();

      ctx.fillStyle = fighter.dark;
      roundedRect(ctx, -38, -104, 76, 70, 20);
      ctx.fill();
      ctx.strokeStyle = "#201b20";
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = fighter.color;
      roundedRect(ctx, -31, -99, 62, 52, 15);
      ctx.fill();
      ctx.fillStyle = fighter.accent;
      ctx.fillRect(-34, -72, 68, 10);

      ctx.strokeStyle = "#d59a6b";
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(-27, -89);
      ctx.lineTo(-47, -63);
      ctx.moveTo(27, -87);
      ctx.lineTo(17, -70);
      ctx.stroke();

      ctx.fillStyle = fighter.hurt > 0 ? "#fff1df" : "#d9a06f";
      ctx.beginPath();
      ctx.arc(0, -129, 29, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#201b20";
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = fighter.dark;
      ctx.beginPath();
      ctx.arc(0, -139, 31, Math.PI, Math.PI * 2);
      ctx.lineTo(30, -125);
      ctx.lineTo(-30, -125);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fighter.accent;
      ctx.fillRect(-34, -137, 68, 8);

      ctx.fillStyle = "#201b20";
      ctx.beginPath();
      ctx.moveTo(-17, -120);
      ctx.lineTo(-4, -113);
      ctx.lineTo(-20, -111);
      ctx.closePath();
      ctx.moveTo(17, -120);
      ctx.lineTo(4, -113);
      ctx.lineTo(20, -111);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fighter.dark;
      ctx.beginPath();
      ctx.moveTo(-17, -108);
      ctx.quadraticCurveTo(0, -91, 17, -108);
      ctx.lineTo(10, -87);
      ctx.lineTo(-9, -87);
      ctx.closePath();
      ctx.fill();

      drawAxe(fighter);
      ctx.restore();
    };

    const drawHealthBar = (fighter: Fighter, left: boolean) => {
      const x = left ? 54 : 806;
      const w = 420;
      const y = 46;
      ctx.save();
      ctx.textAlign = left ? "left" : "right";
      ctx.fillStyle = "#fff3d1";
      ctx.font = "900 24px Arial Black, Arial";
      ctx.fillText(fighter.name, left ? x : x + w, 34);

      ctx.fillStyle = "rgba(15, 15, 19, 0.84)";
      roundedRect(ctx, x, y, w, 31, 8);
      ctx.fill();
      const healthWidth = Math.max(0, (w - 10) * (fighter.hp / 100));
      const fillX = left ? x + 5 : x + w - 5 - healthWidth;
      const gradient = ctx.createLinearGradient(x, 0, x + w, 0);
      gradient.addColorStop(0, fighter.dark);
      gradient.addColorStop(1, fighter.color);
      ctx.fillStyle = gradient;
      roundedRect(ctx, fillX, y + 5, healthWidth, 21, 5);
      ctx.fill();
      ctx.strokeStyle = "#d7ab68";
      ctx.lineWidth = 3;
      roundedRect(ctx, x, y, w, 31, 8);
      ctx.stroke();

      for (let i = 0; i < 3; i += 1) {
        const dotX = left ? x + i * 27 : x + w - i * 27;
        ctx.fillStyle = i < fighter.wins ? fighter.accent : "rgba(255,255,255,0.16)";
        ctx.beginPath();
        ctx.arc(dotX + (left ? 8 : -8), 96, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawOverlay = () => {
      if (game.introTime > 0 && game.state === "playing") {
        const alpha = Math.min(1, game.introTime * 2.5);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff2cf";
        ctx.font = "900 31px Arial Black, Arial";
        ctx.fillText(`RUNDA ${game.round}`, WORLD_W / 2, 138);
        ctx.fillStyle = "#f6b95d";
        ctx.font = "900 68px Arial Black, Arial";
        ctx.fillText("WALKA!", WORLD_W / 2, 205);
        ctx.restore();
      }

      if (game.state !== "playing") {
        const winner = game.fighters[game.winner === 1 ? 0 : 1];
        ctx.fillStyle = "rgba(10, 10, 14, 0.66)";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.textAlign = "center";
        ctx.fillStyle = winner.accent;
        ctx.font = "900 31px Arial Black, Arial";
        ctx.fillText(
          game.state === "matchOver" ? "ZWYCIĘZCA POJEDYNKU" : `RUNDA ${game.round} DLA`,
          WORLD_W / 2,
          270,
        );
        ctx.fillStyle = "#fff5dc";
        ctx.font = "900 78px Arial Black, Arial";
        ctx.fillText(winner.name, WORLD_W / 2, 356);
        if (game.roundEndTime > 0.55) {
          ctx.fillStyle = "rgba(255,255,255,0.76)";
          ctx.font = "700 22px Arial, sans-serif";
          ctx.fillText(
            game.state === "matchOver"
              ? "ENTER / DOTKNIJ ARENY — NOWY POJEDYNEK"
              : "ENTER / DOTKNIJ ARENY — NASTĘPNA RUNDA",
            WORLD_W / 2,
            410,
          );
        }
      }

      if (game.paused) {
        ctx.fillStyle = "rgba(10, 10, 14, 0.72)";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff3d1";
        ctx.font = "900 64px Arial Black, Arial";
        ctx.fillText("PAUZA", WORLD_W / 2, 336);
        ctx.font = "700 22px Arial, sans-serif";
        ctx.fillText("Naciśnij P, aby wrócić do walki", WORLD_W / 2, 382);
      }
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, WORLD_W, WORLD_H);
      ctx.save();
      if (game.shake > 0) {
        ctx.translate(
          (Math.random() - 0.5) * game.shake,
          (Math.random() - 0.5) * game.shake,
        );
      }
      drawBackground(time);
      drawArena();

      for (const fighter of game.fighters) {
        drawFighter(fighter, time);
      }
      for (const particle of game.particles) {
        ctx.globalAlpha = Math.min(1, particle.life * 3);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawHealthBar(game.fighters[0], true);
      drawHealthBar(game.fighters[1], false);
      drawOverlay();
      ctx.restore();
    };

    let animationFrame = 0;
    const loop = (time: number) => {
      const dt = Math.min(0.028, (time - game.lastTime) / 1000 || 0);
      game.lastTime = time;
      update(dt);
      const network = networkRef.current;
      if (
        network.role === "host" &&
        network.ready &&
        network.socket?.readyState === WebSocket.OPEN &&
        time - network.lastSnapshotAt >= 50
      ) {
        network.lastSnapshotAt = time;
        network.snapshotTick += 1;
        network.socket.send(
          JSON.stringify({
            type: "snapshot",
            tick: network.snapshotTick,
            game: createSnapshot(),
          }),
        );
      }
      draw(time);
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);

    const handleCanvasPointer = () => {
      ensureAudio();
      continueGame();
    };
    canvas.addEventListener("pointerdown", handleCanvasPointer);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      canvas.removeEventListener("pointerdown", handleCanvasPointer);
      actionsRef.current = null;
    };
  }, [sendGuestInput]);

  const closeNetworkSocket = () => {
    const network = networkRef.current;
    network.manuallyClosed = true;
    network.ready = false;
    if (network.heartbeatId) clearInterval(network.heartbeatId);
    network.heartbeatId = null;
    if (network.socket && network.socket.readyState < WebSocket.CLOSING) {
      network.socket.close(1000, "Player left the room");
    }
    network.socket = null;
    network.role = null;
    network.roomCode = "";
    network.localInput = { ...EMPTY_INPUT };
    network.remoteInput = { ...EMPTY_INPUT };
    network.appliedRemoteInput = { ...EMPTY_INPUT };
    network.targetSnapshot = null;
    gameRef.current?.keys.clear();
  };

  const leaveOnline = () => {
    closeNetworkSocket();
    setNetworkStatus("offline");
    setNetworkRole(null);
    setRoomCode("");
    setJoinCode("");
    setNetworkError("");
    setPaused(false);
    actionsRef.current?.resetMatch();
    setAnnouncement("Tryb lokalny. Nowy pojedynek.");
  };

  const connectOnline = (role: NetworkRole, requestedCode: string) => {
    const code = requestedCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      setNetworkError("Kod musi mieć 6 znaków (bez 0, 1, I oraz O).");
      setNetworkStatus("menu");
      return;
    }

    closeNetworkSocket();
    const socket = new WebSocket(
      `${MULTIPLAYER_ENDPOINT}/room/${code}?mode=${role === "host" ? "create" : "join"}`,
    );
    const network = networkRef.current;
    network.socket = socket;
    network.role = role;
    network.roomCode = code;
    network.ready = false;
    network.manuallyClosed = false;
    network.inputSequence = 0;
    network.snapshotTick = 0;
    network.lastSnapshotAt = 0;
    network.targetSnapshot = null;

    setRoomCode(code);
    setNetworkRole(role);
    setNetworkError("");
    setNetworkStatus("connecting");
    setAnnouncement("Łączenie z pokojem online.");

    socket.addEventListener("open", () => {
      if (networkRef.current.socket !== socket) return;
      network.heartbeatId = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25_000);
      if (role === "host") {
        setNetworkStatus("waiting");
        setAnnouncement(`Pokój ${code} utworzony. Oczekiwanie na przeciwnika.`);
      }
    });

    socket.addEventListener("message", (event) => {
      if (networkRef.current.socket !== socket || typeof event.data !== "string") {
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isObjectRecord(message) || typeof message.type !== "string") return;

      if (message.type === "ready") {
        network.ready = true;
        network.localInput = { ...EMPTY_INPUT };
        network.remoteInput = { ...EMPTY_INPUT };
        network.appliedRemoteInput = { ...EMPTY_INPUT };
        gameRef.current?.keys.clear();
        actionsRef.current?.resetMatch();
        setPaused(false);
        setNetworkStatus("connected");
        setAnnouncement(
          role === "host"
            ? "Przeciwnik dołączył. Sterujesz Runą."
            : "Połączono. Sterujesz Bjørnem.",
        );
        return;
      }

      if (
        message.type === "input" &&
        role === "host" &&
        isPlayerInput(message.input)
      ) {
        network.remoteInput = { ...message.input };
        return;
      }

      if (
        message.type === "snapshot" &&
        role === "guest" &&
        isGameSnapshot(message.game)
      ) {
        network.targetSnapshot = message.game;
        return;
      }

      if (message.type === "peer_left") {
        network.ready = false;
        network.remoteInput = { ...EMPTY_INPUT };
        network.appliedRemoteInput = { ...EMPTY_INPUT };
        gameRef.current?.keys.clear();
        if (role === "host") {
          setNetworkStatus("waiting");
          setAnnouncement("Przeciwnik wyszedł. Możesz poczekać na kolejną osobę.");
        } else {
          network.manuallyClosed = true;
          socket.close(1000, "Host left the room");
          setNetworkError("Gospodarz opuścił pokój.");
          setNetworkStatus("error");
        }
      }
    });

    socket.addEventListener("error", () => {
      if (networkRef.current.socket !== socket) return;
      setNetworkError(
        role === "guest"
          ? "Nie udało się dołączyć. Sprawdź kod albo poproś gospodarza o nowy pokój."
          : "Nie udało się utworzyć pokoju. Spróbuj ponownie.",
      );
      setNetworkStatus("error");
    });

    socket.addEventListener("close", () => {
      if (network.heartbeatId) clearInterval(network.heartbeatId);
      network.heartbeatId = null;
      if (networkRef.current.socket !== socket || network.manuallyClosed) return;
      network.ready = false;
      setNetworkError("Połączenie z pokojem zostało przerwane.");
      setNetworkStatus("error");
    });
  };

  useEffect(
    () => () => {
      const network = networkRef.current;
      network.manuallyClosed = true;
      if (network.heartbeatId) clearInterval(network.heartbeatId);
      if (network.socket && network.socket.readyState < WebSocket.CLOSING) {
        network.socket.close(1000, "Page closed");
      }
    },
    [],
  );

  const setVirtualKey = (key: string, pressed: boolean) => {
    const game = gameRef.current;
    if (!game) return;
    if (networkRef.current.role === "guest" && networkRef.current.ready) {
      sendGuestInput(key, pressed);
      if (pressed && audioRef.current?.state === "suspended") {
        void audioRef.current.resume();
      }
      return;
    }
    if (
      networkRef.current.role === "host" &&
      networkRef.current.ready &&
      ["arrowleft", "arrowright", "arrowup", "l"].includes(key)
    ) {
      return;
    }
    if (pressed) {
      game.keys.add(key);
      if (audioRef.current?.state === "suspended") void audioRef.current.resume();
    } else {
      game.keys.delete(key);
    }
  };

  const touchButton = (key: string, label: string, className = "") => (
    <button
      type="button"
      className={`touch-key ${className}`}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setVirtualKey(key, true);
      }}
      onPointerUp={() => setVirtualKey(key, false)}
      onPointerCancel={() => setVirtualKey(key, false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">ᚱ</span>
          <div>
            <p className="eyebrow">POJEDYNEK 2D</p>
            <h1>OSTRZE PÓŁNOCY</h1>
          </div>
        </div>
        <div className="top-actions">
          <button
            className={`utility-button online-button ${networkStatus === "connected" ? "is-live" : ""}`}
            type="button"
            aria-pressed={networkStatus !== "offline"}
            onClick={() => {
              if (networkStatus === "offline") {
                setNetworkError("");
                setNetworkStatus("menu");
              }
            }}
          >
            {networkStatus === "connected" ? `ONLINE · ${roomCode}` : "GRA ONLINE"}
          </button>
          <button
            className="utility-button"
            type="button"
            aria-pressed={!soundEnabled}
            onClick={() => {
              const next = !soundEnabledRef.current;
              soundEnabledRef.current = next;
              setSoundEnabled(next);
            }}
          >
            {soundEnabled ? "DŹWIĘK: ON" : "DŹWIĘK: OFF"}
          </button>
          <button
            className="utility-button reset-button"
            type="button"
            disabled={networkStatus === "connected" && networkRole === "guest"}
            onClick={() => actionsRef.current?.resetMatch()}
          >
            NOWY POJEDYNEK
          </button>
        </div>
      </header>

      <section className="arena-wrap" aria-label="Arena walki dwóch graczy">
        <div className="arena-corners" aria-hidden="true" />
        {networkStatus === "connected" ? (
          <div className="online-live-badge" role="status">
            <span className="online-dot" aria-hidden="true" />
            <strong>{roomCode}</strong>
            <span>{networkRole === "host" ? "RUNA · GOSPODARZ" : "BJØRN · GOŚĆ"}</span>
            <button type="button" onClick={leaveOnline}>ROZŁĄCZ</button>
          </div>
        ) : networkStatus !== "offline" ? (
          <div className="online-backdrop">
            <section className="online-dialog" aria-labelledby="online-title">
              <button
                type="button"
                className="online-close"
                aria-label="Zamknij tryb online"
                onClick={leaveOnline}
              >
                ×
              </button>

              {networkStatus === "menu" && (
                <>
                  <p className="online-kicker">PRAWDZIWY MULTIPLAYER</p>
                  <h2 id="online-title">ZAGRAJ ZE ZNAJOMYM</h2>
                  <p className="online-copy">
                    Utwórz pokój i wyślij kod albo wpisz kod otrzymany od gospodarza.
                  </p>
                  <button
                    type="button"
                    className="online-primary"
                    onClick={() => connectOnline("host", makeRoomCode())}
                  >
                    UTWÓRZ POKÓJ
                  </button>
                  <div className="online-divider"><span>ALBO</span></div>
                  <form
                    className="join-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      connectOnline("guest", joinCode);
                    }}
                  >
                    <label htmlFor="room-code">KOD POKOJU</label>
                    <div>
                      <input
                        id="room-code"
                        value={joinCode}
                        maxLength={6}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="ABC234"
                        onChange={(event) =>
                          setJoinCode(
                            event.target.value
                              .toUpperCase()
                              .replace(/[^A-HJ-NP-Z2-9]/g, ""),
                          )
                        }
                      />
                      <button type="submit">DOŁĄCZ</button>
                    </div>
                  </form>
                  {networkError && <p className="online-error">{networkError}</p>}
                </>
              )}

              {networkStatus === "connecting" && (
                <>
                  <div className="online-spinner" aria-hidden="true" />
                  <p className="online-kicker">POKÓJ {roomCode}</p>
                  <h2 id="online-title">ŁĄCZENIE…</h2>
                  <p className="online-copy">Kontaktujemy się z areną Cloudflare.</p>
                </>
              )}

              {networkStatus === "waiting" && (
                <>
                  <p className="online-kicker">POKÓJ GOTOWY</p>
                  <h2 id="online-title">WYŚLIJ TEN KOD</h2>
                  <button
                    type="button"
                    className="room-code-display"
                    title="Kopiuj kod"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(roomCode)
                        .then(() => setAnnouncement(`Skopiowano kod ${roomCode}.`))
                        .catch(() => setAnnouncement(`Kod pokoju: ${roomCode}.`));
                    }}
                  >
                    {roomCode}
                  </button>
                  <p className="online-copy waiting-copy">
                    Czekamy, aż druga osoba wybierze „Gra online” i wpisze kod.
                  </p>
                  <div className="waiting-pulse" aria-hidden="true"><i /><i /><i /></div>
                </>
              )}

              {networkStatus === "error" && (
                <>
                  <p className="online-kicker error-kicker">POŁĄCZENIE PRZERWANE</p>
                  <h2 id="online-title">NIE UDAŁO SIĘ POŁĄCZYĆ</h2>
                  <p className="online-error">{networkError}</p>
                  <button
                    type="button"
                    className="online-primary"
                    onClick={() => {
                      closeNetworkSocket();
                      setNetworkError("");
                      setNetworkStatus("menu");
                    }}
                  >
                    WRÓĆ
                  </button>
                </>
              )}
            </section>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          width={WORLD_W}
          height={WORLD_H}
          className="game-canvas"
          aria-label="Gra OSTRZE PÓŁNOCY. Gracz pierwszy: A, D, W i F. Gracz drugi: strzałki i L."
        />
        <div className="pause-badge" aria-hidden="true">
          <span>P</span> PAUZA
        </div>
      </section>

      <section className="controls-panel" aria-label="Sterowanie">
        <article className="player-controls player-one">
          <div className="player-number">01</div>
          <div>
            <p className="player-name">RUNA</p>
            <div className="keys-row">
              <kbd>A</kbd><kbd>D</kbd><span>RUCH</span>
              <kbd>W</kbd><span>SKOK</span>
              <kbd className="attack-key">F</kbd><span>CIOS</span>
            </div>
          </div>
        </article>
        <div className="match-rule">
          <span>⚔</span>
          <p>PIERWSZY DO 3 RUND</p>
        </div>
        <article className="player-controls player-two">
          <div>
            <p className="player-name">BJØRN</p>
            <div className="keys-row">
              <kbd>←</kbd><kbd>→</kbd><span>RUCH</span>
              <kbd>↑</kbd><span>SKOK</span>
              <kbd className="attack-key">L</kbd><span>CIOS</span>
            </div>
          </div>
          <div className="player-number">02</div>
        </article>
      </section>

      <section
        className={`touch-controls ${networkStatus === "connected" ? `online-${networkRole}` : ""}`}
        aria-label="Sterowanie dotykowe"
      >
        <div className="touch-side touch-one">
          {touchButton("a", "←")}
          {touchButton("d", "→")}
          {touchButton("w", "↑", "jump-touch")}
          {touchButton("f", "SIEKIERA", "axe-touch")}
        </div>
        <div className="touch-side touch-two">
          {touchButton("arrowleft", "←")}
          {touchButton("arrowright", "→")}
          {touchButton("arrowup", "↑", "jump-touch")}
          {touchButton("l", "SIEKIERA", "axe-touch")}
        </div>
      </section>

      <p className="tip">WSKAZÓWKA: atakuj w powietrzu i wykorzystuj podesty, by zaskoczyć przeciwnika.</p>
      <p className="sr-only" role="status" aria-live="polite">
        {paused ? "Gra zatrzymana." : announcement}
      </p>
    </main>
  );
}

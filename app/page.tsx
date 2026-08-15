"use client";

import { useEffect, useRef, useState } from "react";

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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [announcement, setAnnouncement] = useState(
    "Runda pierwsza. Walka rozpoczęta.",
  );

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
      game.keys.delete(event.key.toLowerCase());
    };

    const handleBlur = () => {
      game.keys.clear();
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

    const update = (dt: number) => {
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
  }, []);

  const setVirtualKey = (key: string, pressed: boolean) => {
    const game = gameRef.current;
    if (!game) return;
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
            onClick={() => actionsRef.current?.resetMatch()}
          >
            NOWY POJEDYNEK
          </button>
        </div>
      </header>

      <section className="arena-wrap" aria-label="Arena walki dwóch graczy">
        <div className="arena-corners" aria-hidden="true" />
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

      <section className="touch-controls" aria-label="Sterowanie dotykowe">
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

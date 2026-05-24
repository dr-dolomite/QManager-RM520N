// ─── Signal Storm enemies module ──────────────────────────────────────────────
// All enemy spawn, update, draw, and spawn-table logic.

import type { Enemy, EnemyType, Player, SpriteAtlas } from "./signal-storm-types";
import { SWERVER_W, SWERVER_H } from "./signal-storm-sprites";

// ─── Re-export sprite-sourced constants ──────────────────────────────────────
export { SWERVER_W, SWERVER_H };

// ─── Size constants ───────────────────────────────────────────────────────────

export const ENEMY_W = 20;
export const ENEMY_H = 16;
export const JAMMER_W = 28;
export const JAMMER_H = 20;
export const SPLITTER_W = 24;
export const SPLITTER_H = 20;
export const SNIPER_W = 28;
export const SNIPER_H = 24;
export const ORBITER_W = 24;
export const ORBITER_H = 20;
export const DRONE_W = 16;
export const DRONE_H = 16;

// ─── Speed / timing constants ─────────────────────────────────────────────────

export const ENEMY_BASE_FALL_SPEED = 60;
export const JAMMER_FALL_SPEED = 40;
export const SWERVER_FALL_SPEED = 50;
export const JAMMER_SHOOT_INTERVAL = 2000;
export const ENEMY_BEAM_SPEED = 150;
export const SWERVER_AMPLITUDE = 60;
export const SWERVER_FREQUENCY = 3;

// Drone snake (drone_swarm spawn formation)
export const DRONE_SNAKE_LENGTH = 6;
export const DRONE_SNAKE_SEGMENT_GAP = 4;   // px gap between segment hitboxes
export const DRONE_SNAKE_AMPLITUDE = 55;    // px x-offset of sine curve
export const DRONE_SNAKE_FREQUENCY = 0.003; // radians per ms of global time
export const DRONE_SNAKE_PHASE_LAG = 0.7;   // radians of phase per segment
export const DRONE_SNAKE_FALL_SPEED = 85;   // slightly slower than old 90 to keep snake readable

// ─── Score values ─────────────────────────────────────────────────────────────

export const SCORE_INTERFERENCE = 10;
export const SCORE_JAMMER = 25;
export const SCORE_SWERVER = 15;
export const SCORE_SPLITTER = 30;
export const SCORE_SNIPER = 40;
export const SCORE_ORBITER = 35;
export const SCORE_DRONE = 20;
export const SCORE_DRONE_CHAIN_BONUS = 50;

// ─── Result type ──────────────────────────────────────────────────────────────

export interface EnemyUpdateResult {
  fireBeam?: { x: number; y: number; dx: number; dy: number };
  spawnChildren?: Enemy[];
}

// ─── Shared enemy counter (for swarm IDs) ────────────────────────────────────

let _nextSwarmId = 1;
function nextSwarmId(): number {
  return _nextSwarmId++;
}

// ─── Base enemy factory ───────────────────────────────────────────────────────

function makeBaseEnemy(
  type: EnemyType,
  x: number,
  y: number,
  width: number,
  height: number,
  dy: number,
  hp: number,
  opts?: Partial<Pick<Enemy, "dx" | "lastShot" | "swerveTimer" | "parkedAt" | "telegraphUntil" | "telegraphAimX" | "telegraphAimY" | "swarmId" | "swarmSurvived">>
): Enemy {
  return {
    x,
    y,
    width,
    height,
    active: true,
    type,
    dy,
    dx: opts?.dx ?? 0,
    hp,
    lastShot: opts?.lastShot ?? 0,
    swerveTimer: opts?.swerveTimer ?? 0,
    parkedAt: opts?.parkedAt ?? 0,
    telegraphUntil: opts?.telegraphUntil ?? 0,
    telegraphAimX: opts?.telegraphAimX ?? 0,
    telegraphAimY: opts?.telegraphAimY ?? 0,
    swarmId: opts?.swarmId ?? 0,
    swarmSurvived: opts?.swarmSurvived ?? true,
  };
}

// ─── Spawn functions ──────────────────────────────────────────────────────────

export function spawnInterference(x: number, wave: number): Enemy {
  const fallSpeed = ENEMY_BASE_FALL_SPEED + (wave - 1) * 8;
  return makeBaseEnemy("interference", x, -ENEMY_H, ENEMY_W, ENEMY_H, fallSpeed, 1);
}

export function spawnJammer(x: number, wave: number, timestamp: number): Enemy {
  const fallSpeed = JAMMER_FALL_SPEED + (wave - 1) * 4;
  return makeBaseEnemy("jammer", x, -JAMMER_H, JAMMER_W, JAMMER_H, fallSpeed, 2, {
    lastShot: timestamp,
  });
}

export function spawnSwerver(x: number, wave: number): Enemy {
  const fallSpeed = SWERVER_FALL_SPEED + (wave - 1) * 5;
  return makeBaseEnemy("swerver", x, -SWERVER_H, SWERVER_W, SWERVER_H, fallSpeed, 1, {
    swerveTimer: Math.random() * Math.PI * 2,
  });
}

export function spawnSplitter(x: number, wave: number): Enemy {
  const fallSpeed = ENEMY_BASE_FALL_SPEED - 10 + (wave - 1) * 6;
  return makeBaseEnemy("splitter", x, -SPLITTER_H, SPLITTER_W, SPLITTER_H, fallSpeed, 2);
}

export function spawnSniper(x: number): Enemy {
  return makeBaseEnemy("sniper", x, -SNIPER_H, SNIPER_W, SNIPER_H, 40, 2);
}

export function spawnOrbiter(
  canvasWidth: number,
  canvasHeight: number,
  timestamp: number
): Enemy {
  const fromLeft = Math.random() < 0.5;
  const startX = fromLeft ? -ORBITER_W : canvasWidth;
  const startY = canvasHeight * 0.2;
  const initialDx = fromLeft ? 120 : -120;

  return makeBaseEnemy("orbiter", startX, startY, ORBITER_W, ORBITER_H, 20, 2, {
    dx: initialDx,
    lastShot: timestamp,
  });
}

export function spawnDroneSwarm(canvasWidth: number): Enemy[] {
  const swarmId = nextSwarmId();

  // Anchor the snake near a random horizontal position so multiple snakes do
  // not always stack on the same column. Clamp so the sine amplitude keeps the
  // whole chain visible.
  const minBase = DRONE_SNAKE_AMPLITUDE;
  const maxBase = canvasWidth - DRONE_W - DRONE_SNAKE_AMPLITUDE;
  if (maxBase < minBase) {
    // Canvas too narrow to respect the sine amplitude margin — skip this swarm.
    return [];
  }
  const baseX = Math.max(minBase, Math.min(maxBase, Math.random() * (maxBase - minBase) + minBase));

  const segmentStride = DRONE_H + DRONE_SNAKE_SEGMENT_GAP;

  const drones: Enemy[] = [];
  for (let i = 0; i < DRONE_SNAKE_LENGTH; i++) {
    // Head (i=0) enters first; later segments start further above the screen.
    const spawnY = -DRONE_H - i * segmentStride;
    // Negative phase lag so the head leads the wave and tail trails behind.
    const phase = -i * DRONE_SNAKE_PHASE_LAG;

    const drone = makeBaseEnemy(
      "drone",
      baseX,               // sine-wave anchor — read as a constant in updateEnemy
      spawnY,
      DRONE_W,
      DRONE_H,
      DRONE_SNAKE_FALL_SPEED,
      1,
      {
        swarmId,
        swarmSurvived: true,
        // Reuse swerveTimer to carry the per-segment phase offset. Drones do
        // not advance this timer themselves — it is read as a constant in
        // updateEnemy using the global `timestamp` as the driving clock.
        swerveTimer: phase,
      }
    );
    drone.baseX = baseX;
    drones.push(drone);
  }
  return drones;
}

// ─── Splitter shards ──────────────────────────────────────────────────────────

export function spawnSplitterShards(parent: Enemy): Enemy[] {
  const cx = parent.x + parent.width / 2;
  const cy = parent.y + parent.height / 2;
  const dxValues = [-60, 0, 60];
  return dxValues.map((dx) =>
    makeBaseEnemy(
      "interference",
      cx - ENEMY_W / 2,
      cy - ENEMY_H / 2,
      ENEMY_W,
      ENEMY_H,
      80,
      1,
      { dx }
    )
  );
}

// ─── Per-type update ──────────────────────────────────────────────────────────

const SNIPER_PARK_Y = 80;
const SNIPER_ATTACK_INTERVAL = 3000; // ms per cycle
const SNIPER_TELEGRAPH_MS = 400;    // ms of red line before firing
const SNIPER_BEAM_SPEED = 180;
const SNIPER_LIFE_CAP = 10000;      // ms after parking before self-destruct
const ORBITER_SHOOT_INTERVAL = 1500;
const ORBITER_GRAVITY = 60;         // px/s² added to dy each frame

export function updateEnemy(
  e: Enemy,
  dt: number,
  timestamp: number,
  player: Player,
  canvasWidth: number,
  canvasHeight: number
): EnemyUpdateResult {
  const result: EnemyUpdateResult = {};

  // ── Universal movement ──
  e.y += e.dy * dt;
  e.x += e.dx * dt;

  // ── Off-screen cull (bottom) — handled per-type below for nuance ──
  // (most types cull at bottom; orbiter culls any edge)

  switch (e.type) {
    // ── Interference: just falls ──
    case "interference": {
      if (e.y > canvasHeight) e.active = false;
      break;
    }

    // ── Jammer: falls, shoots straight down every JAMMER_SHOOT_INTERVAL ──
    case "jammer": {
      if (e.y > canvasHeight) e.active = false;
      if (timestamp - e.lastShot >= JAMMER_SHOOT_INTERVAL) {
        e.lastShot = timestamp;
        result.fireBeam = {
          x: e.x + e.width / 2,
          y: e.y + e.height,
          dx: 0,
          dy: ENEMY_BEAM_SPEED,
        };
      }
      break;
    }

    // ── Swerver: sine-wave weave ──
    case "swerver": {
      if (e.y > canvasHeight) e.active = false;
      e.swerveTimer += dt * SWERVER_FREQUENCY;
      e.x += Math.cos(e.swerveTimer) * SWERVER_AMPLITUDE * dt * SWERVER_FREQUENCY;
      e.x = Math.max(0, Math.min(e.x, canvasWidth - e.width));
      break;
    }

    // ── Splitter: just falls (shards spawned by engine on death) ──
    case "splitter": {
      if (e.y > canvasHeight) e.active = false;
      break;
    }

    // ── Sniper: descend to park y=80, then 3s attack cycle with telegraph ──
    case "sniper": {
      if (e.y >= SNIPER_PARK_Y && e.dy > 0) {
        // Just parked
        e.y = SNIPER_PARK_Y;
        e.dy = 0;
        if (e.parkedAt === 0) {
          e.parkedAt = timestamp;
          // Start first attack cycle immediately
          e.lastShot = timestamp;
        }
      }

      if (e.dy === 0) {
        // Self-destruct after life cap
        if (e.parkedAt > 0 && timestamp - e.parkedAt >= SNIPER_LIFE_CAP) {
          e.active = false;
          break;
        }

        const elapsed = timestamp - e.lastShot;

        if (elapsed >= SNIPER_ATTACK_INTERVAL) {
          // Start a new attack cycle: telegraph phase
          e.lastShot = timestamp;
          e.telegraphUntil = timestamp + SNIPER_TELEGRAPH_MS;
          // Lock aim at current player center
          e.telegraphAimX = player.x + player.width / 2;
          e.telegraphAimY = player.y + player.height / 2;
        }

        if (e.telegraphUntil > 0 && timestamp >= e.telegraphUntil) {
          // Telegraph expired — fire beam toward locked aim position
          const ox = e.x + e.width / 2;
          const oy = e.y + e.height;
          const tx = e.telegraphAimX;
          const ty = e.telegraphAimY;
          const dist = Math.max(1, Math.sqrt((tx - ox) ** 2 + (ty - oy) ** 2));
          result.fireBeam = {
            x: ox,
            y: oy,
            dx: ((tx - ox) / dist) * SNIPER_BEAM_SPEED,
            dy: ((ty - oy) / dist) * SNIPER_BEAM_SPEED,
          };
          e.telegraphUntil = 0;
          e.telegraphAimX = 0;
          e.telegraphAimY = 0;
        }
      } else {
        // Still descending
        if (e.y > canvasHeight) e.active = false;
      }
      break;
    }

    // ── Orbiter: gravity, shoots down every 1.5s, cull off any edge ──
    case "orbiter": {
      e.dy += ORBITER_GRAVITY * dt;
      if (
        e.y > canvasHeight ||
        e.x + e.width < 0 ||
        e.x > canvasWidth
      ) {
        e.active = false;
        break;
      }
      if (timestamp - e.lastShot >= ORBITER_SHOOT_INTERVAL) {
        e.lastShot = timestamp;
        result.fireBeam = {
          x: e.x + e.width / 2,
          y: e.y + e.height,
          dx: 0,
          dy: ENEMY_BEAM_SPEED,
        };
      }
      break;
    }

    // ── Drone: S-pattern snake segment ──
    // Each segment falls at a constant dy; its x oscillates around baseX using
    // the global timestamp and a per-segment phase stored in swerveTimer. The
    // phase lag between segments creates a traveling wave that looks like a
    // snake slithering downward.
    case "drone": {
      if (e.baseX !== undefined) {
        const wave = Math.sin(timestamp * DRONE_SNAKE_FREQUENCY + e.swerveTimer);
        e.x = e.baseX + wave * DRONE_SNAKE_AMPLITUDE;
      }
      if (e.y > canvasHeight) {
        e.swarmSurvived = false;
        e.active = false;
      }
      break;
    }
  }

  return result;
}

// ─── Score lookup ─────────────────────────────────────────────────────────────

export function enemyScore(type: EnemyType): number {
  switch (type) {
    case "interference": return SCORE_INTERFERENCE;
    case "jammer":       return SCORE_JAMMER;
    case "swerver":      return SCORE_SWERVER;
    case "splitter":     return SCORE_SPLITTER;
    case "sniper":       return SCORE_SNIPER;
    case "orbiter":      return SCORE_ORBITER;
    case "drone":        return SCORE_DRONE;
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

export function drawEnemy(
  e: Enemy,
  ctx: CanvasRenderingContext2D,
  sprites: SpriteAtlas
): void {
  // Choose sprite
  const sprite =
    e.type === "jammer"   ? sprites.jammer
    : e.type === "swerver" ? sprites.swerver
    : e.type === "splitter" ? sprites.splitter
    : e.type === "sniper"   ? sprites.sniper
    : e.type === "orbiter"  ? sprites.orbiter
    : e.type === "drone"    ? sprites.drone
    : sprites.meteor; // interference

  ctx.drawImage(sprite, Math.round(e.x), Math.round(e.y));

  // Damage flash (half-opacity white) when hp === 1 on multi-hp enemies
  if (
    (e.type === "jammer" || e.type === "splitter" || e.type === "sniper" || e.type === "orbiter") &&
    e.hp === 1
  ) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(e.x, e.y, e.width, e.height);
    ctx.globalAlpha = 1;
  }

  // Sniper telegraph: red aim line while telegraphUntil > 0
  if (e.type === "sniper" && e.telegraphUntil > 0) {
    const ox = e.x + e.width / 2;
    const oy = e.y + e.height;
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#ff2222";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(e.telegraphAimX, e.telegraphAimY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

// ─── Weighted spawn table ─────────────────────────────────────────────────────

// "drone_swarm" is not an EnemyType but is used as a spawn selector token.
type SpawnToken = EnemyType | "drone_swarm";

interface SpawnEntry {
  token: SpawnToken;
  gate: number;  // minimum wave to appear
  weight: number;
}

const SPAWN_TABLE: SpawnEntry[] = [
  { token: "interference", gate: 1, weight: 30 },
  { token: "swerver",      gate: 2, weight: 15 },
  { token: "jammer",       gate: 3, weight: 15 },
  { token: "splitter",     gate: 4, weight: 12 },
  { token: "sniper",       gate: 5, weight: 8  },
  { token: "drone_swarm",  gate: 5, weight: 12 },
  { token: "orbiter",      gate: 6, weight: 10 },
];

export function pickEnemyType(wave: number, snipersAlive: number): SpawnToken {
  const pool = SPAWN_TABLE.filter((entry) => {
    if (wave < entry.gate) return false;
    if (entry.token === "sniper" && snipersAlive >= 2) return false;
    return true;
  });

  const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.token;
  }
  // Fallback (should never reach here)
  return pool[pool.length - 1]?.token ?? "interference";
}

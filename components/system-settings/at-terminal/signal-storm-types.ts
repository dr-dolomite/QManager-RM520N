// ─── Shared types for Signal Storm ───────────────────────────────────────────
// Pure types file — zero runtime code.

export interface GamePalette {
  player: string;
  beam: string;
  enemy: string;
  jammer: string;
  powerUp: string;
  shield: string;
  spread: string;
  text: string;
  textMuted: string;
  background: string;
}

export interface GameCallbacks {
  onExit: () => void;
}

// ─── Internal interfaces ──────────────────────────────────────────────────────

export interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
}

export interface Player extends Entity {
  speed: number;
  shootCooldown: number;
  lastShot: number;
  hasShield: boolean;
  spreadShotUntil: number;
  rapidFireUntil: number;
  lives: number;
  invincibleUntil: number;
  respawnFreezeUntil: number;
}

export interface Beam extends Entity {
  dy: number;
}

export type EnemyType =
  | "interference"
  | "jammer"
  | "swerver"
  | "splitter"
  | "sniper"
  | "orbiter"
  | "drone";

export interface Enemy extends Entity {
  dy: number;
  dx: number;
  hp: number;
  type: EnemyType;
  lastShot: number;
  swerveTimer: number;
  parkedAt: number;
  telegraphUntil: number;
  telegraphAimX: number;
  telegraphAimY: number;
  swarmId: number;
  swarmSurvived: boolean;
  /** Drone-only: anchor X used by the S-curve motion (left edge of hitbox) */
  baseX?: number;
}

export interface EnemyBeam extends Entity {
  dy: number;
  dx: number;
}

export interface BossIntroBanner {
  phase: 1 | 2 | 3;
  startTime: number;
  name: string;
  subtitle: string;
}

export interface Boss extends Entity {
  hp: number;
  maxHp: number;
  tier: 1 | 2 | 3 | 4 | 5;
  entered: boolean;
  moveTimer: number;
  shootTimer: number;
  patternPhase: number;
  targetX: number;
  targetY: number;
  dx: number;
  // Phase system
  name: string;
  phase: 1 | 2 | 3;
  phaseJustChanged: boolean;
  phaseFreezeUntil: number;
  amplitude: number;
  period: number;
  telegraphUntil: number;
  telegraphDuration: number;
  telegraphOrigin: { x: number; y: number } | null;
  telegraphType: "dot" | "line" | "ring";
  telegraphAimX: number;
  /** Distance traveled since last trail-fire beam (T2 P3) */
  trailDistAccum: number;
  flashUntil: number;
  introBanner: BossIntroBanner | null;
}

export interface PowerUp extends Entity {
  dy: number;
  type: "rapid" | "shield" | "spread";
}

export interface Particle {
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Star {
  x: number;
  y: number;
  speed: number;
  brightness: number;
}

export type GameState = "PLAYING" | "PAUSED" | "GAME_OVER";

// ─── Sprite atlas ─────────────────────────────────────────────────────────────

export interface SpriteAtlas {
  player: OffscreenCanvas;
  meteor: OffscreenCanvas;
  jammer: OffscreenCanvas;
  swerver: OffscreenCanvas;
  splitter: OffscreenCanvas;
  sniper: OffscreenCanvas;
  orbiter: OffscreenCanvas;
  drone: OffscreenCanvas;
  puRapid: OffscreenCanvas;
  puShield: OffscreenCanvas;
  puSpread: OffscreenCanvas;
  flames: OffscreenCanvas[];
  heartFull: OffscreenCanvas;
  heartEmpty: OffscreenCanvas;
  boss1: OffscreenCanvas;
  boss2: OffscreenCanvas;
  boss3: OffscreenCanvas;
  boss4: OffscreenCanvas;
  boss5: OffscreenCanvas;
  boss1White: OffscreenCanvas;
  boss2White: OffscreenCanvas;
  boss3White: OffscreenCanvas;
  boss4White: OffscreenCanvas;
  boss5White: OffscreenCanvas;
}

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

interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
}

interface Player extends Entity {
  speed: number;
  shootCooldown: number;
  lastShot: number;
  hasShield: boolean;
  spreadShotUntil: number;
  rapidFireUntil: number;
}

interface Beam extends Entity {
  dy: number;
}

interface Enemy extends Entity {
  dy: number;
  dx: number;
  hp: number;
  type: "interference" | "jammer" | "swerver";
  lastShot: number;
  swerveTimer: number;
}

interface EnemyBeam extends Entity {
  dy: number;
}

interface Boss extends Entity {
  hp: number;
  maxHp: number;
  tier: 1 | 2 | 3 | 4 | 5;
  entered: boolean;
  moveTimer: number;
  shootTimer: number;
  patternPhase: number;
  targetX: number;
  dx: number;
}

interface PowerUp extends Entity {
  dy: number;
  type: "rapid" | "shield" | "spread";
}

interface Particle {
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Star {
  x: number;
  y: number;
  speed: number;
  brightness: number;
}

type GameState = "PLAYING" | "GAME_OVER";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_SPEED = 200;
const PLAYER_SHOOT_COOLDOWN = 300;
const RAPID_FIRE_COOLDOWN = 150;
const BEAM_SPEED = -350;
const ENEMY_BASE_FALL_SPEED = 60;
const JAMMER_FALL_SPEED = 40;
const JAMMER_SHOOT_INTERVAL = 2000;
const ENEMY_BEAM_SPEED = 150;
const POWERUP_FALL_SPEED = 50;
const SPAWN_BASE_INTERVAL = 2000;
const SPAWN_INTERVAL_DECREASE = 150;
const SPAWN_MIN_INTERVAL = 500;
const JAMMER_WAVE_THRESHOLD = 3;
const JAMMER_SPAWN_CHANCE = 0.2;
const SWERVER_WAVE_THRESHOLD = 2;
const SWERVER_SPAWN_CHANCE = 0.25;
const SWERVER_FALL_SPEED = 50;
const SWERVER_AMPLITUDE = 60;
const SWERVER_FREQUENCY = 3;
const SCORE_SWERVER = 15;
const POWERUP_DROP_RATE = 0.1;
const WAVE_DURATION = 30;
const SCORE_INTERFERENCE = 10;
const SCORE_JAMMER = 25;
const SCORE_SURVIVAL = 1;

const PLAYER_W = 24;
const PLAYER_H = 28;
const ENEMY_W = 20;
const ENEMY_H = 16;
const JAMMER_W = 28;
const JAMMER_H = 20;
const BEAM_W = 3;
const BEAM_H = 10;
const POWERUP_W = 14;
const POWERUP_H = 14;

const RAPID_FIRE_DURATION = 5000;
const SPREAD_SHOT_DURATION = 5000;
const SPREAD_ANGLE = 0.3; // radians off-axis for spread

const SCORE_BOSS = 100; // multiplied by boss tier
const BOSS_WAVE_INTERVAL = 5;
const BOSS_ENTER_Y = 60; // px from top where boss stops and attacks

const LS_KEY = "qm_game_highscore";
const PIXEL_SCALE = 2; // Each sprite pixel = 2x2 canvas pixels

// ─── Sprite definitions (designed at half-res, rendered at 2x) ───────────────
// 0=transparent, 1=primary, 2=dark(0.55 opacity), 3=highlight(white overlay)

// Player ship — 12x14 → 24x28 rendered
// A sleek top-down fighter with cockpit and engine ports
const SPRITE_PLAYER: number[][] = [
  [0,0,0,0,0,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,3,3,1,1,0,0,0],
  [0,0,0,1,1,1,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,0,0],
  [0,1,1,2,1,1,1,1,2,1,1,0],
  [1,1,2,1,1,1,1,1,1,2,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,1,1,1,1,1,1,1,1,0,1],
  [1,0,0,1,1,0,0,1,1,0,0,1],
  [0,0,0,1,1,0,0,1,1,0,0,0],
  [0,0,0,0,1,0,0,1,0,0,0,0],
  [0,0,0,0,1,0,0,1,0,0,0,0],
  [0,0,0,0,3,0,0,3,0,0,0,0],
];

// Meteor / interference enemy — 10x8 → 20x16 rendered
// An irregular rocky asteroid shape
const SPRITE_METEOR: number[][] = [
  [0,0,0,1,1,1,1,0,0,0],
  [0,0,1,1,1,2,1,1,0,0],
  [0,1,1,2,1,1,1,1,1,0],
  [1,1,1,1,1,1,2,1,1,1],
  [1,1,2,1,1,1,1,1,1,1],
  [1,1,1,1,2,1,1,2,1,0],
  [0,1,1,1,1,1,1,1,0,0],
  [0,0,0,1,1,1,0,0,0,0],
];

// Jammer / alien ship — 14x10 → 28x20 rendered
// A wider alien craft with angular wings and a central eye
const SPRITE_JAMMER: number[][] = [
  [0,0,0,0,0,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,1,3,3,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,0,0],
  [0,1,1,2,1,1,1,1,1,1,2,1,1,0],
  [1,1,2,1,1,1,1,1,1,1,1,2,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,1,1,0,0,0,0,1,1,0,0,1],
  [0,0,0,0,1,0,0,0,0,1,0,0,0,0],
  [0,0,0,0,0,1,0,0,1,0,0,0,0,0],
];

// Swerver enemy — 10x10 → 20x20 rendered
// A diamond/dart shape that looks agile and evasive
const SPRITE_SWERVER: number[][] = [
  [0,0,0,0,1,1,0,0,0,0],
  [0,0,0,1,1,1,1,0,0,0],
  [0,0,1,1,3,3,1,1,0,0],
  [0,1,1,1,1,1,1,1,1,0],
  [1,1,2,1,1,1,1,2,1,1],
  [1,1,2,1,1,1,1,2,1,1],
  [0,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,0,0,1,1,0,0],
  [0,0,0,1,0,0,1,0,0,0],
  [0,0,0,0,1,1,0,0,0,0],
];

const SWERVER_W = 20;
const SWERVER_H = 20;

// Rapid-fire power-up icon — 7x7 → 14x14 rendered (lightning bolt)
const SPRITE_PU_RAPID: number[][] = [
  [0,0,0,1,1,0,0],
  [0,0,1,1,0,0,0],
  [0,1,1,1,1,0,0],
  [0,0,0,1,1,0,0],
  [0,0,1,1,0,0,0],
  [0,1,1,0,0,0,0],
  [0,0,0,0,0,0,0],
];

// Shield power-up icon — 7x7 → 14x14 rendered (shield/diamond)
const SPRITE_PU_SHIELD: number[][] = [
  [0,0,0,1,0,0,0],
  [0,0,1,1,1,0,0],
  [0,1,1,3,1,1,0],
  [0,1,1,1,1,1,0],
  [0,0,1,1,1,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,0,0,0,0],
];

// Spread-shot power-up icon — 7x7 → 14x14 rendered (triple arrows up)
const SPRITE_PU_SPREAD: number[][] = [
  [0,1,0,1,0,1,0],
  [1,1,0,1,0,1,1],
  [0,0,0,1,0,0,0],
  [0,1,0,1,0,1,0],
  [1,1,0,1,0,1,1],
  [0,0,0,1,0,0,0],
  [0,0,0,0,0,0,0],
];

// Player engine flame animation — 2 frames, 4x3 → 8x6 rendered
const SPRITE_ENGINE_FLAME: number[][][] = [
  [
    [0,1,1,0],
    [0,3,3,0],
    [0,0,0,0],
  ],
  [
    [0,3,3,0],
    [0,1,1,0],
    [1,3,3,1],
  ],
];

// Boss 1 — Signal Disruptor: 20x12 → 40x24. Amber jammer color.
// A wide dish-shaped cruiser with a central cannon and flanking antenna pods.
const SPRITE_BOSS1: number[][] = [
  [0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,3,3,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,2,1,1,1,1,1,1,1,1,2,1,1,0,0,0],
  [0,0,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,0,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1],
  [1,0,0,1,1,1,1,0,0,1,1,0,0,1,1,1,1,0,0,1],
  [0,0,0,0,1,1,0,0,0,1,1,0,0,0,1,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0],
];

// Boss 2 — Frequency Jammer: 18x14 → 36x28. Red enemy color.
// Aggressive wedge ship with swept wings and multi-barrel nose.
const SPRITE_BOSS2: number[][] = [
  [0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,1,2,1,1,1,1,1,2,1,1,1,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,1,1,2,1,1,1,1,1,1,1,1,1,1,1,2,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,2,1,1,1,1,2,1,1,1,1,2,1,1,1,2,1],
  [1,0,0,1,1,1,0,0,1,1,1,1,0,0,1,1,0,1],
  [0,0,0,0,1,1,0,0,1,1,1,1,0,0,1,1,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0],
];

// Boss 3 — Band Blocker: 24x10 → 48x20. Purple powerUp color.
// Ultra-wide blockade station with heavy armor and multiple emitter ports.
const SPRITE_BOSS3: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,1,3,1,1,3,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,1,1,0],
  [1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,2,1,1,1,1,1],
  [1,1,2,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,1,1,1,1,2,1],
  [1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1],
  [0,0,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,0],
];

// Boss 4 — Network Nullifier: 16x14 → 32x28. Orange spread color.
// Fast angular interceptor with a sharp nose and precision targeting array.
const SPRITE_BOSS4: number[][] = [
  [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,1,1,2,1,1,1,1,1,1,2,1,1,0,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [1,1,2,1,1,1,1,1,1,1,1,1,1,2,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,2,1,1,2,1,1,1,1,2,1,1,2,1,1],
  [1,0,0,1,0,0,1,1,1,1,0,0,1,0,0,1],
  [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0],
];

// Boss 5 — Core Corruptor: 22x16 → 44x32. Red enemy color, complex multi-part.
// The ultimate threat: a massive capital ship with a rotating core and heavy weapons.
const SPRITE_BOSS5: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,3,1,1,3,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,2,1,1,1,1,1,1,1,1,2,1,1,0,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,1,1,1,0,0],
  [0,1,1,2,1,1,1,1,1,1,3,3,1,1,1,1,1,1,2,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,2,1,1,1,2,1,1,1,1,1,1,1,1,1,2,1,1,1,2,1],
  [1,1,1,1,1,0,0,1,1,1,2,2,1,1,1,0,0,1,1,1,1,1],
  [1,0,0,1,1,0,0,1,1,0,0,0,0,1,1,0,0,1,1,0,0,1],
  [0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,0,0,3,0,0,0,0,0,0,0,0],
];

// ─── Sprite pre-rendering helper ─────────────────────────────────────────────

function preRenderSprite(
  pixels: number[][],
  primaryColor: string,
  scale: number,
): OffscreenCanvas {
  const h = pixels.length;
  const w = pixels[0].length;
  const canvas = new OffscreenCanvas(w * scale, h * scale);
  const ctx = canvas.getContext("2d")!;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const val = pixels[row][col];
      if (val === 0) continue;

      if (val === 1) {
        ctx.fillStyle = primaryColor;
        ctx.globalAlpha = 1;
      } else if (val === 2) {
        ctx.fillStyle = primaryColor;
        ctx.globalAlpha = 0.55;
      } else if (val === 3) {
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.45;
      }

      ctx.fillRect(col * scale, row * scale, scale, scale);
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class SignalStormEngine {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private palette: GamePalette;
  private callbacks: GameCallbacks;

  private keys: Set<string> = new Set();
  private gameState: GameState = "PLAYING";

  private player!: Player;
  private beams: Beam[] = [];
  private enemies: Enemy[] = [];
  private enemyBeams: EnemyBeam[] = [];
  private powerUps: PowerUp[] = [];
  private particles: Particle[] = [];
  private stars: Star[] = [];

  // Pre-rendered sprite canvases
  private spritePlayer!: OffscreenCanvas;
  private spriteMeteor!: OffscreenCanvas;
  private spriteJammer!: OffscreenCanvas;
  private spriteSwerver!: OffscreenCanvas;
  private spritePuRapid!: OffscreenCanvas;
  private spritePuShield!: OffscreenCanvas;
  private spritePuSpread!: OffscreenCanvas;
  private spriteFlames!: OffscreenCanvas[];
  private flameFrame = 0;
  private flameTimer = 0;
  private spriteBoss1!: OffscreenCanvas;
  private spriteBoss2!: OffscreenCanvas;
  private spriteBoss3!: OffscreenCanvas;
  private spriteBoss4!: OffscreenCanvas;
  private spriteBoss5!: OffscreenCanvas;

  private boss: Boss | null = null;
  private bossDefeatFlash = 0;

  private score = 0;
  private highScore = 0;
  private wave = 1;
  private waveTimer = 0;
  private survivalTimer = 0;
  private spawnTimer = 0;
  private lastTime = 0;
  private isNewHighScore = false;

  constructor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: GamePalette,
    callbacks: GameCallbacks
  ) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.callbacks = callbacks;

    // Load high score
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored !== null) {
        this.highScore = parseInt(stored, 10) || 0;
      }
    } catch {
      // localStorage unavailable
    }

    this.initStars();
    this.initPlayer();
    this.preRenderSprites();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  public handleKeyDown(key: string): void {
    this.keys.add(key);

    if (this.gameState === "GAME_OVER") {
      if (key === "Enter") this.restart();
      if (key === "Escape") this.callbacks.onExit();
    } else {
      if (key === "Escape") this.callbacks.onExit();
    }
  }

  public handleKeyUp(key: string): void {
    this.keys.delete(key);
  }

  public tick(timestamp: number): void {
    this.update(timestamp);
    this.render();
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // Keep player within new bounds
    this.player.x = Math.min(
      Math.max(this.player.x, 0),
      this.width - PLAYER_W
    );
    this.player.y = this.height - PLAYER_H - 16;
  }

  // ─── Init helpers ────────────────────────────────────────────────────────────

  private initPlayer(): void {
    this.player = {
      x: this.width / 2 - PLAYER_W / 2,
      y: this.height - PLAYER_H - 16,
      width: PLAYER_W,
      height: PLAYER_H,
      active: true,
      speed: PLAYER_SPEED,
      shootCooldown: PLAYER_SHOOT_COOLDOWN,
      lastShot: 0,
      hasShield: false,
      spreadShotUntil: 0,
      rapidFireUntil: 0,
    };
  }

  private initStars(): void {
    this.stars = [];
    for (let i = 0; i < 40; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        speed: 20 + Math.random() * 40,
        brightness: 0.2 + Math.random() * 0.8,
      });
    }
  }

  private preRenderSprites(): void {
    const s = PIXEL_SCALE;
    this.spritePlayer = preRenderSprite(SPRITE_PLAYER, this.palette.player, s);
    this.spriteMeteor = preRenderSprite(SPRITE_METEOR, this.palette.enemy, s);
    this.spriteJammer = preRenderSprite(SPRITE_JAMMER, this.palette.jammer, s);
    this.spriteSwerver = preRenderSprite(SPRITE_SWERVER, this.palette.shield, s);
    this.spritePuRapid = preRenderSprite(SPRITE_PU_RAPID, this.palette.powerUp, s);
    this.spritePuShield = preRenderSprite(SPRITE_PU_SHIELD, this.palette.shield, s);
    this.spritePuSpread = preRenderSprite(SPRITE_PU_SPREAD, this.palette.spread, s);
    this.spriteFlames = SPRITE_ENGINE_FLAME.map((frame) =>
      preRenderSprite(frame, this.palette.spread, s),
    );
    this.spriteBoss1 = preRenderSprite(SPRITE_BOSS1, this.palette.jammer, s);
    this.spriteBoss2 = preRenderSprite(SPRITE_BOSS2, this.palette.enemy, s);
    this.spriteBoss3 = preRenderSprite(SPRITE_BOSS3, this.palette.powerUp, s);
    this.spriteBoss4 = preRenderSprite(SPRITE_BOSS4, this.palette.spread, s);
    this.spriteBoss5 = preRenderSprite(SPRITE_BOSS5, this.palette.enemy, s);
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  private update(timestamp: number): void {
    if (this.lastTime === 0) {
      this.lastTime = timestamp;
    }
    const rawDt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    const dt = Math.max(0.016, Math.min(rawDt, 0.1)); // floor at ~60fps, cap at 100ms

    if (this.gameState === "GAME_OVER") {
      // Update stars and particles even on game-over screen for ambience
      this.updateStars(dt);
      this.updateParticles(dt);
      return;
    }

    // ── Player movement ──
    const isRapid = timestamp < this.player.rapidFireUntil;
    const isSpread = timestamp < this.player.spreadShotUntil;

    if (this.keys.has("ArrowLeft") || this.keys.has("a")) {
      this.player.x -= this.player.speed * dt;
    }
    if (this.keys.has("ArrowRight") || this.keys.has("d")) {
      this.player.x += this.player.speed * dt;
    }
    this.player.x = Math.max(0, Math.min(this.player.x, this.width - PLAYER_W));

    // ── Shooting ──
    const cooldown = isRapid ? RAPID_FIRE_COOLDOWN : PLAYER_SHOOT_COOLDOWN;
    if (
      this.keys.has(" ") &&
      timestamp - this.player.lastShot >= cooldown
    ) {
      this.player.lastShot = timestamp;
      this.firePlayerBeams(isSpread);
    }

    // ── Move player beams ──
    for (const b of this.beams) {
      b.y += BEAM_SPEED * dt;
      if (b.y + b.height < 0) b.active = false;
    }

    // ── Spawn enemies ──
    const baseSpawnInterval = Math.max(
      SPAWN_MIN_INTERVAL,
      SPAWN_BASE_INTERVAL - (this.wave - 1) * SPAWN_INTERVAL_DECREASE
    );
    // Double the spawn interval during boss fights
    const spawnInterval = this.boss ? baseSpawnInterval * 2 : baseSpawnInterval;
    this.spawnTimer += dt * 1000;
    if (this.spawnTimer >= spawnInterval) {
      this.spawnTimer = 0;
      this.spawnEnemy(timestamp);
    }

    // ── Move enemies + jammer shooting ──
    for (const e of this.enemies) {
      e.y += e.dy * dt;
      if (e.y > this.height) e.active = false;

      if (e.type === "swerver") {
        // Weave left-right using sine wave
        e.swerveTimer += dt * SWERVER_FREQUENCY;
        e.x += Math.cos(e.swerveTimer) * SWERVER_AMPLITUDE * dt * SWERVER_FREQUENCY;
        // Clamp to canvas
        e.x = Math.max(0, Math.min(e.x, this.width - e.width));
      }

      if (e.type === "jammer" && timestamp - e.lastShot >= JAMMER_SHOOT_INTERVAL) {
        e.lastShot = timestamp;
        this.fireEnemyBeam(e);
      }
    }

    // ── Move enemy beams ──
    for (const eb of this.enemyBeams) {
      eb.y += eb.dy * dt;
      if (eb.y > this.height) eb.active = false;
    }

    // ── Collision: player beams vs enemies ──
    for (const b of this.beams) {
      if (!b.active) continue;
      for (const e of this.enemies) {
        if (!e.active) continue;
        if (this.collides(b, e)) {
          b.active = false;
          e.hp -= 1;
          if (e.hp <= 0) {
            e.active = false;
            this.score +=
              e.type === "jammer" ? SCORE_JAMMER
                : e.type === "swerver" ? SCORE_SWERVER
                : SCORE_INTERFERENCE;
            this.spawnParticles(
              e.x + e.width / 2,
              e.y + e.height / 2,
              e.type === "jammer" ? this.palette.jammer
                : e.type === "swerver" ? this.palette.shield
                : this.palette.enemy
            );
            if (Math.random() < POWERUP_DROP_RATE) {
              this.spawnPowerUp(e.x + e.width / 2, e.y + e.height / 2);
            }
          }
          break;
        }
      }
    }

    // ── Collision: enemies vs player ──
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (this.collides(e, this.player)) {
        if (this.player.hasShield) {
          this.player.hasShield = false;
          e.active = false;
          this.spawnParticles(
            e.x + e.width / 2,
            e.y + e.height / 2,
            this.palette.shield
          );
        } else {
          this.triggerGameOver();
          return;
        }
      }
    }

    // ── Collision: enemy beams vs player ──
    for (const eb of this.enemyBeams) {
      if (!eb.active) continue;
      if (this.collides(eb, this.player)) {
        eb.active = false;
        if (this.player.hasShield) {
          this.player.hasShield = false;
          this.spawnParticles(
            this.player.x + PLAYER_W / 2,
            this.player.y + PLAYER_H / 2,
            this.palette.shield
          );
        } else {
          this.triggerGameOver();
          return;
        }
      }
    }

    // ── Move power-ups + collision with player ──
    for (const p of this.powerUps) {
      p.y += p.dy * dt;
      if (p.y > this.height) {
        p.active = false;
        continue;
      }
      if (this.collides(p, this.player)) {
        p.active = false;
        this.applyPowerUp(p, timestamp);
      }
    }

    // ── Update particles ──
    this.updateParticles(dt);

    // ── Update stars ──
    this.updateStars(dt);

    // ── Engine flame animation ──
    this.flameTimer += dt;
    if (this.flameTimer >= 0.1) {
      this.flameTimer = 0;
      this.flameFrame = (this.flameFrame + 1) % this.spriteFlames.length;
    }

    // ── Wave timer ──
    this.waveTimer += dt;
    if (this.waveTimer >= WAVE_DURATION) {
      this.wave += 1;
      this.waveTimer = 0;
      // Spawn a boss at the start of every BOSS_WAVE_INTERVAL wave
      if (this.wave % BOSS_WAVE_INTERVAL === 0 && !this.boss) {
        this.spawnBoss();
      }
    }

    // ── Boss defeat flash countdown ──
    if (this.bossDefeatFlash > 0) {
      this.bossDefeatFlash -= dt;
    }

    // ── Boss update ──
    if (this.boss) {
      this.updateBoss(dt, timestamp);
    }

    // ── Survival score ──
    this.survivalTimer += dt;
    if (this.survivalTimer >= 1) {
      this.score += SCORE_SURVIVAL;
      this.survivalTimer -= 1;
    }

    // ── Filter inactive entities ──
    this.beams = this.beams.filter((b) => b.active);
    this.enemies = this.enemies.filter((e) => e.active);
    this.enemyBeams = this.enemyBeams.filter((eb) => eb.active);
    this.powerUps = this.powerUps.filter((p) => p.active);
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ─── Helpers for update ──────────────────────────────────────────────────────

  private firePlayerBeams(isSpread: boolean): void {
    const cx = this.player.x + PLAYER_W / 2 - BEAM_W / 2;
    const cy = this.player.y - BEAM_H;

    if (isSpread) {
      // Center beam
      this.beams.push({
        x: cx,
        y: cy,
        width: BEAM_W,
        height: BEAM_H,
        active: true,
        dy: BEAM_SPEED,
      });
      // Left angled
      this.beams.push({
        x: cx - Math.tan(SPREAD_ANGLE) * 20,
        y: cy,
        width: BEAM_W,
        height: BEAM_H,
        active: true,
        dy: BEAM_SPEED,
      });
      // Right angled
      this.beams.push({
        x: cx + Math.tan(SPREAD_ANGLE) * 20,
        y: cy,
        width: BEAM_W,
        height: BEAM_H,
        active: true,
        dy: BEAM_SPEED,
      });
    } else {
      this.beams.push({
        x: cx,
        y: cy,
        width: BEAM_W,
        height: BEAM_H,
        active: true,
        dy: BEAM_SPEED,
      });
    }
  }

  private spawnEnemy(timestamp: number): void {
    const roll = Math.random();
    const isSwerver =
      this.wave >= SWERVER_WAVE_THRESHOLD && roll < SWERVER_SPAWN_CHANCE;
    const isJammer =
      !isSwerver &&
      this.wave >= JAMMER_WAVE_THRESHOLD &&
      roll < SWERVER_SPAWN_CHANCE + JAMMER_SPAWN_CHANCE;

    if (isSwerver) {
      const x = Math.random() * (this.width - SWERVER_W);
      const fallSpeed = SWERVER_FALL_SPEED + (this.wave - 1) * 5;
      this.enemies.push({
        x,
        y: -SWERVER_H,
        width: SWERVER_W,
        height: SWERVER_H,
        active: true,
        dy: fallSpeed,
        dx: 0,
        hp: 1,
        type: "swerver",
        lastShot: 0,
        swerveTimer: Math.random() * Math.PI * 2,
      });
    } else if (isJammer) {
      const x = Math.random() * (this.width - JAMMER_W);
      const fallSpeed = JAMMER_FALL_SPEED + (this.wave - 1) * 4;
      this.enemies.push({
        x,
        y: -JAMMER_H,
        width: JAMMER_W,
        height: JAMMER_H,
        active: true,
        dy: fallSpeed,
        dx: 0,
        hp: 2,
        type: "jammer",
        lastShot: timestamp,
        swerveTimer: 0,
      });
    } else {
      const x = Math.random() * (this.width - ENEMY_W);
      const fallSpeed = ENEMY_BASE_FALL_SPEED + (this.wave - 1) * 8;
      this.enemies.push({
        x,
        y: -ENEMY_H,
        width: ENEMY_W,
        height: ENEMY_H,
        active: true,
        dy: fallSpeed,
        dx: 0,
        hp: 1,
        type: "interference",
        lastShot: 0,
        swerveTimer: 0,
      });
    }
  }

  private fireEnemyBeam(e: Enemy): void {
    this.enemyBeams.push({
      x: e.x + e.width / 2 - BEAM_W / 2,
      y: e.y + e.height,
      width: BEAM_W,
      height: BEAM_H,
      active: true,
      dy: ENEMY_BEAM_SPEED,
    });
  }

  private spawnParticles(cx: number, cy: number, color: string): void {
    const count = 4 + Math.floor(Math.random() * 3); // 4-6
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;
      this.particles.push({
        x: cx,
        y: cy,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.4 + Math.random() * 0.4,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private spawnPowerUp(cx: number, cy: number): void {
    const types: Array<"rapid" | "shield" | "spread"> = [
      "rapid",
      "shield",
      "spread",
    ];
    const type = types[Math.floor(Math.random() * types.length)];
    this.powerUps.push({
      x: cx - POWERUP_W / 2,
      y: cy,
      width: POWERUP_W,
      height: POWERUP_H,
      active: true,
      dy: POWERUP_FALL_SPEED,
      type,
    });
  }

  private applyPowerUp(p: PowerUp, timestamp: number): void {
    if (p.type === "rapid") {
      this.player.rapidFireUntil = timestamp + RAPID_FIRE_DURATION;
    } else if (p.type === "shield") {
      this.player.hasShield = true;
    } else if (p.type === "spread") {
      this.player.spreadShotUntil = timestamp + SPREAD_SHOT_DURATION;
    }
    this.spawnParticles(
      p.x + POWERUP_W / 2,
      p.y + POWERUP_H / 2,
      p.type === "rapid"
        ? this.palette.powerUp
        : p.type === "shield"
          ? this.palette.shield
          : this.palette.spread
    );
  }

  private spawnBoss(): void {
    const tier = (((this.wave / BOSS_WAVE_INTERVAL) - 1) % 5 + 1) as 1 | 2 | 3 | 4 | 5;
    const cycleNumber = Math.floor((this.wave - 1) / 25);
    const baseHp = [0, 8, 12, 14, 10, 18][tier];
    const hp = baseHp + cycleNumber * 6;

    // Determine boss dimensions from sprite at full scale
    const spriteWidths  = [0, 40, 36, 48, 32, 44];
    const spriteHeights = [0, 24, 28, 20, 28, 32];
    const w = spriteWidths[tier];
    const h = spriteHeights[tier];

    this.boss = {
      x: this.width / 2 - w / 2,
      y: -h,
      width: w,
      height: h,
      active: true,
      hp,
      maxHp: hp,
      tier,
      entered: false,
      moveTimer: 0,
      shootTimer: 0,
      patternPhase: 0,
      targetX: this.width / 2 - w / 2,
      dx: tier === 4 ? 140 : (tier === 3 ? 25 : 0),
    };
  }

  private updateBoss(dt: number, timestamp: number): void {
    const boss = this.boss!;
    const centerX = this.width / 2 - boss.width / 2;

    // ── Entry movement ──
    if (!boss.entered) {
      boss.y += 80 * dt;
      if (boss.y >= BOSS_ENTER_Y) {
        boss.y = BOSS_ENTER_Y;
        boss.entered = true;
        // Give boss 2 an initial random target
        if (boss.tier === 2) {
          boss.targetX = Math.random() * (this.width - boss.width);
        }
      }
      return; // don't move/shoot until fully entered
    }

    // ── Movement patterns ──
    boss.moveTimer += dt;

    if (boss.tier === 1) {
      // Smooth sine-wave left-right
      boss.x = centerX + Math.sin(boss.moveTimer * 0.8) * (this.width * 0.3);

    } else if (boss.tier === 2) {
      // Dash to random X positions
      const diff = boss.targetX - boss.x;
      const step = 100 * dt;
      if (Math.abs(diff) <= step) {
        boss.x = boss.targetX;
        boss.targetX = Math.random() * (this.width - boss.width);
      } else {
        boss.x += Math.sign(diff) * step;
      }

    } else if (boss.tier === 3) {
      // Slow left-right sweep, bounces off edges
      boss.x += boss.dx * dt;
      if (boss.x <= 0) {
        boss.x = 0;
        boss.dx = Math.abs(boss.dx);
      } else if (boss.x + boss.width >= this.width) {
        boss.x = this.width - boss.width;
        boss.dx = -Math.abs(boss.dx);
      }

    } else if (boss.tier === 4) {
      // Fast zigzag, bounces off walls
      boss.x += boss.dx * dt;
      if (boss.x <= 0) {
        boss.x = 0;
        boss.dx = Math.abs(boss.dx);
      } else if (boss.x + boss.width >= this.width) {
        boss.x = this.width - boss.width;
        boss.dx = -Math.abs(boss.dx);
      }

    } else if (boss.tier === 5) {
      // Slow descent + left-right (like boss 3)
      boss.x += boss.dx * dt;
      if (boss.x <= 0) {
        boss.x = 0;
        boss.dx = Math.abs(boss.dx || 30);
      } else if (boss.x + boss.width >= this.width) {
        boss.x = this.width - boss.width;
        boss.dx = -Math.abs(boss.dx || 30);
      }
      // Slowly descend, capped at 40% of height
      const maxY = this.height * 0.4;
      if (boss.y < maxY) {
        boss.y += 15 * dt;
        if (boss.y > maxY) boss.y = maxY;
      }
    }

    // Clamp x to canvas
    boss.x = Math.max(0, Math.min(boss.x, this.width - boss.width));

    // ── Shooting ──
    boss.shootTimer += dt;
    const shootIntervals = [0, 2.5, 3.0, 3.5, 2.0, 2.5];
    if (boss.shootTimer >= shootIntervals[boss.tier]) {
      boss.shootTimer = 0;
      this.bossShoot(boss);
      // Boss 5 rotates through pattern phases
      if (boss.tier === 5) {
        boss.patternPhase = (boss.patternPhase + 1) % 4;
      }
    }

    // ── Player beam collisions ──
    for (const b of this.beams) {
      if (!b.active) continue;
      if (this.collides(b, boss)) {
        b.active = false;
        boss.hp -= 1;
        // Small hit particle
        this.spawnParticles(b.x + BEAM_W / 2, b.y, this.palette.text);
        if (boss.hp <= 0) {
          this.defeatBoss(boss);
          return;
        }
      }
    }

    // ── Boss body vs player ──
    if (this.collides(boss, this.player)) {
      if (this.player.hasShield) {
        this.player.hasShield = false;
        this.spawnParticles(
          this.player.x + PLAYER_W / 2,
          this.player.y + PLAYER_H / 2,
          this.palette.shield
        );
      } else {
        this.triggerGameOver();
      }
    }
  }

  private bossShoot(boss: Boss): void {
    const bCx = boss.x + boss.width / 2;
    const bBottom = boss.y + boss.height;

    const fireBeam = (x: number, dy: number, dx = 0) => {
      this.enemyBeams.push({
        x: x - BEAM_W / 2,
        y: bBottom,
        width: BEAM_W,
        height: BEAM_H,
        active: true,
        dy,
      });
      // For angled beams we'd need dx support — store dx in the beam concept;
      // since EnemyBeam only has dy, we approximate angled beams with x offset
      void dx; // dx handled via x offset already encoded at spawn time
    };

    const effectiveTier = boss.tier === 5
      ? ((boss.patternPhase % 4) + 1) as 1 | 2 | 3 | 4
      : boss.tier;

    if (effectiveTier === 1) {
      // Single beam from center
      fireBeam(bCx, 120);

    } else if (effectiveTier === 2) {
      // 3 spread beams — we simulate angle via horizontal x offset at distance
      fireBeam(bCx, 110);
      // Left angled: spawn offset left, same dy
      fireBeam(bCx - 20, 110);
      // Right angled: spawn offset right
      fireBeam(bCx + 20, 110);

    } else if (effectiveTier === 3) {
      // 5 evenly-spaced beams across boss width
      const step = boss.width / 4;
      for (let i = 0; i <= 4; i++) {
        fireBeam(boss.x + step * i, 90);
      }

    } else if (effectiveTier === 4) {
      // Aimed beam toward player
      const px = this.player.x + PLAYER_W / 2;
      const py = this.player.y + PLAYER_H / 2;
      const angle = Math.atan2(py - bBottom, px - bCx);
      // We only have dy on EnemyBeam; spawn at x that approximates the angle
      // by offsetting x toward the player and using full speed downward
      const dist = Math.max(1, Math.abs(py - bBottom));
      const xRatio = (px - bCx) / dist;
      // Clamp xRatio to avoid extreme offsets
      const xOff = Math.max(-60, Math.min(60, xRatio * 60));
      void angle;
      fireBeam(bCx + xOff, 150);
    }
  }

  private defeatBoss(boss: Boss): void {
    // Big explosion
    const cx = boss.x + boss.width / 2;
    const cy = boss.y + boss.height / 2;
    const count = 12 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      const color = i % 3 === 0 ? this.palette.text : (i % 3 === 1 ? this.palette.jammer : this.palette.enemy);
      this.particles.push({
        x: cx + (Math.random() - 0.5) * boss.width,
        y: cy + (Math.random() - 0.5) * boss.height,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        life: 0.6 + Math.random() * 0.6,
        maxLife: 0.6 + Math.random() * 0.6,
        color,
        size: 3 + Math.random() * 5,
      });
    }

    // Guaranteed power-up drop
    this.spawnPowerUp(cx, cy);

    // Score bonus
    this.score += SCORE_BOSS * boss.tier;

    // Flash text
    this.bossDefeatFlash = 2.5;

    this.boss = null;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.dx * dt;
      p.y += p.dy * dt;
      p.life -= dt;
    }
  }

  private updateStars(dt: number): void {
    for (const s of this.stars) {
      s.y += s.speed * dt;
      if (s.y > this.height) {
        s.y = 0;
        s.x = Math.random() * this.width;
      }
    }
  }

  private triggerGameOver(): void {
    this.gameState = "GAME_OVER";
    this.isNewHighScore = false;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.isNewHighScore = true;
      try {
        localStorage.setItem(LS_KEY, String(this.highScore));
      } catch {
        // localStorage unavailable
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  private render(): void {
    const { ctx, width, height } = this;

    // 1. Background
    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, width, height);

    // 2. Stars
    for (const s of this.stars) {
      ctx.globalAlpha = s.brightness * 0.7;
      ctx.fillStyle = this.palette.textMuted;
      ctx.fillRect(s.x, s.y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    if (this.gameState === "PLAYING") {
      // 3. Shield glow around player
      if (this.player.hasShield) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = this.palette.shield;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          this.player.x + PLAYER_W / 2,
          this.player.y + PLAYER_H / 2,
          PLAYER_W * 0.9,
          0,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 4. Player: signal tower shape
      this.drawPlayer();

      // 5. Player beams (energy bolt with glow)
      for (const b of this.beams) {
        // Glow
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = this.palette.beam;
        ctx.fillRect(b.x - 1, b.y, b.width + 2, b.height);
        // Core
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.palette.beam;
        ctx.fillRect(b.x, b.y, b.width, b.height);
        // Bright center pixel
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.6;
        ctx.fillRect(b.x + 1, b.y + 1, 1, b.height - 2);
        ctx.globalAlpha = 1;
      }

      // 6. Enemies
      for (const e of this.enemies) {
        this.drawEnemy(e);
      }

      // 6b. Boss
      if (this.boss) {
        this.drawBoss(this.boss);
      }

      // 7. Enemy beams (red energy bolt)
      for (const eb of this.enemyBeams) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = this.palette.enemy;
        ctx.fillRect(eb.x - 1, eb.y, eb.width + 2, eb.height);
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.palette.enemy;
        ctx.fillRect(eb.x, eb.y, eb.width, eb.height);
      }

      // 8. Power-ups
      for (const p of this.powerUps) {
        this.drawPowerUp(p);
      }
    }

    // 9. Particles (shown during game and game-over for ambience)
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (this.gameState === "PLAYING") {
      // 10. HUD
      this.drawHUD();

      // 11. Power-up indicators
      this.drawPowerUpIndicators();

      // 12. Boss HP bar
      if (this.boss) {
        this.drawBossHP(this.boss);
      }

      // 13. Boss defeated flash
      if (this.bossDefeatFlash > 0) {
        const alpha = Math.min(1, this.bossDefeatFlash);
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = this.palette.jammer;
        ctx.font = "bold 22px monospace";
        ctx.fillText("BOSS DEFEATED", width / 2, height / 2 - 40);
        ctx.globalAlpha = 1;
      }
    }

    // 14. Game over overlay
    if (this.gameState === "GAME_OVER") {
      this.drawGameOver();
    }
  }

  private drawPlayer(): void {
    const { ctx } = this;
    const { x, y } = this.player;

    // Draw pre-rendered ship sprite
    ctx.drawImage(this.spritePlayer, x, y);

    // Draw animated engine flame below the ship
    const flame = this.spriteFlames[this.flameFrame];
    const flameX = x + PLAYER_W / 2 - flame.width / 2;
    const flameY = y + PLAYER_H - 2;
    ctx.drawImage(flame, flameX, flameY);
  }

  private drawEnemy(e: Enemy): void {
    const { ctx } = this;
    const sprite =
      e.type === "jammer" ? this.spriteJammer
        : e.type === "swerver" ? this.spriteSwerver
        : this.spriteMeteor;
    ctx.drawImage(sprite, e.x, e.y);

    // Damage flash: if jammer has taken 1 hit (hp=1 of 2), flash briefly
    if (e.type === "jammer" && e.hp === 1) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(e.x, e.y, e.width, e.height);
      ctx.globalAlpha = 1;
    }
  }

  private drawPowerUp(p: PowerUp): void {
    const { ctx } = this;
    const sprite =
      p.type === "rapid"
        ? this.spritePuRapid
        : p.type === "shield"
          ? this.spritePuShield
          : this.spritePuSpread;

    // Pulsing glow behind the sprite
    const pulse = 0.2 + Math.sin(this.lastTime / 200) * 0.1;
    const color =
      p.type === "rapid"
        ? this.palette.powerUp
        : p.type === "shield"
          ? this.palette.shield
          : this.palette.spread;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(
      p.x + POWERUP_W / 2,
      p.y + POWERUP_H / 2,
      POWERUP_W / 2 + 3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;

    // Draw the pixel art icon
    ctx.drawImage(sprite, p.x, p.y);
  }

  private drawBoss(boss: Boss): void {
    const { ctx } = this;
    const sprites: OffscreenCanvas[] = [
      this.spriteBoss1, // index 0 unused via [tier] indexing
      this.spriteBoss1,
      this.spriteBoss2,
      this.spriteBoss3,
      this.spriteBoss4,
      this.spriteBoss5,
    ];
    const sprite = sprites[boss.tier];
    ctx.drawImage(sprite, Math.round(boss.x), Math.round(boss.y));

    // Damage flash when hp < 30% of max
    if (boss.hp / boss.maxHp < 0.3) {
      ctx.globalAlpha = 0.25 + Math.sin(this.lastTime / 80) * 0.15;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(boss.x, boss.y, boss.width, boss.height);
      ctx.globalAlpha = 1;
    }
  }

  private drawBossHP(boss: Boss): void {
    const { ctx, width } = this;
    const margin = 16;
    const barY = 48;
    const barH = 6;
    const barW = width - margin * 2;
    const fillW = Math.max(0, (boss.hp / boss.maxHp) * barW);

    // Background track
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.palette.textMuted;
    ctx.fillRect(margin, barY, barW, barH);
    ctx.globalAlpha = 1;

    // HP fill — color shifts red as hp drops
    const hpRatio = boss.hp / boss.maxHp;
    const fillColor = hpRatio > 0.5 ? this.palette.jammer : this.palette.enemy;
    ctx.fillStyle = fillColor;
    ctx.fillRect(margin, barY, fillW, barH);

    // Boss name label
    const bossNames = ["", "SIGNAL DISRUPTOR", "FREQUENCY JAMMER", "BAND BLOCKER", "NETWORK NULLIFIER", "CORE CORRUPTOR"];
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = fillColor;
    ctx.font = "bold 10px monospace";
    ctx.fillText(`⚠ ${bossNames[boss.tier]}  ${boss.hp}/${boss.maxHp}`, width / 2, barY - 2);
  }

  private drawHUD(): void {
    const { ctx, width } = this;

    // Score — top left
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText("SCORE", 12, 10);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 14px monospace";
    ctx.fillText(String(this.score), 12, 23);

    // High score — top right
    ctx.textAlign = "right";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText("BEST", width - 12, 10);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 14px monospace";
    ctx.fillText(String(this.highScore), width - 12, 23);

    // Wave — top center
    ctx.textAlign = "center";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText("WAVE", width / 2, 10);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 14px monospace";
    ctx.fillText(String(this.wave), width / 2, 23);
  }

  private drawPowerUpIndicators(): void {
    const { ctx, width } = this;
    const now = this.lastTime;
    let yOffset = 44;

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "11px monospace";

    if (now < this.player.rapidFireUntil) {
      const remaining = ((this.player.rapidFireUntil - now) / 1000).toFixed(1);
      ctx.fillStyle = this.palette.powerUp;
      ctx.fillText(`⚡ RAPID FIRE ${remaining}s`, 12, yOffset);
      yOffset += 14;
    }

    if (now < this.player.spreadShotUntil) {
      const remaining = ((this.player.spreadShotUntil - now) / 1000).toFixed(1);
      ctx.fillStyle = this.palette.spread;
      ctx.fillText(`◈ SPREAD ${remaining}s`, 12, yOffset);
    }

    // Shield indicator top-right
    if (this.player.hasShield) {
      ctx.textAlign = "right";
      ctx.fillStyle = this.palette.shield;
      ctx.fillText("◉ SHIELD", width - 12, 44);
    }

    ctx.textAlign = "left";
  }

  private drawGameOver(): void {
    const { ctx, width, height } = this;

    // Semi-transparent overlay
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    const centerX = width / 2;
    const centerY = height / 2;

    // "GAME OVER" title
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 32px monospace";
    ctx.fillText("GAME OVER", centerX, centerY - 60);

    // Score
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText("SCORE", centerX, centerY - 20);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 24px monospace";
    ctx.fillText(String(this.score), centerX, centerY + 4);

    // New high score message
    if (this.isNewHighScore) {
      ctx.fillStyle = this.palette.powerUp;
      ctx.font = "bold 14px monospace";
      ctx.fillText("★ NEW HIGH SCORE ★", centerX, centerY + 34);
    } else {
      ctx.fillStyle = this.palette.textMuted;
      ctx.font = "11px monospace";
      ctx.fillText(`BEST: ${this.highScore}`, centerX, centerY + 34);
    }

    // Retry prompt
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText("Enter to retry  •  Esc to exit", centerX, centerY + 66);
  }

  // ─── AABB collision ──────────────────────────────────────────────────────────

  private collides(a: Entity, b: Entity): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  // ─── Restart ─────────────────────────────────────────────────────────────────

  private restart(): void {
    this.gameState = "PLAYING";
    this.score = 0;
    this.wave = 1;
    this.waveTimer = 0;
    this.survivalTimer = 0;
    this.spawnTimer = 0;
    this.lastTime = 0;
    this.isNewHighScore = false;

    this.beams = [];
    this.enemies = [];
    this.enemyBeams = [];
    this.powerUps = [];
    this.particles = [];
    this.boss = null;
    this.bossDefeatFlash = 0;

    this.initPlayer();
    // Re-scatter stars
    this.initStars();
  }
}

// Re-export public types so signal-storm-game.tsx import still resolves from here
export type { GamePalette, GameCallbacks } from "./signal-storm-types";

import type {
  GamePalette,
  GameCallbacks,
  Entity,
  Player,
  Beam,
  Enemy,
  EnemyBeam,
  Boss,
  PowerUp,
  Particle,
  Star,
  GameState,
  SpriteAtlas,
} from "./signal-storm-types";

import { preRenderAllSprites } from "./signal-storm-sprites";

import {
  // Size constants needed for spawn x-clamping
  ENEMY_W,
  JAMMER_W,
  SWERVER_W,
  SPLITTER_W,
  SNIPER_W,
  // Spawn functions
  spawnInterference,
  spawnJammer,
  spawnSwerver,
  spawnSplitter,
  spawnSniper,
  spawnOrbiter,
  spawnDroneSwarm,
  spawnSplitterShards,
  // Update / draw / score
  updateEnemy,
  drawEnemy,
  enemyScore,
  pickEnemyType,
  // Chain-kill bonus
  SCORE_DRONE_CHAIN_BONUS,
} from "./signal-storm-enemies";

import { GameAudio } from "./signal-storm-audio";

import {
  spawnBoss,
  updateBoss as updateBossModule,
  drawBoss as drawBossModule,
  drawBossTelegraph,
  drawBossHpBar,
  drawBossIntroBanner,
  checkPhaseTransition,
  BOSS_WAVE_INTERVAL,
  SCORE_BOSS,
} from "./signal-storm-bosses";

import type { GameLabels } from "./signal-storm-labels";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_SPEED = 200;
const PLAYER_SHOOT_COOLDOWN = 300;
const RAPID_FIRE_COOLDOWN = 150;
const BEAM_SPEED = -350;
const POWERUP_FALL_SPEED = 50;
const SPAWN_BASE_INTERVAL = 2000;
const SPAWN_INTERVAL_DECREASE = 150;
const SPAWN_MIN_INTERVAL = 500;
const POWERUP_DROP_RATE = 0.1;
const WAVE_DURATION = 30;
const SCORE_SURVIVAL = 1;

const PLAYER_W = 24;
const PLAYER_H = 28;
const BEAM_W = 3;
const BEAM_H = 10;
const POWERUP_W = 14;
const POWERUP_H = 14;

const RAPID_FIRE_DURATION = 5000;
const SPREAD_SHOT_DURATION = 5000;
const SPREAD_ANGLE = 0.3; // radians off-axis for spread

const LS_KEY = "qm_game_highscore";

// ─── Engine ───────────────────────────────────────────────────────────────────

export class SignalStormEngine {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private palette: GamePalette;
  private callbacks: GameCallbacks;

  private audio: GameAudio = new GameAudio();
  private audioStarted = false;

  private keys: Set<string> = new Set();
  private gameState: GameState = "PLAYING";

  private player!: Player;
  private beams: Beam[] = [];
  private enemies: Enemy[] = [];
  private enemyBeams: EnemyBeam[] = [];
  private powerUps: PowerUp[] = [];
  private particles: Particle[] = [];
  private stars: Star[] = [];

  // Pre-rendered sprite atlas
  private sprites!: SpriteAtlas;
  private flameFrame = 0;
  private flameTimer = 0;

  private boss: Boss | null = null;
  private bossDefeatFlash = 0;
  private shakeUntil = 0;
  private shakeMagnitude = 0;
  private pauseOverlayStartTime = 0;

  private onWindowBlur = () => {
    if (this.gameState === "PLAYING") {
      this.gameState = "PAUSED";
      this.pauseOverlayStartTime = performance.now();
      this.audio.pauseAudio();
    }
  };

  private score = 0;
  private highScore = 0;
  private wave = 1;
  private waveTimer = 0;
  private survivalTimer = 0;
  private spawnTimer = 0;
  private lastTime = 0;
  private isNewHighScore = false;
  private labels: GameLabels;

  constructor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: GamePalette,
    callbacks: GameCallbacks,
    labels: GameLabels
  ) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.callbacks = callbacks;
    this.labels = labels;

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
    this.sprites = preRenderAllSprites(this.palette);

    window.addEventListener("blur", this.onWindowBlur);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  public handleKeyDown(key: string): void {
    // Lazy audio init on first key press (requires user gesture)
    if (!this.audioStarted) {
      this.audioStarted = true;
      this.audio.ensureContext();
      this.audio.startMusic("normal");
    }

    // Mute toggle
    if (key === "m" || key === "M") {
      this.audio.toggleMute();
      return;
    }

    // Pause toggle
    if (key === "p" || key === "P") {
      if (this.gameState === "PLAYING") {
        this.gameState = "PAUSED";
        this.pauseOverlayStartTime = performance.now();
        this.audio.pauseAudio();
      } else if (this.gameState === "PAUSED") {
        this.gameState = "PLAYING";
        this.audio.resumeAudio();
      }
      return;
    }

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
      lives: 3,
      invincibleUntil: 0,
      respawnFreezeUntil: 0,
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

  // ─── Update ──────────────────────────────────────────────────────────────────

  private update(timestamp: number): void {
    if (this.gameState === "PAUSED") {
      return;
    }

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
    const frozen = timestamp < this.player.respawnFreezeUntil;
    const isRapid = timestamp < this.player.rapidFireUntil;
    const isSpread = timestamp < this.player.spreadShotUntil;

    if (!frozen) {
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

    // ── Move enemies + per-type logic ──
    for (const e of this.enemies) {
      const result = updateEnemy(e, dt, timestamp, this.player, this.width, this.height);
      if (result.fireBeam) {
        const fb = result.fireBeam;
        this.pushEnemyBeam(fb.x, fb.y, fb.dx, fb.dy);
      }
    }

    // ── Move enemy beams ──
    for (const eb of this.enemyBeams) {
      eb.y += eb.dy * dt;
      eb.x += eb.dx * dt;
      if (eb.y > this.height || eb.x + eb.width < 0 || eb.x > this.width) eb.active = false;
    }

    // ── Collision: player beams vs enemies ──
    for (const b of this.beams) {
      if (!b.active) continue;
      for (const e of this.enemies) {
        if (!e.active) continue;
        if (this.collides(b, e)) {
          b.active = false;
          e.hp -= 1;
          this.audio.playHit();
          if (e.hp <= 0) {
            e.active = false;
            this.audio.playExplode();
            this.score += enemyScore(e.type);
            // Splitter: spawn shards on death
            if (e.type === "splitter") {
              for (const shard of spawnSplitterShards(e)) {
                this.enemies.push(shard);
              }
            }
            // Drone: check for full-swarm chain bonus
            if (e.type === "drone") {
              this.tryAwardSwarmBonus(e.swarmId);
            }
            const particleColor =
              e.type === "jammer" || e.type === "sniper"
                ? this.palette.jammer
                : e.type === "swerver" || e.type === "orbiter"
                  ? this.palette.shield
                  : e.type === "drone"
                    ? this.palette.spread
                    : this.palette.enemy;
            this.spawnParticles(
              e.x + e.width / 2,
              e.y + e.height / 2,
              particleColor
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
      if (timestamp < this.player.invincibleUntil) continue;
      if (this.collides(e, this.player)) {
        // Enemy is destroyed on contact (shield or not)
        e.active = false;
        this.spawnParticles(e.x + e.width / 2, e.y + e.height / 2, this.palette.shield);
        if (!this.handlePlayerHit(timestamp)) return;
      }
    }

    // ── Collision: enemy beams vs player ──
    for (const eb of this.enemyBeams) {
      if (!eb.active) continue;
      if (timestamp < this.player.invincibleUntil) continue;
      if (this.collides(eb, this.player)) {
        eb.active = false;
        if (!this.handlePlayerHit(timestamp)) return;
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
      this.flameFrame = (this.flameFrame + 1) % this.sprites.flames.length;
    }

    // ── Wave timer ──
    this.waveTimer += dt;
    if (this.waveTimer >= WAVE_DURATION) {
      this.wave += 1;
      this.waveTimer = 0;
      // Spawn a boss at the start of every BOSS_WAVE_INTERVAL wave
      if (this.wave % BOSS_WAVE_INTERVAL === 0 && !this.boss) {
        this.doSpawnBoss();
      }
    }

    // ── Boss defeat flash countdown ──
    if (this.bossDefeatFlash > 0) {
      this.bossDefeatFlash -= dt;
    }

    // ── Boss update ──
    if (this.boss) {
      const bossResult = updateBossModule(this.boss, dt, timestamp, this.player, this.width, this.height);
      for (const beam of bossResult.beamsToFire) {
        this.enemyBeams.push({
          x: beam.x - (beam.width ?? BEAM_W) / 2,
          y: beam.y,
          width: beam.width ?? BEAM_W,
          height: beam.height ?? BEAM_H,
          active: true,
          dx: beam.dx,
          dy: beam.dy,
        });
      }
      for (const shake of bossResult.shakeEvents) {
        this.triggerShake(shake.magnitude, shake.duration, timestamp);
      }

      // ── Player beam collisions with boss ──
      for (const b of this.beams) {
        if (!b.active) continue;
        if (this.collides(b, this.boss)) {
          b.active = false;
          this.boss.hp -= 1;
          this.boss.flashUntil = timestamp + 80;
          this.triggerShake(2, 80, timestamp);
          this.audio.playBossHit();
          this.spawnParticles(b.x + BEAM_W / 2, b.y, this.palette.text);
          const phaseEvent = checkPhaseTransition(this.boss, timestamp);
          if (phaseEvent) {
            this.audio.playPhaseTransition();
            this.triggerShake(phaseEvent.shakeMagnitude, phaseEvent.shakeDuration, timestamp);
            this.spawnParticles(this.boss.x + this.boss.width / 2, this.boss.y + this.boss.height / 2, "#ffffff");
          }
          if (this.boss.hp <= 0) {
            this.defeatBoss(this.boss);
            break;
          }
        }
      }

      // ── Boss body vs player ──
      if (this.boss && timestamp >= this.player.invincibleUntil && this.collides(this.boss, this.player)) {
        if (!this.handlePlayerHit(timestamp)) return;
      }
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
    this.audio.playShoot();
  }

  private spawnEnemy(timestamp: number): void {
    const token = pickEnemyType(this.wave, this.countAlive("sniper"));

    if (token === "drone_swarm") {
      const drones = spawnDroneSwarm(this.width);
      for (const d of drones) this.enemies.push(d);
      return;
    }

    if (token === "interference") {
      const x = Math.random() * (this.width - ENEMY_W);
      this.enemies.push(spawnInterference(x, this.wave));
    } else if (token === "jammer") {
      const x = Math.random() * (this.width - JAMMER_W);
      this.enemies.push(spawnJammer(x, this.wave, timestamp));
    } else if (token === "swerver") {
      const x = Math.random() * (this.width - SWERVER_W);
      this.enemies.push(spawnSwerver(x, this.wave));
    } else if (token === "splitter") {
      const x = Math.random() * (this.width - SPLITTER_W);
      this.enemies.push(spawnSplitter(x, this.wave));
    } else if (token === "sniper") {
      const x = Math.random() * (this.width - SNIPER_W);
      this.enemies.push(spawnSniper(x));
    } else if (token === "orbiter") {
      this.enemies.push(spawnOrbiter(this.width, this.height, timestamp));
    }
  }

  private countAlive(type: string): number {
    return this.enemies.filter((e) => e.active && e.type === type).length;
  }

  private pushEnemyBeam(x: number, y: number, dx: number, dy: number): void {
    this.enemyBeams.push({
      x: x - BEAM_W / 2,
      y,
      width: BEAM_W,
      height: BEAM_H,
      active: true,
      dy,
      dx,
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
    this.audio.playPowerUp();
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

  private doSpawnBoss(): void {
    const tier = (((this.wave / BOSS_WAVE_INTERVAL) - 1) % 5 + 1) as 1 | 2 | 3 | 4 | 5;
    this.boss = spawnBoss(tier, this.wave, this.width, performance.now(), this.labels);
    this.audio.playBossIntro();
    this.audio.startMusic("boss");
  }

  private triggerShake(magnitude: number, duration: number, timestamp: number): void {
    this.shakeUntil = Math.max(this.shakeUntil, timestamp + duration);
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
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

    this.triggerShake(6, 400, performance.now());

    this.boss = null;
    this.audio.startMusic("normal");
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

  private handlePlayerHit(timestamp: number): boolean {
    // Check shield first
    if (this.player.hasShield) {
      this.player.hasShield = false;
      this.audio.playShieldBreak();
      this.spawnParticles(
        this.player.x + PLAYER_W / 2,
        this.player.y + PLAYER_H / 2,
        this.palette.shield,
      );
      return true;
    }

    // Check i-frames
    if (timestamp < this.player.invincibleUntil) {
      return true;
    }

    this.player.lives -= 1;

    if (this.player.lives <= 0) {
      this.triggerGameOver();
      return false;
    }

    // Respawn
    this.audio.playPlayerHit();
    this.spawnParticles(this.player.x + PLAYER_W / 2, this.player.y + PLAYER_H / 2, this.palette.enemy);
    this.triggerShake(3, 150, timestamp);
    this.player.respawnFreezeUntil = timestamp + 800;
    this.player.invincibleUntil = timestamp + 2800; // 800ms freeze + 2000ms active i-frames
    return true;
  }

  private triggerGameOver(): void {
    this.gameState = "GAME_OVER";
    this.audio.stopMusic();
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
    const now = performance.now();

    // 1. Background
    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, width, height);

    // ── Shake transform: wraps all playfield content (not HUD) ──
    ctx.save();
    if (now < this.shakeUntil) {
      const sx = (Math.random() - 0.5) * 2 * this.shakeMagnitude;
      const sy = (Math.random() - 0.5) * 2 * this.shakeMagnitude;
      ctx.translate(sx, sy);
    } else {
      this.shakeMagnitude = 0;
    }

    // 2. Stars
    for (const s of this.stars) {
      ctx.globalAlpha = s.brightness * 0.7;
      ctx.fillStyle = this.palette.textMuted;
      ctx.fillRect(s.x, s.y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    if (this.gameState === "PLAYING" || this.gameState === "PAUSED") {
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
        drawEnemy(e, this.ctx, this.sprites);
      }

      // 6b. Boss + telegraph
      if (this.boss) {
        const timestamp = this.lastTime;
        drawBossModule(this.boss, this.ctx, this.sprites, timestamp);
        drawBossTelegraph(this.boss, this.ctx, timestamp);
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

    // ── End shake transform ──
    ctx.restore();

    // HUD and overlays are outside shake so they never jitter
    if (this.gameState === "PLAYING" || this.gameState === "PAUSED") {
      // 10. HUD
      this.drawHUD();

      // 10b. Lives HUD
      this.drawLivesHud();

      // 11. Power-up indicators
      this.drawPowerUpIndicators();

      // 12. Boss HP bar + intro banner
      if (this.boss) {
        const timestamp = this.lastTime;
        drawBossHpBar(this.boss, this.ctx, this.width, this.palette);
        drawBossIntroBanner(this.boss, this.ctx, this.width, this.height, this.palette, timestamp);
      }

      // 13. Boss defeated flash
      if (this.bossDefeatFlash > 0) {
        const alpha = Math.min(1, this.bossDefeatFlash);
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = this.palette.jammer;
        ctx.font = "bold 22px monospace";
        ctx.fillText(this.labels.boss_defeated, width / 2, height / 2 - 40);
        ctx.globalAlpha = 1;
      }

      // 14. Mute indicator
      if (this.audio.isMuted()) {
        ctx.save();
        ctx.fillStyle = this.palette.textMuted;
        ctx.font = "10px monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(this.labels.muted, width - 12, 12);
        ctx.restore();
      }
    }

    // 15. Game over overlay
    if (this.gameState === "GAME_OVER") {
      this.drawGameOver();
    }

    // 16. Pause overlay
    if (this.gameState === "PAUSED") {
      const fadeT = Math.min(1, (now - this.pauseOverlayStartTime) / 1000);
      ctx.save();
      ctx.globalAlpha = 0.6 * fadeT;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = fadeT;
      ctx.fillStyle = this.palette.text;
      ctx.font = "bold 32px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.labels.pause.title, width / 2, height / 2 - 10);
      ctx.fillStyle = this.palette.textMuted;
      ctx.font = "14px monospace";
      ctx.fillText(this.labels.pause.resume_hint, width / 2, height / 2 + 24);
      ctx.restore();
    }
  }

  private drawPlayer(): void {
    const { ctx } = this;
    const { x, y } = this.player;
    const timestamp = this.lastTime;

    let playerAlpha = 1;
    if (timestamp < this.player.respawnFreezeUntil) {
      playerAlpha = 0.5;
    } else if (timestamp < this.player.invincibleUntil) {
      playerAlpha = Math.floor(timestamp / 100) % 2 === 0 ? 1.0 : 0.6;
    }

    ctx.save();
    ctx.globalAlpha = playerAlpha;

    // Draw pre-rendered ship sprite
    ctx.drawImage(this.sprites.player, x, y);

    // Draw animated engine flame below the ship
    const flame = this.sprites.flames[this.flameFrame];
    const flameX = x + PLAYER_W / 2 - flame.width / 2;
    const flameY = y + PLAYER_H - 2;
    ctx.drawImage(flame, flameX, flameY);

    ctx.restore();
  }

  private drawLivesHud(): void {
    for (let i = 0; i < 3; i++) {
      const heart = i < this.player.lives ? this.sprites.heartFull : this.sprites.heartEmpty;
      this.ctx.drawImage(heart, 16 + i * 22, 40);
    }
  }

  private tryAwardSwarmBonus(swarmId: number): void {
    // Award bonus only if every drone in the swarm is dead AND none escaped
    const swarmDrones = this.enemies.filter((e) => e.swarmId === swarmId);
    const anyAlive = swarmDrones.some((e) => e.active);
    const anyEscaped = swarmDrones.some((e) => !e.swarmSurvived);
    if (!anyAlive && !anyEscaped) {
      this.score += SCORE_DRONE_CHAIN_BONUS;
    }
  }

  private drawPowerUp(p: PowerUp): void {
    const { ctx } = this;
    const sprite =
      p.type === "rapid"
        ? this.sprites.puRapid
        : p.type === "shield"
          ? this.sprites.puShield
          : this.sprites.puSpread;

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

  private drawHUD(): void {
    const { ctx, width } = this;

    // Score — top left
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(this.labels.hud.score, 12, 10);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 14px monospace";
    ctx.fillText(String(this.score), 12, 23);

    // High score — top right
    ctx.textAlign = "right";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(this.labels.hud.best, width - 12, 10);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 14px monospace";
    ctx.fillText(String(this.highScore), width - 12, 23);

    // Wave — top center
    ctx.textAlign = "center";
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(this.labels.hud.wave, width / 2, 10);
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
      ctx.fillText(`${this.labels.power_ups.rapid_fire} ${remaining}s`, 12, yOffset);
      yOffset += 14;
    }

    if (now < this.player.spreadShotUntil) {
      const remaining = ((this.player.spreadShotUntil - now) / 1000).toFixed(1);
      ctx.fillStyle = this.palette.spread;
      ctx.fillText(`${this.labels.power_ups.spread} ${remaining}s`, 12, yOffset);
    }

    // Shield indicator top-right
    if (this.player.hasShield) {
      ctx.textAlign = "right";
      ctx.fillStyle = this.palette.shield;
      ctx.fillText(this.labels.power_ups.shield, width - 12, 44);
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
    ctx.fillText(this.labels.game_over.title, centerX, centerY - 60);

    // Score
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(this.labels.game_over.score_label, centerX, centerY - 20);
    ctx.fillStyle = this.palette.text;
    ctx.font = "bold 24px monospace";
    ctx.fillText(String(this.score), centerX, centerY + 4);

    // New high score message
    if (this.isNewHighScore) {
      ctx.fillStyle = this.palette.powerUp;
      ctx.font = "bold 14px monospace";
      ctx.fillText(this.labels.game_over.new_high_score, centerX, centerY + 34);
    } else {
      ctx.fillStyle = this.palette.textMuted;
      ctx.font = "11px monospace";
      ctx.fillText(`${this.labels.game_over.best_prefix} ${this.highScore}`, centerX, centerY + 34);
    }

    // Retry prompt
    ctx.fillStyle = this.palette.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(this.labels.game_over.controls_hint, centerX, centerY + 66);
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
    this.shakeUntil = 0;
    this.shakeMagnitude = 0;
    this.pauseOverlayStartTime = 0;

    this.initPlayer();
    // Re-scatter stars
    this.initStars();
    this.audio.startMusic("normal");
  }

  // ─── Dispose ─────────────────────────────────────────────────────────────────

  public dispose(): void {
    this.audio.dispose();
    window.removeEventListener("blur", this.onWindowBlur);
  }
}

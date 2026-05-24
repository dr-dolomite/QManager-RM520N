// ─── Signal Storm boss system ─────────────────────────────────────────────────
// 3-phase bosses with telegraphs, intro banners, and per-tier attack patterns.

import type {
  Boss,
  GamePalette,
  SpriteAtlas,
} from "./signal-storm-types";
import type { GameLabels } from "./signal-storm-labels";
import {
  BOSS1_W, BOSS1_H,
  BOSS2_W, BOSS2_H,
  BOSS3_W, BOSS3_H,
  BOSS4_W, BOSS4_H,
  BOSS5_W, BOSS5_H,
} from "./signal-storm-sprites";

// ─── Constants ───────────────────────────────────────────────────────────────

export const BOSS_ENTER_Y = 60;
export const BOSS_WAVE_INTERVAL = 5;
export const SCORE_BOSS = 100;

// Vertical bob — gentle sine oscillation layered on top of horizontal motion
const BOSS_BOB_AMPLITUDE = 24; // px — peak vertical offset from BOSS_ENTER_Y
const BOSS_BOB_PERIOD = 5.5;   // seconds for one full oscillation

// Diagonal dash — how far below BOSS_ENTER_Y tier 2 / tier 4 bosses can steer
const BOSS_DIAG_Y_MIN = BOSS_ENTER_Y;
const BOSS_DIAG_Y_MAX = BOSS_ENTER_Y + 70;

// ─── Result types ────────────────────────────────────────────────────────────

export interface BossUpdateResult {
  beamsToFire: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    width?: number;
    height?: number;
  }>;
  shakeEvents: Array<{ magnitude: number; duration: number }>;
}

export interface BossPhaseTransitionEvent {
  newPhase: 2 | 3;
  shakeMagnitude: number;
  shakeDuration: number;
}

// ─── Intro banner timeline ───────────────────────────────────────────────────

const BANNER_SLIDE_IN = 400;
const BANNER_HOLD = 1400;
const BANNER_SLIDE_OUT = 400;
const BANNER_TOTAL = BANNER_SLIDE_IN + BANNER_HOLD + BANNER_SLIDE_OUT; // 2200ms

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

export function spawnBoss(
  tier: 1 | 2 | 3 | 4 | 5,
  wave: number,
  canvasWidth: number,
  timestamp: number,
  labels: GameLabels,
): Boss {
  const cycleNumber = Math.floor((wave - 1) / 25);
  const baseHp = [0, 8, 12, 14, 10, 18][tier];
  const hp = baseHp + cycleNumber * 6;

  // Indexes 1..5 match boss tier; 0 is a placeholder so index lookups match tier.
  const widths  = [0, BOSS1_W, BOSS2_W, BOSS3_W, BOSS4_W, BOSS5_W];
  const heights = [0, BOSS1_H, BOSS2_H, BOSS3_H, BOSS4_H, BOSS5_H];
  const w = widths[tier];
  const h = heights[tier];

  return {
    x: canvasWidth / 2 - w / 2,
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
    targetX: canvasWidth / 2 - w / 2,
    targetY: BOSS_ENTER_Y,
    dx: 0,
    name: labels.boss_names[tier],
    phase: 1,
    phaseJustChanged: false,
    phaseFreezeUntil: 0,
    amplitude: 0,
    period: 0,
    telegraphUntil: 0,
    telegraphDuration: 0,
    telegraphOrigin: null,
    telegraphType: "dot",
    telegraphAimX: 0,
    trailDistAccum: 0,
    flashUntil: 0,
    introBanner: {
      phase: 1,
      startTime: timestamp,
      name: labels.boss_names[tier],
      subtitle: labels.boss_subtitles[tier],
    },
  };
}

// ─── Phase transitions ───────────────────────────────────────────────────────

export function checkPhaseTransition(
  boss: Boss,
  timestamp: number,
): BossPhaseTransitionEvent | null {
  const ratio = boss.hp / boss.maxHp;

  if (boss.phase === 1 && ratio <= 0.66) {
    boss.phase = 2;
    boss.phaseJustChanged = true;
    boss.phaseFreezeUntil = timestamp + 400;
    boss.flashUntil = timestamp + 200;
    boss.shootTimer = 0;
    return { newPhase: 2, shakeMagnitude: 4, shakeDuration: 250 };
  }

  if (boss.phase === 2 && ratio <= 0.33) {
    boss.phase = 3;
    boss.phaseJustChanged = true;
    boss.phaseFreezeUntil = timestamp + 400;
    boss.flashUntil = timestamp + 200;
    boss.shootTimer = 0;
    return { newPhase: 3, shakeMagnitude: 4, shakeDuration: 250 };
  }

  return null;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export function updateBoss(
  boss: Boss,
  dt: number,
  timestamp: number,
  player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): BossUpdateResult {
  const result: BossUpdateResult = { beamsToFire: [], shakeEvents: [] };

  // 1. Update intro banner animation
  if (boss.introBanner) {
    const elapsed = timestamp - boss.introBanner.startTime;
    if (elapsed >= BANNER_TOTAL) {
      boss.introBanner = null;
      boss.entered = true;
    }
  }

  // 2. Entry descent
  if (!boss.entered) {
    boss.y += 80 * dt;
    if (boss.y >= BOSS_ENTER_Y) {
      boss.y = BOSS_ENTER_Y;
      // Don't set entered yet — wait for banner to finish
      if (!boss.introBanner) {
        boss.entered = true;
      }
    }
    return result;
  }

  // 3. Phase freeze
  if (timestamp < boss.phaseFreezeUntil) {
    return result;
  }

  // 4. Clear phaseJustChanged
  boss.phaseJustChanged = false;

  // 5. Dispatch to per-tier update
  switch (boss.tier) {
    case 1:
      updateTier1(boss, dt, timestamp, player, canvasWidth, result);
      break;
    case 2:
      updateTier2(boss, dt, timestamp, player, canvasWidth, result);
      break;
    case 3:
      updateTier3(boss, dt, timestamp, player, canvasWidth, canvasHeight, result);
      break;
    case 4:
      updateTier4(boss, dt, timestamp, player, canvasWidth, result);
      break;
    case 5:
      updateTier5(boss, dt, timestamp, player, canvasWidth, canvasHeight, result);
      break;
  }

  // Clamp x to canvas
  boss.x = Math.max(0, Math.min(boss.x, canvasWidth - boss.width));

  return result;
}

// ─── Per-tier update functions ────────────────────────────────────────────────

/**
 * Apply a gentle vertical sine bob to a boss. Uses `boss.moveTimer` as the
 * driving clock so each boss's bob progresses independently and survives
 * `moveTimer` being advanced by the tier update that called this.
 *
 * Intentionally bobs BELOW `BOSS_ENTER_Y` only (never above) so the boss never
 * dips behind the HP bar or intro banner area.
 */
function applyBossVerticalBob(boss: Boss): void {
  const phase = boss.moveTimer * (2 * Math.PI / BOSS_BOB_PERIOD);
  // sin is in [-1, 1]; shift to [0, 1] so the boss only moves downward from its park line.
  const offset = (Math.sin(phase) + 1) * 0.5 * BOSS_BOB_AMPLITUDE;
  boss.y = BOSS_ENTER_Y + offset;
}

// Helper: emit a beam from boss center-bottom
function beamFromBoss(
  boss: Boss,
  dx: number,
  dy: number,
  width?: number,
  height?: number,
): BossUpdateResult["beamsToFire"][0] {
  return {
    x: boss.x + boss.width / 2,
    y: boss.y + boss.height,
    dx,
    dy,
    width,
    height,
  };
}

function setTelegraph(
  boss: Boss,
  timestamp: number,
  durationMs: number,
  type: "dot" | "line" | "ring",
  aimX?: number,
): void {
  boss.telegraphUntil = timestamp + durationMs;
  boss.telegraphDuration = durationMs;
  boss.telegraphOrigin = {
    x: boss.x + boss.width / 2,
    y: boss.y + boss.height,
  };
  boss.telegraphType = type;
  if (aimX !== undefined) {
    boss.telegraphAimX = aimX;
  }
}

/** Clear telegraph state after beams have fired. */
function clearTelegraph(boss: Boss): void {
  boss.telegraphUntil = 0;
  boss.telegraphDuration = 0;
  boss.telegraphOrigin = null;
}

// ── T1 — Signal Disruptor ───────────────────────────────────────────────────

function updateTier1(
  boss: Boss,
  dt: number,
  timestamp: number,
  player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  result: BossUpdateResult,
): void {
  const centerX = canvasWidth / 2 - boss.width / 2;
  boss.moveTimer += dt;
  applyBossVerticalBob(boss);

  if (boss.phase === 1) {
    const period = 8;
    const amplitude = 50 / (2 * Math.PI / period);
    boss.x = centerX + Math.sin(boss.moveTimer * (2 * Math.PI / period)) * amplitude;

    boss.shootTimer += dt;
    // Fire phase — telegraph expired
    if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
      clearTelegraph(boss);
      boss.shootTimer = 0;
      result.beamsToFire.push(beamFromBoss(boss, 0, 120));
    } else if (boss.shootTimer >= 2.5 && boss.telegraphUntil === 0) {
      // Telegraph phase
      setTelegraph(boss, timestamp, 300, "dot");
    }
  } else if (boss.phase === 2) {
    const period = 5;
    const amplitude = 90 / (2 * Math.PI / period);
    boss.x = centerX + Math.sin(boss.moveTimer * (2 * Math.PI / period)) * amplitude;

    boss.shootTimer += dt;
    if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
      clearTelegraph(boss);
      boss.shootTimer = 0;
      const speed = 130;
      result.beamsToFire.push(beamFromBoss(boss, 0, speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(-0.3) * speed, Math.cos(-0.3) * speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(0.3) * speed, Math.cos(0.3) * speed));
    } else if (boss.shootTimer >= 2.2 && boss.telegraphUntil === 0) {
      setTelegraph(boss, timestamp, 300, "dot");
    }
  } else {
    // Phase 3: Hunt player at 110 px/s
    const playerCx = player.x + player.width / 2;
    const bossCx = boss.x + boss.width / 2;
    const diff = playerCx - bossCx;
    const maxStep = 110 * dt;
    if (Math.abs(diff) > maxStep) {
      boss.x += Math.sign(diff) * maxStep;
    } else {
      boss.x += diff;
    }

    boss.shootTimer += dt;
    if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
      clearTelegraph(boss);
      boss.shootTimer = 0;
      const speed = 140;
      result.beamsToFire.push(beamFromBoss(boss, 0, speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(-0.3) * speed, Math.cos(-0.3) * speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(0.3) * speed, Math.cos(0.3) * speed));
    } else if (boss.shootTimer >= 1.5 && boss.telegraphUntil === 0) {
      setTelegraph(boss, timestamp, 300, "dot");
    }
  }
}

// ── T2 — Frequency Jammer ───────────────────────────────────────────────────

/** Max trail beams per dash in T2 P3 */
const T2_TRAIL_MAX = 3;
/** Distance (px) between trail beams in T2 P3 */
const T2_TRAIL_DIST = 100;

function updateTier2(
  boss: Boss,
  dt: number,
  timestamp: number,
  _player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  result: BossUpdateResult,
): void {
  boss.moveTimer += dt;

  const dashSpeed = boss.phase === 1 ? 80 : boss.phase === 2 ? 110 : 130;
  const diffX = boss.targetX - boss.x;
  const diffY = boss.targetY - boss.y;
  const dist = Math.sqrt(diffX * diffX + diffY * diffY);
  const step = dashSpeed * dt;
  let arrived = false;
  const prevX = boss.x;
  const prevY = boss.y;

  if (dist <= step) {
    boss.x = boss.targetX;
    boss.y = boss.targetY;
    arrived = true;
  } else {
    boss.x += (diffX / dist) * step;
    boss.y += (diffY / dist) * step;
  }

  // Phase 3: drop beams based on straight-line distance traveled (1 per 100px, max 3 per dash)
  if (boss.phase === 3 && !arrived) {
    const segDx = boss.x - prevX;
    const segDy = boss.y - prevY;
    boss.trailDistAccum += Math.sqrt(segDx * segDx + segDy * segDy);
    if (boss.trailDistAccum >= T2_TRAIL_DIST && boss.patternPhase < T2_TRAIL_MAX) {
      boss.trailDistAccum -= T2_TRAIL_DIST;
      boss.patternPhase++;
      result.beamsToFire.push(beamFromBoss(boss, 0, 120));
    }
  }

  if (arrived) {
    // Telegraph phase — set telegraph on arrival, don't fire yet
    if (boss.telegraphUntil === 0) {
      if (boss.phase === 1) {
        setTelegraph(boss, timestamp, 300, "dot");
      } else {
        setTelegraph(boss, timestamp, 300, "dot");
      }
    }

    // Fire phase — telegraph expired
    if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
      clearTelegraph(boss);

      if (boss.phase === 1) {
        const speed = 120;
        result.beamsToFire.push(beamFromBoss(boss, 0, speed));
        result.beamsToFire.push(beamFromBoss(boss, Math.sin(-0.3) * speed, Math.cos(-0.3) * speed));
        result.beamsToFire.push(beamFromBoss(boss, Math.sin(0.3) * speed, Math.cos(0.3) * speed));
      } else {
        // Phase 2 and 3: 5-beam fan
        const angles = [-0.5, -0.25, 0, 0.25, 0.5];
        const speed = 130;
        for (const a of angles) {
          result.beamsToFire.push(beamFromBoss(boss, Math.sin(a) * speed, Math.cos(a) * speed));
        }
      }

      // Pick new diagonal target and reset trail counters
      boss.targetX = Math.random() * (canvasWidth - boss.width);
      boss.targetY = BOSS_DIAG_Y_MIN + Math.random() * (BOSS_DIAG_Y_MAX - BOSS_DIAG_Y_MIN);
      boss.patternPhase = 0;
      boss.trailDistAccum = 0;
      boss.shootTimer = 0;
    }
  }
}

// ── T3 — Band Blocker ───────────────────────────────────────────────────────

function updateTier3(
  boss: Boss,
  dt: number,
  timestamp: number,
  player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  _canvasHeight: number,
  result: BossUpdateResult,
): void {
  boss.moveTimer += dt;
  applyBossVerticalBob(boss);

  // Horizontal bounce
  const speed = boss.phase === 1 ? 25 : 45;
  if (boss.dx === 0) boss.dx = speed;
  boss.dx = Math.sign(boss.dx) * speed;
  boss.x += boss.dx * dt;

  if (boss.x <= 0) {
    boss.x = 0;
    boss.dx = speed;
  } else if (boss.x + boss.width >= canvasWidth) {
    boss.x = canvasWidth - boss.width;
    boss.dx = -speed;
  }

  boss.shootTimer += dt;

  // ── Fire phase (all phases): telegraph expired → fire beams ──
  if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
    // For P3, patternPhase was incremented at telegraph time, so current attack = (patternPhase - 1) % 3
    const attack = (boss.patternPhase - 1) % 3;
    clearTelegraph(boss);
    boss.shootTimer = 0;

    if (boss.phase === 1) {
      const spacing = boss.width / 4;
      for (let i = 0; i <= 4; i++) {
        result.beamsToFire.push({
          x: boss.x + spacing * i,
          y: boss.y + boss.height,
          dx: 0,
          dy: 90,
        });
      }
    } else if (boss.phase === 2) {
      const spacing = boss.width / 6;
      for (let i = 0; i <= 6; i++) {
        if (i === 2 || i === 5) continue;
        result.beamsToFire.push({
          x: boss.x + spacing * i,
          y: boss.y + boss.height,
          dx: 0,
          dy: 100,
        });
      }
    } else {
      // Phase 3: fire the attack that was chosen at telegraph time
      const atk = attack % 3;
      if (atk === 0) {
        const spacing = boss.width / 6;
        for (let i = 0; i <= 6; i++) {
          if (i === 2 || i === 5) continue;
          result.beamsToFire.push({
            x: boss.x + spacing * i,
            y: boss.y + boss.height,
            dx: 0,
            dy: 100,
          });
        }
      } else if (atk === 1) {
        // (B) Aimed beam using locked aim from telegraph
        const bx = boss.x + boss.width / 2;
        const by = boss.y + boss.height;
        const py = player.y + player.height / 2;
        const lockAngle = Math.atan2(py - by, boss.telegraphAimX - bx);
        const bSpeed = 140;
        result.beamsToFire.push(beamFromBoss(boss, Math.cos(lockAngle) * bSpeed, Math.sin(lockAngle) * bSpeed));
      } else {
        // (C) Wide laser — Fix 5: include height: 200
        result.beamsToFire.push({
          x: boss.x + boss.width / 2,
          y: boss.y + boss.height,
          dx: 0,
          dy: 200,
          width: 9,
          height: 200,
        });
      }
    }
    return;
  }

  // ── Telegraph phase: timer reached → set telegraph, don't fire ──
  if (boss.telegraphUntil === 0) {
    if (boss.phase === 1 && boss.shootTimer >= 3) {
      setTelegraph(boss, timestamp, 300, "dot");
    } else if (boss.phase === 2 && boss.shootTimer >= 2.8) {
      setTelegraph(boss, timestamp, 300, "dot");
    } else if (boss.phase === 3 && boss.shootTimer >= 2.2) {
      const attack = boss.patternPhase % 3;
      boss.patternPhase++;
      if (attack === 0) {
        setTelegraph(boss, timestamp, 300, "dot");
      } else if (attack === 1) {
        const px = player.x + player.width / 2;
        setTelegraph(boss, timestamp, 300, "line", px);
      } else {
        setTelegraph(boss, timestamp, 500, "ring");
      }
    }
  }
}

// ── T4 — Network Nullifier ──────────────────────────────────────────────────

function updateTier4(
  boss: Boss,
  dt: number,
  timestamp: number,
  player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  result: BossUpdateResult,
): void {
  // Zigzag bounce at all phases
  const speed = boss.phase === 1 ? 90 : boss.phase === 2 ? 120 : 140;
  if (boss.dx === 0) boss.dx = speed;
  boss.dx = Math.sign(boss.dx) * speed;
  boss.x += boss.dx * dt;

  if (boss.x <= 0) {
    boss.x = 0;
    boss.dx = speed;
  } else if (boss.x + boss.width >= canvasWidth) {
    boss.x = canvasWidth - boss.width;
    boss.dx = -speed;
  }

  // Phase 2: diagonal slide — refresh targetY every 2s so the boss slides in a
  // new diagonal each horizontal swing, then glide toward it at 30 px/s.
  if (boss.phase === 2) {
    if (boss.shootTimer <= 0 || boss.targetY === BOSS_ENTER_Y) {
      boss.targetY = BOSS_DIAG_Y_MIN + Math.random() * (BOSS_DIAG_Y_MAX - BOSS_DIAG_Y_MIN);
    }
    const yDiff = boss.targetY - boss.y;
    const yStep = 30 * dt;
    if (Math.abs(yDiff) <= yStep) boss.y = boss.targetY;
    else boss.y += Math.sign(yDiff) * yStep;
  }

  boss.shootTimer += dt;

  // ── Fire phase: telegraph expired → fire beams ──
  if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
    const bx = boss.x + boss.width / 2;
    const by = boss.y + boss.height;
    const py = player.y + player.height / 2;
    clearTelegraph(boss);
    boss.shootTimer = 0;

    if (boss.phase === 1) {
      // Single aimed beam using locked aim
      const lockAngle = Math.atan2(py - by, boss.telegraphAimX - bx);
      const bSpeed = 150;
      result.beamsToFire.push(beamFromBoss(boss, Math.cos(lockAngle) * bSpeed, Math.sin(lockAngle) * bSpeed));
    } else if (boss.phase === 2) {
      if (boss.patternPhase % 3 === 0) {
        // 3-beam aimed fan
        const baseAngle = Math.atan2(py - by, boss.telegraphAimX - bx);
        const bSpeed = 150;
        for (const offset of [-0.2, 0, 0.2]) {
          const a = baseAngle + offset;
          result.beamsToFire.push(beamFromBoss(boss, Math.cos(a) * bSpeed, Math.sin(a) * bSpeed));
        }
      } else {
        // Single aimed beam
        const lockAngle = Math.atan2(py - by, boss.telegraphAimX - bx);
        const bSpeed = 150;
        result.beamsToFire.push(beamFromBoss(boss, Math.cos(lockAngle) * bSpeed, Math.sin(lockAngle) * bSpeed));
      }
    } else {
      // Phase 3
      if (boss.patternPhase % 2 === 0) {
        // (A) Single aimed beam
        const lockAngle = Math.atan2(py - by, boss.telegraphAimX - bx);
        const bSpeed = 150;
        result.beamsToFire.push(beamFromBoss(boss, Math.cos(lockAngle) * bSpeed, Math.sin(lockAngle) * bSpeed));
      } else {
        // (B) 4-beam downward radial burst
        const bSpeed = 140;
        const angles = [Math.PI / 2, Math.PI / 3, 2 * Math.PI / 3, Math.PI / 2 + 0.3];
        for (const a of angles) {
          result.beamsToFire.push(beamFromBoss(boss, Math.cos(a) * bSpeed, Math.sin(a) * bSpeed));
        }
      }
    }
    return;
  }

  // ── Telegraph phase: timer reached → set telegraph, don't fire ──
  if (boss.telegraphUntil === 0) {
    if (boss.phase === 1 && boss.shootTimer >= 2) {
      const px = player.x + player.width / 2;
      setTelegraph(boss, timestamp, 400, "line", px);
    } else if (boss.phase === 2 && boss.shootTimer >= 2) {
      boss.patternPhase++;
      const px = player.x + player.width / 2;
      setTelegraph(boss, timestamp, 400, "line", px);
    } else if (boss.phase === 3 && boss.shootTimer >= 1.4) {
      boss.patternPhase++;
      if (boss.patternPhase % 2 === 0) {
        // (A) aimed — telegraph with line
        const px = player.x + player.width / 2;
        setTelegraph(boss, timestamp, 400, "line", px);
      } else {
        // (B) radial — telegraph with dot
        setTelegraph(boss, timestamp, 300, "dot");
      }
    }
  }
}

// ── T5 — Core Corruptor ────────────────────────────────────────────────────

function updateTier5(
  boss: Boss,
  dt: number,
  timestamp: number,
  _player: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  result: BossUpdateResult,
): void {
  boss.moveTimer += dt;

  // ── Movement (all phases) ──
  if (boss.phase === 1) {
    const targetY = canvasHeight * 0.3;
    if (boss.y < targetY) {
      boss.y += 15 * dt;
      if (boss.y > targetY) boss.y = targetY;
    }
    if (boss.dx === 0) boss.dx = 40;
    boss.dx = Math.sign(boss.dx) * 40;
    boss.x += boss.dx * dt;
    if (boss.x <= 0) { boss.x = 0; boss.dx = 40; }
    else if (boss.x + boss.width >= canvasWidth) { boss.x = canvasWidth - boss.width; boss.dx = -40; }
  } else if (boss.phase === 2) {
    const targetY = canvasHeight * 0.35;
    if (boss.y < targetY) {
      boss.y += 15 * dt;
      if (boss.y > targetY) boss.y = targetY;
    }
    if (boss.dx === 0) boss.dx = 55;
    boss.dx = Math.sign(boss.dx) * 55;
    boss.x += boss.dx * dt;
    if (boss.x <= 0) { boss.x = 0; boss.dx = 55; }
    else if (boss.x + boss.width >= canvasWidth) { boss.x = canvasWidth - boss.width; boss.dx = -55; }
  } else {
    const targetY = canvasHeight * 0.35;
    if (boss.y < targetY) {
      boss.y += 15 * dt;
      if (boss.y > targetY) boss.y = targetY;
    }
    boss.dx = 0;
  }

  boss.shootTimer += dt;

  // ── Fire phase: telegraph expired → fire beams ──
  if (boss.telegraphUntil > 0 && timestamp >= boss.telegraphUntil) {
    clearTelegraph(boss);
    boss.shootTimer = 0;

    if (boss.phase === 1) {
      const speed = 120;
      result.beamsToFire.push(beamFromBoss(boss, 0, speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(-0.3) * speed, Math.cos(-0.3) * speed));
      result.beamsToFire.push(beamFromBoss(boss, Math.sin(0.3) * speed, Math.cos(0.3) * speed));
    } else if (boss.phase === 2) {
      if (boss.patternPhase % 2 === 0) {
        const angles = [-0.5, -0.25, 0, 0.25, 0.5];
        const speed = 130;
        for (const a of angles) {
          result.beamsToFire.push(beamFromBoss(boss, Math.sin(a) * speed, Math.cos(a) * speed));
        }
      } else {
        result.beamsToFire.push(beamFromBoss(boss, 0, 150));
      }
    } else {
      // Phase 3: fire based on stored attack index
      const attack = (boss.patternPhase - 1) % 4;
      if (attack === 0) {
        // (A) 12-beam radial burst
        const speed = 180;
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI * 2) / 12;
          result.beamsToFire.push(beamFromBoss(boss, Math.cos(a) * speed, Math.sin(a) * speed));
        }
        result.shakeEvents.push({ magnitude: 4, duration: 150 });
      } else if (attack === 1) {
        // (B) Aimed beam straight down
        result.beamsToFire.push(beamFromBoss(boss, 0, 150));
      } else {
        // (C) and (D): 5-beam fan
        const angles = [-0.5, -0.25, 0, 0.25, 0.5];
        const speed = 130;
        for (const a of angles) {
          result.beamsToFire.push(beamFromBoss(boss, Math.sin(a) * speed, Math.cos(a) * speed));
        }
      }
    }
    return;
  }

  // ── Telegraph phase: timer reached → set telegraph, don't fire ──
  if (boss.telegraphUntil === 0) {
    if (boss.phase === 1 && boss.shootTimer >= 2.5) {
      setTelegraph(boss, timestamp, 300, "dot");
    } else if (boss.phase === 2 && boss.shootTimer >= 2) {
      boss.patternPhase++;
      setTelegraph(boss, timestamp, 300, "dot");
    } else if (boss.phase === 3 && boss.shootTimer >= 1.8) {
      const attack = boss.patternPhase % 4;
      boss.patternPhase++;
      if (attack === 0) {
        // Fix 6: ring telegraph 400ms (spec), not 150ms
        setTelegraph(boss, timestamp, 400, "ring");
      } else {
        setTelegraph(boss, timestamp, 300, "dot");
      }
    }
  }
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

export function drawBoss(
  boss: Boss,
  ctx: CanvasRenderingContext2D,
  sprites: SpriteAtlas,
  timestamp: number,
): void {
  const normalSprites: Record<number, OffscreenCanvas> = {
    1: sprites.boss1,
    2: sprites.boss2,
    3: sprites.boss3,
    4: sprites.boss4,
    5: sprites.boss5,
  };
  const whiteSprites: Record<number, OffscreenCanvas> = {
    1: sprites.boss1White,
    2: sprites.boss2White,
    3: sprites.boss3White,
    4: sprites.boss4White,
    5: sprites.boss5White,
  };

  const useWhite = timestamp < boss.flashUntil;
  const sprite = useWhite ? whiteSprites[boss.tier] : normalSprites[boss.tier];
  ctx.drawImage(sprite, Math.round(boss.x), Math.round(boss.y));
}

export function drawBossTelegraph(
  boss: Boss,
  ctx: CanvasRenderingContext2D,
  timestamp: number,
): void {
  if (timestamp >= boss.telegraphUntil || !boss.telegraphOrigin) return;

  // Pulsing opacity
  const pulse = 0.4 + 0.4 * Math.sin(timestamp / 60);

  ctx.save();
  ctx.globalAlpha = pulse;

  if (boss.telegraphType === "dot") {
    ctx.fillStyle = "#ff3333";
    ctx.beginPath();
    ctx.arc(boss.telegraphOrigin.x, boss.telegraphOrigin.y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (boss.telegraphType === "line") {
    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(boss.telegraphOrigin.x, boss.telegraphOrigin.y);
    // Line to telegraphAimX at canvas bottom (use a large Y)
    ctx.lineTo(boss.telegraphAimX, boss.telegraphOrigin.y + 600);
    ctx.stroke();
  } else if (boss.telegraphType === "ring") {
    // Expanding circle: animate radius 0 -> 30 over the telegraph duration
    const maxRadius = 30;
    const dur = boss.telegraphDuration || 400;
    const remaining = boss.telegraphUntil - timestamp;
    const progress = Math.min(1, 1 - remaining / dur);
    const radius = progress * maxRadius;
    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      boss.x + boss.width / 2,
      boss.y + boss.height / 2,
      Math.max(1, radius),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.restore();
}

export function drawBossHpBar(
  boss: Boss,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  palette: GamePalette,
): void {
  const barW = canvasWidth * 0.6;
  const barH = 10;
  const barX = (canvasWidth - barW) / 2;
  const barY = 12;
  const fillW = Math.max(0, (boss.hp / boss.maxHp) * barW);

  // Pick color by phase
  const fillColor =
    boss.phase === 1
      ? palette.shield
      : boss.phase === 2
        ? palette.spread
        : palette.enemy;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(barX, barY, barW, barH);

  // HP fill
  ctx.fillStyle = fillColor;
  ctx.fillRect(barX, barY, fillW, barH);

  // 1px border
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // Left text: boss name
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.text;
  ctx.font = "14px monospace";
  ctx.fillText(boss.name, barX, barY + barH + 4);

  // Right text: BOSS tier/5
  ctx.textAlign = "right";
  ctx.fillStyle = palette.textMuted;
  ctx.font = "12px monospace";
  ctx.fillText(`BOSS ${boss.tier}/5`, barX + barW, barY + barH + 4);

  // Reset text align
  ctx.textAlign = "left";
}

export function drawBossIntroBanner(
  boss: Boss,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  palette: GamePalette,
  timestamp: number,
): void {
  if (!boss.introBanner) return;

  const elapsed = timestamp - boss.introBanner.startTime;
  if (elapsed < 0 || elapsed >= BANNER_TOTAL) return;

  const bannerH = 60;
  const bannerY = canvasHeight * 0.4 - bannerH / 2;

  // Tier colors
  const tierColors: Record<1 | 2 | 3 | 4 | 5, string> = {
    1: palette.jammer,
    2: palette.enemy,
    3: palette.powerUp,
    4: palette.spread,
    5: palette.enemy,
  };
  const tierColor = tierColors[boss.tier];

  let xOffset = 0;
  let yOffset = 0;

  if (elapsed < BANNER_SLIDE_IN) {
    // Slide in from left
    const t = elapsed / BANNER_SLIDE_IN;
    xOffset = (-canvasWidth) * (1 - easeOutCubic(t));
  } else if (elapsed < BANNER_SLIDE_IN + BANNER_HOLD) {
    // Hold centered
    xOffset = 0;
    yOffset = 0;
  } else {
    // Slide out upward
    const t = (elapsed - BANNER_SLIDE_IN - BANNER_HOLD) / BANNER_SLIDE_OUT;
    yOffset = -canvasHeight * easeInCubic(t);
  }

  ctx.save();
  ctx.translate(xOffset, yOffset);

  // Background
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, bannerY, canvasWidth, bannerH);

  // Border top and bottom
  ctx.globalAlpha = 1;
  ctx.fillStyle = tierColor;
  ctx.fillRect(0, bannerY, canvasWidth, 2);
  ctx.fillRect(0, bannerY + bannerH - 2, canvasWidth, 2);

  // Hazard stripes on left side
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = tierColor;
  const stripeW = 8;
  const stripeSpacing = 14;
  for (let i = 0; i < 4; i++) {
    const sx = 10 + i * stripeSpacing;
    ctx.beginPath();
    ctx.moveTo(sx, bannerY + 4);
    ctx.lineTo(sx + stripeW, bannerY + 4);
    ctx.lineTo(sx + stripeW - 4, bannerY + bannerH - 4);
    ctx.lineTo(sx - 4, bannerY + bannerH - 4);
    ctx.closePath();
    ctx.fill();
  }

  // Hazard stripes on right side (mirrored)
  for (let i = 0; i < 4; i++) {
    const sx = canvasWidth - 10 - (i + 1) * stripeSpacing;
    ctx.beginPath();
    ctx.moveTo(sx, bannerY + 4);
    ctx.lineTo(sx + stripeW, bannerY + 4);
    ctx.lineTo(sx + stripeW + 4, bannerY + bannerH - 4);
    ctx.lineTo(sx + 4, bannerY + bannerH - 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // Center text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.text;
  ctx.font = "bold 24px monospace";
  ctx.fillText(
    `\u26A0 ${boss.introBanner.name} \u26A0`,
    canvasWidth / 2,
    bannerY + bannerH / 2 - 8,
  );

  // Subtitle
  ctx.fillStyle = palette.textMuted;
  ctx.font = "12px monospace";
  ctx.fillText(
    boss.introBanner.subtitle,
    canvasWidth / 2,
    bannerY + bannerH / 2 + 14,
  );

  ctx.restore();
}

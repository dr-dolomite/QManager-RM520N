// ─── Signal Storm sprite atlas ────────────────────────────────────────────────
// All pixel art definitions and pre-rendering logic.
// 0=transparent, 1=primary, 2=dark(0.55 opacity), 3=highlight(white overlay)

import type { GamePalette, SpriteAtlas } from "./signal-storm-types";

export const PIXEL_SCALE = 2;      // Base sprite pixel scale
export const BOSS_PIXEL_SCALE = 6; // 3× base — bosses are rendered larger for presence

// ─── Size constants ───────────────────────────────────────────────────────────

export const SWERVER_W = 20;
export const SWERVER_H = 20;
// Boss size constants are declared at the bottom of this file after the sprite
// arrays are defined (see BOSS{1..5}_W/H near preRenderAllSprites).

// ─── Sprite definitions ───────────────────────────────────────────────────────

// Player ship — 12×14 → 24×28 rendered
// Detailed fighter: tipped nose, glowing canopy, wing shading, twin intakes, twin thrusters
export const SPRITE_PLAYER: number[][] = [
  [0,0,0,0,0,1,1,0,0,0,0,0],
  [0,0,0,0,1,3,3,1,0,0,0,0],
  [0,0,0,1,1,3,3,1,1,0,0,0],
  [0,0,0,1,2,1,1,2,1,0,0,0],
  [0,0,1,1,3,1,1,3,1,1,0,0],
  [0,1,1,2,1,3,3,1,2,1,1,0],
  [1,1,2,1,1,1,1,1,1,2,1,1],
  [1,1,1,1,1,3,3,1,1,1,1,1],
  [1,0,1,1,2,1,1,2,1,1,0,1],
  [1,0,0,1,1,3,3,1,1,0,0,1],
  [0,0,0,1,1,0,0,1,1,0,0,0],
  [0,0,0,0,1,0,0,1,0,0,0,0],
  [0,0,0,0,1,0,0,1,0,0,0,0],
  [0,0,0,0,3,0,0,3,0,0,0,0],
];

// Meteor / interference enemy — 10×8 → 20×16 rendered
// Cratered rocky asteroid with scatter highlights and edge shadow
export const SPRITE_METEOR: number[][] = [
  [0,0,0,1,1,1,1,0,0,0],
  [0,0,1,3,1,2,3,1,1,0],
  [0,1,2,1,3,1,1,2,1,1],
  [1,2,1,1,1,3,2,1,3,1],
  [1,1,3,1,2,1,1,3,1,1],
  [1,2,1,2,1,1,2,1,1,0],
  [0,1,1,3,1,2,1,2,0,0],
  [0,0,1,1,1,1,0,0,0,0],
];

// Jammer / alien ship — 14×10 → 28×20 rendered
// Twin-eye cockpit, shaded wing ridges, weapon pylons, exhaust plumes
export const SPRITE_JAMMER: number[][] = [
  [0,0,0,0,0,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,3,1,1,3,1,0,0,0,0],
  [0,0,0,1,1,3,2,2,3,1,1,0,0,0],
  [0,0,1,1,2,1,1,1,1,2,1,1,0,0],
  [0,1,1,2,1,3,1,1,3,1,2,1,1,0],
  [1,1,2,1,1,1,3,3,1,1,1,2,1,1],
  [1,2,1,1,2,1,1,1,1,2,1,1,2,1],
  [1,0,1,1,1,2,0,0,2,1,1,1,0,1],
  [0,0,0,0,1,0,0,0,0,1,0,0,0,0],
  [0,0,0,0,0,3,0,0,3,0,0,0,0,0],
];

// Swerver enemy — 10×10 → 20×20 rendered
// Sharper dart silhouette with glowing nose, central ridge, twin fins, and tail spark
export const SPRITE_SWERVER: number[][] = [
  [0,0,0,0,1,1,0,0,0,0],
  [0,0,0,1,3,3,1,0,0,0],
  [0,0,1,3,1,1,3,1,0,0],
  [0,1,2,1,3,3,1,2,1,0],
  [1,1,1,1,1,1,1,1,1,1],
  [1,2,1,3,1,1,3,1,2,1],
  [0,1,1,2,1,1,2,1,1,0],
  [0,0,1,1,0,0,1,1,0,0],
  [0,0,0,1,0,0,1,0,0,0],
  [0,0,0,0,3,3,0,0,0,0],
];

// Splitter enemy — 12×10 → 24×20 rendered
// Cross-seam and quarter-plate shading telegraph the shard-split pattern
export const SPRITE_SPLITTER: number[][] = [
  [0,0,0,1,1,1,1,1,1,0,0,0],
  [0,0,1,3,1,2,2,1,3,1,0,0],
  [0,1,2,1,3,1,1,3,1,2,1,0],
  [1,2,1,1,1,3,3,1,1,1,2,1],
  [1,1,3,1,2,1,1,2,1,3,1,1],
  [1,1,3,1,2,1,1,2,1,3,1,1],
  [1,2,1,1,1,3,3,1,1,1,2,1],
  [0,1,2,1,3,1,1,3,1,2,1,0],
  [0,0,1,3,1,2,2,1,3,1,0,0],
  [0,0,0,1,1,1,1,1,1,0,0,0],
];

// Sniper enemy — 14×12 → 28×24 rendered
// Heavy armored turret with scope glint, plated flanks, and barrel nose
export const SPRITE_SNIPER: number[][] = [
  [0,0,0,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,1,3,2,1,1,1,1,2,3,1,0,0],
  [0,1,1,1,1,3,3,3,3,1,1,1,1,0],
  [0,1,2,1,3,1,1,1,1,3,1,2,1,0],
  [1,1,1,1,1,1,3,3,1,1,1,1,1,1],
  [1,2,1,3,1,2,1,1,2,1,3,1,2,1],
  [1,1,1,1,2,1,1,1,1,2,1,1,1,1],
  [0,1,3,1,1,1,2,2,1,1,1,3,1,0],
  [0,0,1,2,1,1,1,1,1,1,2,1,0,0],
  [0,0,0,1,1,1,2,2,1,1,1,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,0,1,3,3,1,0,0,0,0,0],
];

// Orbiter enemy — 12×10 → 24×20 rendered
// Dome sensor head, canopy bars, side pylons, twin downward engine vents
export const SPRITE_ORBITER: number[][] = [
  [0,0,0,0,1,1,1,1,0,0,0,0],
  [0,0,0,1,3,3,3,3,1,0,0,0],
  [0,0,1,1,1,2,2,1,1,1,0,0],
  [0,1,2,1,3,1,1,3,1,2,1,0],
  [1,1,1,2,1,1,1,1,2,1,1,1],
  [1,2,1,1,1,3,3,1,1,1,2,1],
  [1,0,1,3,1,1,1,1,3,1,0,1],
  [1,0,0,1,2,0,0,2,1,0,0,1],
  [0,0,0,0,1,0,0,1,0,0,0,0],
  [0,0,0,0,3,0,0,3,0,0,0,0],
];

// Drone enemy — 8×8 → 16×16 rendered
// Segmented body cell with top/bottom sockets so stacked drones read as a snake
export const SPRITE_DRONE: number[][] = [
  [0,1,3,1,1,3,1,0],
  [1,3,1,2,2,1,3,1],
  [1,1,2,1,1,2,1,1],
  [1,2,1,3,3,1,2,1],
  [1,2,1,3,3,1,2,1],
  [1,1,2,1,1,2,1,1],
  [1,3,1,2,2,1,3,1],
  [0,1,3,1,1,3,1,0],
];

// Heart — 9×8 → 18×16 rendered
// Shaded heart with a left-ventricle highlight for readability in HUD
export const SPRITE_HEART: number[][] = [
  [0,1,1,0,0,1,1,0,0],
  [1,3,3,1,1,1,1,1,0],
  [1,3,1,1,1,1,2,1,0],
  [1,1,1,1,1,1,2,1,0],
  [0,1,1,1,1,2,1,0,0],
  [0,0,1,1,2,1,0,0,0],
  [0,0,0,1,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,0],
];

// Rapid-fire power-up icon — 7×7 → 14×14 rendered (lightning bolt with core highlight)
export const SPRITE_PU_RAPID: number[][] = [
  [0,0,1,3,1,0,0],
  [0,1,3,1,1,0,0],
  [1,1,3,3,1,1,0],
  [0,1,1,3,1,0,0],
  [0,1,3,1,1,0,0],
  [1,3,1,1,0,0,0],
  [0,1,0,0,0,0,0],
];

// Shield power-up icon — 7×7 → 14×14 rendered (shield crest)
export const SPRITE_PU_SHIELD: number[][] = [
  [0,0,1,1,1,0,0],
  [0,1,3,3,3,1,0],
  [1,1,3,1,3,1,1],
  [1,2,1,3,1,2,1],
  [0,1,2,1,2,1,0],
  [0,0,1,2,1,0,0],
  [0,0,0,1,0,0,0],
];

// Spread-shot power-up icon — 7×7 → 14×14 rendered (triple chevrons)
export const SPRITE_PU_SPREAD: number[][] = [
  [0,1,0,3,0,1,0],
  [1,3,0,3,0,3,1],
  [1,1,1,3,1,1,1],
  [0,1,0,1,0,1,0],
  [1,3,0,3,0,3,1],
  [1,1,1,1,1,1,1],
  [0,0,0,1,0,0,0],
];

// Player engine flame animation — 2 frames, 4×4 → 8×8 rendered
// Alternates narrow core / wide flare for a flickering thrust effect
export const SPRITE_ENGINE_FLAME: number[][][] = [
  [
    [0,1,1,0],
    [1,3,3,1],
    [0,3,3,0],
    [0,1,1,0],
  ],
  [
    [1,3,3,1],
    [1,1,1,1],
    [1,3,3,1],
    [0,1,1,0],
  ],
];

// Boss 1 — Signal Disruptor: 20×12 → 40×24. Amber jammer color.
// Dish-shaped cruiser with central cannon, antenna pods, hull plating, and exhaust rim
export const SPRITE_BOSS1: number[][] = [
  [0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,3,1,1,3,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,3,3,3,3,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,2,1,1,1,1,2,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,3,1,1,3,3,1,1,3,1,1,0,0,0,0],
  [0,0,0,1,1,2,1,1,1,1,1,1,1,1,2,1,1,0,0,0],
  [0,0,1,1,2,1,1,3,1,1,1,1,3,1,1,2,1,1,0,0],
  [1,1,1,1,1,1,3,1,1,1,1,1,1,3,1,1,1,1,1,1],
  [1,2,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,2,1],
  [1,0,0,1,1,1,1,0,0,1,1,0,0,1,1,1,1,0,0,1],
  [0,0,0,0,1,3,0,0,0,1,1,0,0,0,3,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0],
];

// Boss 2 — Frequency Jammer: 18×14 → 36×28. Red enemy color.
// Wedge interceptor with swept wings, plated spine, multi-barrel nose, twin exhausts
export const SPRITE_BOSS2: number[][] = [
  [0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,3,3,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,2,1,1,2,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,3,1,1,1,1,3,1,1,0,0,0,0],
  [0,0,0,1,1,2,1,1,3,3,1,1,2,1,1,0,0,0],
  [0,0,1,1,2,1,1,1,1,1,1,1,1,2,1,1,0,0],
  [0,1,1,2,1,1,3,1,1,1,1,3,1,1,2,1,1,0],
  [1,1,1,1,1,1,1,1,3,3,1,1,1,1,1,1,1,1],
  [1,2,1,1,2,1,1,2,1,1,2,1,1,2,1,1,2,1],
  [1,0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0,1],
  [0,0,0,0,1,1,0,0,1,1,1,1,0,0,1,1,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0],
];

// Boss 3 — Band Blocker: 24×10 → 48×20. Purple powerUp color.
// Ultra-wide blockade station: heavy armor, emitter ports, side pylons, central beam array
export const SPRITE_BOSS3: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,1,3,1,1,3,1,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,1,3,1,1,3,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,2,1,3,3,1,2,1,1,0,0,0,0,0,0,0],
  [0,0,0,1,1,1,1,1,3,1,1,1,1,1,1,3,1,1,1,1,1,0,0,0],
  [0,1,1,1,2,1,3,1,1,1,1,1,1,1,1,1,1,3,1,2,1,1,1,0],
  [1,1,2,1,1,1,1,2,1,1,3,1,1,3,1,1,2,1,1,1,1,2,1,1],
  [1,2,1,1,3,1,1,1,1,2,1,1,1,1,2,1,1,1,1,3,1,1,2,1],
  [1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1],
  [0,0,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,0],
];

// Boss 4 — Network Nullifier: 16×14 → 32×28. Orange spread color.
// Angular interceptor with sharp nose, cockpit glow, precision array, twin thrusters
export const SPRITE_BOSS4: number[][] = [
  [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,3,3,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,2,1,1,2,1,1,0,0,0,0],
  [0,0,0,1,1,3,1,1,1,1,3,1,1,0,0,0],
  [0,0,1,1,2,1,1,3,3,1,1,2,1,1,0,0],
  [0,1,1,1,1,3,1,1,1,1,3,1,1,1,1,0],
  [1,1,2,1,1,1,1,1,1,1,1,1,1,2,1,1],
  [1,2,1,3,1,1,2,2,2,2,1,1,3,1,2,1],
  [1,1,2,1,1,2,1,1,1,1,2,1,1,2,1,1],
  [1,0,0,1,0,0,1,1,1,1,0,0,1,0,0,1],
  [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0],
];

// Boss 5 — Core Corruptor: 22×16 → 44×32. Red enemy color, complex multi-part.
// Capital ship with rotating glowing core, heavy flank guns, layered armor, and exhaust rim
export const SPRITE_BOSS5: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,1,3,3,1,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,1,3,3,1,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,1,2,1,1,2,1,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,3,1,3,3,1,3,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,2,1,1,1,1,1,1,2,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,3,1,1,3,3,3,3,1,1,3,1,1,0,0,0,0],
  [0,0,0,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,0,0,0],
  [0,0,1,1,1,1,1,3,2,1,1,1,1,2,3,1,1,1,1,1,0,0],
  [0,1,1,2,1,1,3,1,1,1,3,3,1,1,1,3,1,1,2,1,1,0],
  [1,1,1,1,1,3,1,1,1,1,1,1,1,1,1,1,3,1,1,1,1,1],
  [1,2,1,1,2,1,2,1,3,1,1,1,1,3,1,2,1,2,1,1,2,1],
  [1,1,1,1,1,0,0,1,1,3,2,2,3,1,1,0,0,1,1,1,1,1],
  [1,0,0,1,1,0,0,1,1,0,0,0,0,1,1,0,0,1,1,0,0,1],
  [0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,3,0,0,0,0,3,0,0,0,0,0,0,0,0],
];

// ─── Boss size exports (derived from sprite arrays × BOSS_PIXEL_SCALE) ───────

export const BOSS1_W = SPRITE_BOSS1[0].length * BOSS_PIXEL_SCALE;
export const BOSS1_H = SPRITE_BOSS1.length    * BOSS_PIXEL_SCALE;
export const BOSS2_W = SPRITE_BOSS2[0].length * BOSS_PIXEL_SCALE;
export const BOSS2_H = SPRITE_BOSS2.length    * BOSS_PIXEL_SCALE;
export const BOSS3_W = SPRITE_BOSS3[0].length * BOSS_PIXEL_SCALE;
export const BOSS3_H = SPRITE_BOSS3.length    * BOSS_PIXEL_SCALE;
export const BOSS4_W = SPRITE_BOSS4[0].length * BOSS_PIXEL_SCALE;
export const BOSS4_H = SPRITE_BOSS4.length    * BOSS_PIXEL_SCALE;
export const BOSS5_W = SPRITE_BOSS5[0].length * BOSS_PIXEL_SCALE;
export const BOSS5_H = SPRITE_BOSS5.length    * BOSS_PIXEL_SCALE;

// ─── Pre-rendering helpers ────────────────────────────────────────────────────

export function preRenderSprite(
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

/** Pre-render all sprites in one pass and return a complete atlas. */
export function preRenderAllSprites(palette: GamePalette): SpriteAtlas {
  const s = PIXEL_SCALE;
  const bs = BOSS_PIXEL_SCALE;
  return {
    player:     preRenderSprite(SPRITE_PLAYER,      palette.player,  s),
    meteor:     preRenderSprite(SPRITE_METEOR,      palette.enemy,   s),
    jammer:     preRenderSprite(SPRITE_JAMMER,      palette.jammer,  s),
    swerver:    preRenderSprite(SPRITE_SWERVER,     palette.shield,  s),
    splitter:   preRenderSprite(SPRITE_SPLITTER,    palette.enemy,   s),
    sniper:     preRenderSprite(SPRITE_SNIPER,      palette.jammer,  s),
    orbiter:    preRenderSprite(SPRITE_ORBITER,     palette.shield,  s),
    drone:      preRenderSprite(SPRITE_DRONE,       palette.spread,  s),
    puRapid:    preRenderSprite(SPRITE_PU_RAPID,    palette.powerUp, s),
    puShield:   preRenderSprite(SPRITE_PU_SHIELD,   palette.shield,  s),
    puSpread:   preRenderSprite(SPRITE_PU_SPREAD,   palette.spread,  s),
    flames:     SPRITE_ENGINE_FLAME.map((frame) =>
                  preRenderSprite(frame, palette.spread, s)),
    heartFull:  preRenderSprite(SPRITE_HEART,       palette.enemy,   s),
    heartEmpty: preRenderSprite(SPRITE_HEART,       palette.textMuted, s),
    boss1:      preRenderSprite(SPRITE_BOSS1,       palette.jammer,  bs),
    boss2:      preRenderSprite(SPRITE_BOSS2,       palette.enemy,   bs),
    boss3:      preRenderSprite(SPRITE_BOSS3,       palette.powerUp, bs),
    boss4:      preRenderSprite(SPRITE_BOSS4,       palette.spread,  bs),
    boss5:      preRenderSprite(SPRITE_BOSS5,       palette.enemy,   bs),
    boss1White: preRenderSprite(SPRITE_BOSS1,       "#ffffff",       bs),
    boss2White: preRenderSprite(SPRITE_BOSS2,       "#ffffff",       bs),
    boss3White: preRenderSprite(SPRITE_BOSS3,       "#ffffff",       bs),
    boss4White: preRenderSprite(SPRITE_BOSS4,       "#ffffff",       bs),
    boss5White: preRenderSprite(SPRITE_BOSS5,       "#ffffff",       bs),
  };
}

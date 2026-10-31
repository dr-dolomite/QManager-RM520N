// 404 campfire: a 96x60 pixel grid of SVG rects, generated from the tables below.
// Fixed night palette in both themes; resting state is a complete still frame.

export const CAMPFIRE_PALETTE = {
  sky: "#1d2840",
  skyBand: "#222e48",
  star: "#e8eefc",
  treeFar: "#172036",
  treeNear: "#111a2b",
  ground: "#19233a",
  rim: "rgb(255 255 255 / 6%)",
  groundSpeck: "#212c46",
  pitShadow: "#141b2c",
  pitFloor: "#3b2a2b",
  pitEmber: "#5a3426",
  stoneLight: "#e6c7a1",
  stone: "#b68c69",
  stoneDark: "#7a6359",
  stoneBackLight: "#9c7a62",
  stoneBack: "#6f5a52",
  stoneShadow: "#3f4a66",
  logLight: "#9a5a32",
  log: "#5e321d",
  flameRed: "#d23e22",
  flameOrange: "#f2801c",
  flameYellow: "#ffc93c",
  flameCore: "#fff1b8",
  text: "#f4ead7",
  textMuted: "#aab4c9",
  amber: "#f6a93b",
  amberHover: "#ffb950",
  amberLight: "#ffd88a",
  amberEdge: "#b9581d",
  amberInk: "#2b1405",
} as const;

const P = CAMPFIRE_PALETTE;
const W = 96;
const H = 60;
const HORIZON = 31;

type Rect = { x: number; y: number; w: number; h: number; fill: string };

// Rows of a pixel ellipse, one rect per row.
function pixelEllipse(cx: number, cy: number, rx: number, ry: number, fill: string): Rect[] {
  const rows: Rect[] = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
    if (half > 0) rows.push({ x: cx - half, y: cy + dy, w: half * 2, h: 1, fill });
  }
  return rows;
}

// A stepped pine silhouette standing on the horizon.
function pine(x: number, height: number, fill: string): Rect[] {
  const rows: Rect[] = [];
  for (let r = 0; r < height; r++) {
    const half = Math.max(0, Math.floor(r * 0.45) - (r % 3 === 2 ? 1 : 0));
    rows.push({ x: x - half, y: HORIZON - height + r, w: half * 2 + 1, h: 1, fill });
  }
  return rows;
}

// A 1px-wide stepped line, highlight on top, for the logs.
function log(x0: number, y0: number, x1: number, y1: number): Rect[] {
  const rects: Rect[] = [];
  for (let x = x0; x <= x1; x++) {
    const y = Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    rects.push({ x, y, w: 1, h: 1, fill: P.logLight });
    rects.push({ x, y: y + 1, w: 1, h: 1, fill: P.log });
  }
  return rects;
}

// Sprite rows to run-length rects, so a frame is a handful of nodes.
const FLAME_INK: Record<string, string> = {
  r: P.flameRed,
  o: P.flameOrange,
  y: P.flameYellow,
  w: P.flameCore,
};

function sprite(rows: readonly string[], x0: number, y0: number): Rect[] {
  const rects: Rect[] = [];
  rows.forEach((row, dy) => {
    let start = 0;
    for (let i = 1; i <= row.length; i++) {
      if (row[i] !== row[start]) {
        const fill = FLAME_INK[row[start]];
        if (fill) rects.push({ x: x0 + start, y: y0 + dy, w: i - start, h: 1, fill });
        start = i;
      }
    }
  });
  return rects;
}

// Three flame frames, 15x18, sharing the base rows so the fire's footprint
// holds still while the tips crackle.
const FLAME_FRAMES = [
  [
    ".......r.......",
    ".......r.......",
    "......rr...r...",
    "......ro...r...",
    ".....roo..ro...",
    "..r..roor.ro...",
    "..r.rooyo.roo..",
    ".rr.royyorooo..",
    ".ro.rryyoooyor.",
    ".roorryywyoyyo.",
    "roooyyywwyyyyor",
    "rooyyywwwwyyoor",
    "rooyywwwwwwyyor",
    ".ooyywwwwwwyyo.",
    ".royywwwwwwyyr.",
    "..ryywwwwwyyr..",
    "...rryyyyyrr...",
    ".....rrrrr.....",
  ],
  [
    "....r..........",
    "....r......r...",
    "....rr.....r...",
    ".....r....rr...",
    ".....rr..ror...",
    "...r.ror.roo...",
    "...rroyo.roor..",
    "..rooyyoroooor.",
    ".rooyyyyooyyor.",
    ".rooyywyyoyyyo.",
    "rooyyywwyyywyor",
    "rooyywwwwywwyor",
    "roooywwwwwwwyor",
    ".ooyywwwwwwyyo.",
    ".royywwwwwwyyr.",
    "..ryyywwwwyyr..",
    "...rryyyyyyr...",
    ".....rrrrr.....",
  ],
  [
    "..........r....",
    "...r......r....",
    "...r.....rr....",
    "...rr....ro....",
    "...ror..roo.r..",
    "...roo..rooyr..",
    "..roooroyyor...",
    "..rooyoryyoor..",
    ".royyoooyywoor.",
    ".ryyyyoyywwyyo.",
    "roywyyyywwwyyor",
    "royywwyywwwyoor",
    "royywwwwwwwyoor",
    ".ooyywwwwwwyyo.",
    ".royywwwwwwyyr.",
    "..ryywwwwwyyr..",
    "...ryyyyyyyr...",
    ".....rrrrr.....",
  ],
] as const;

const FIRE_X = 48;
const FIRE_BASE_Y = 46;
const RING_CY = 47;

const SKY: Rect[] = [
  { x: 0, y: 0, w: W, h: HORIZON, fill: P.sky },
  { x: 0, y: 4, w: W, h: 1, fill: P.skyBand },
  { x: 0, y: 10, w: W, h: 1, fill: P.skyBand },
];

const STARS = [
  { x: 8, y: 3, twinkle: false },
  { x: 21, y: 7, twinkle: true },
  { x: 40, y: 2, twinkle: false },
  { x: 57, y: 6, twinkle: false },
  { x: 71, y: 3, twinkle: true },
  { x: 86, y: 8, twinkle: false },
  { x: 31, y: 13, twinkle: false },
  { x: 79, y: 14, twinkle: false },
  { x: 13, y: 16, twinkle: true },
  { x: 63, y: 12, twinkle: false },
] as const;

const TREES: Rect[] = [
  ...[
    [2, 8], [9, 11], [15, 7], [22, 10], [27, 9], [34, 12], [40, 8], [47, 10],
    [54, 7], [61, 11], [68, 9], [74, 12], [80, 8], [87, 10], [93, 9],
  ].flatMap(([x, h]) => pine(x, h, P.treeFar)),
  ...[
    [5, 13], [18, 10], [31, 15], [44, 9], [58, 14], [66, 11], [77, 16], [90, 12],
  ].flatMap(([x, h]) => pine(x, h, P.treeNear)),
  { x: 0, y: HORIZON - 2, w: W, h: 2, fill: P.treeNear },
];

const GROUND: Rect[] = [
  { x: 0, y: HORIZON, w: W, h: H - HORIZON, fill: P.ground },
  ...[
    [6, 36], [17, 41], [29, 35], [70, 37], [83, 42], [91, 35], [10, 53], [24, 57],
    [76, 55], [88, 51], [36, 58], [62, 58],
  ].map(([x, y]) => ({ x, y, w: 2, h: 1, fill: P.groundSpeck })),
];

const PIT_SHADOW: Rect[] = pixelEllipse(FIRE_X, RING_CY + 1, 24, 8, P.pitShadow);

// The ground inside the ring, warmed by the fire; this is what flickers.
const GLOW: Rect[] = [
  ...pixelEllipse(FIRE_X, RING_CY, 15, 4, P.pitFloor),
  ...pixelEllipse(FIRE_X, RING_CY - 1, 9, 3, P.pitEmber),
];

// Fourteen stones round an ellipse, far-to-near; the far half sits in shadow.
const STONE_COUNT = 14;

function stone(i: number): { back: boolean; y: number; rects: Rect[] } {
  const angle = (i / STONE_COUNT) * Math.PI * 2;
  const x = Math.round(FIRE_X + 18 * Math.cos(angle)) - 3;
  const y = Math.round(RING_CY + 6 * Math.sin(angle)) - 2;
  const back = Math.sin(angle) < -0.01;
  const [light, body, dark] = back
    ? [P.stoneBackLight, P.stoneBack, P.stoneShadow]
    : [P.stoneLight, P.stone, P.stoneDark];
  return {
    back,
    y,
    rects: [
      { x: x + 1, y, w: 5, h: 1, fill: light },
      { x, y: y + 1, w: 7, h: 1, fill: light },
      { x, y: y + 2, w: 7, h: 1, fill: body },
      { x: x + 1, y: y + 3, w: 5, h: 1, fill: dark },
    ],
  };
}

const STONES = Array.from({ length: STONE_COUNT }, (_, i) => stone(i)).sort((a, b) => a.y - b.y);
const BACK_STONES = STONES.filter((s) => s.back).flatMap((s) => s.rects);
const FRONT_STONES = STONES.filter((s) => !s.back).flatMap((s) => s.rects);

const LOGS: Rect[] = [...log(40, 48, 55, 44), ...log(41, 44, 56, 48)];

const FLAMES = FLAME_FRAMES.map((rows) => sprite(rows, FIRE_X - 7, FIRE_BASE_Y - 17));

// Resting positions are spread up the column so the still frame reads as
// embers caught mid-rise; the animation lifts each one 14px and fades it.
const EMBERS = [
  { x: 44, y: 27, dx: -2, dur: "1.9s", delay: "0s", fill: P.flameYellow, opacity: 0.9 },
  { x: 51, y: 25, dx: 2, dur: "2.3s", delay: "-0.7s", fill: P.flameOrange, opacity: 0.8 },
  { x: 47, y: 20, dx: -1, dur: "2.1s", delay: "-1.3s", fill: P.flameYellow, opacity: 0.6 },
  { x: 54, y: 28, dx: 3, dur: "2.6s", delay: "-0.4s", fill: P.flameOrange, opacity: 0.85 },
  { x: 42, y: 23, dx: -3, dur: "2.4s", delay: "-1.8s", fill: P.flameOrange, opacity: 0.5 },
  { x: 50, y: 19, dx: 1, dur: "2s", delay: "-1s", fill: P.flameYellow, opacity: 0.4 },
] as const;

function Rects({ rects }: { rects: readonly Rect[] }) {
  return rects.map((r, i) => (
    <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
  ));
}

export function CampfireScene({ label, className }: { label: string; className?: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <Rects rects={SKY} />
      {STARS.map((s) => (
        <rect
          key={`${s.x}-${s.y}`}
          x={s.x}
          y={s.y}
          width={1}
          height={1}
          fill={P.star}
          className={s.twinkle ? "campfire-star" : undefined}
          style={s.twinkle ? { animationDelay: `${-s.x / 10}s` } : undefined}
        />
      ))}
      <Rects rects={TREES} />
      <Rects rects={GROUND} />
      <Rects rects={PIT_SHADOW} />
      <g className="campfire-glow">
        <Rects rects={GLOW} />
      </g>
      <Rects rects={BACK_STONES} />
      <Rects rects={LOGS} />
      <Rects rects={FRONT_STONES} />
      {FLAMES.map((rects, i) => (
        <g key={i} className={`campfire-frame campfire-frame-${i}`}>
          <Rects rects={rects} />
        </g>
      ))}
      {EMBERS.map((e) => (
        <rect
          key={`${e.x}-${e.y}`}
          x={e.x}
          y={e.y}
          width={1}
          height={1}
          fill={e.fill}
          opacity={e.opacity}
          className="campfire-ember"
          style={
            {
              "--ember-dx": `${e.dx}px`,
              "--ember-dur": e.dur,
              "--ember-delay": e.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </svg>
  );
}

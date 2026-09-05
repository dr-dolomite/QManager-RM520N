import type { BadgeVariant } from "@/components/ui/badge";

// Tailscale — the /monitoring/tailscale family's geometry and tone contract.
// Restated from the Alerts and Latency siblings, never imported across families.
// Skeletons read the same constants the loaded views do (Skeleton-Mirror).

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Connection beside This device. Below the step each card takes the full width. */
export const COLS =
  "grid grid-cols-1 items-stretch gap-5 *:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/** A 36px header pill. The coarse-pointer bump is what reaches the 44px floor. */
export const PILL_ACTION =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The rest tone for a header or card-header pill. */
export const PILL_REST =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

/** 42px, extracted so the rail's skeleton mirrors the action it stands in for.
 *  The coarse bump is what reaches the 44px floor, as `PILL_ACTION` does. */
const ACTION_HEIGHT = "h-[2.625rem] pointer-coarse:h-11";

/** A 42px primary or secondary action in a card's rail. */
export const ACTION = `${ACTION_HEIGHT} gap-2 rounded-pill px-5 text-sm font-semibold`;

/** The control rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2.5";

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/**
 * Four tiles that reflow by their own minimum rather than by a breakpoint
 * ladder, so the band is correct at every sidebar state without a query.
 */
export const TILE = {
  /** 248px floor, not the sibling's 190px: a tile's text column is its width
   *  minus 106px of disc, gap and padding, so 190px leaves 84px for a 15-char
   *  address. Measured — every figure below fits 142px. */
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(15.5rem,1fr))]",
  /** 104px PINNED, never floored: a floor cannot mirror a skeleton. */
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4 shadow-[var(--shadow-whisper)]!",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** The band's disc fills. Colour lands here and on the figure, never on the tile. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** A live figure — a count, a verdict. `tabular-nums` in the UI face, never mono.
 *  18px, one step under the sibling's 22px: this band carries word verdicts
 *  ("Service stopped", it "Richiede accesso" = 167px at 22px) where the sibling
 *  carries two-digit numerals. */
export const TILE_VALUE =
  "truncate text-[1.125rem] leading-[1.2] font-bold tracking-[-0.015em] tabular-nums";

/** An identifier the device emitted — an address, a tailnet name. Machine voice,
 *  one step down so a full IPv4 and a 17-char tailnet still fit the tile. */
export const TILE_VALUE_MONO =
  "truncate font-mono text-sm leading-[1.35] font-semibold tracking-[-0.01em]";

/** Ink for a figure reporting something standing. */
export const TILE_VALUE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type TileValueTone = keyof typeof TILE_VALUE_TONE;

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

/** Machine voice inside a caption: a hostname, a relay the device named verbatim. */
export const TILE_CAPTION_MONO =
  "text-on-surface-variant truncate font-mono text-[0.6875rem]";

// -----------------------------------------------------------------------------
// The verdict chip
// -----------------------------------------------------------------------------

/** The states this surface can report. `notInstalled` renders no chip at all. */
export type TailscaleView =
  | "running"
  | "needsLogin"
  | "disconnected"
  | "serviceStopped"
  | "notInstalled"
  | "unknown";

/** Keyed onto the exported variant type, so a tone with no role fails the build.
 *  Three states land on `muted`, which is exactly why each carries its own glyph. */
export const STATUS_VARIANT = {
  running: "success",
  needsLogin: "warning",
  disconnected: "muted",
  serviceStopped: "muted",
  notInstalled: "muted",
  unknown: "muted",
} satisfies Record<TailscaleView, BadgeVariant>;

/** Label keys under the `common` namespace's `tailscale` block. */
export const STATUS_LABEL_KEY = {
  running: "tailscale.status.running",
  needsLogin: "tailscale.status.needsLogin",
  disconnected: "tailscale.status.disconnected",
  serviceStopped: "tailscale.status.serviceStopped",
  notInstalled: "tailscale.status.notInstalled",
  unknown: "tailscale.status.unknown",
} satisfies Record<TailscaleView, string>;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor card on the surface: 40px radius, 28px pad, one per route. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-7 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Title block on the left, tags or actions pinned right, both able to shrink.
 *  Every card header on the surface takes both, so the paired cards' titles and
 *  descriptions sit on one baseline whether or not a card carries a tag. */
export const CARD_HEAD = "flex items-start gap-4";
export const CARD_HEAD_TEXT = "flex min-w-0 flex-col gap-1.5";
export const CARD_HEAD_ACTIONS = "ml-auto flex flex-none flex-wrap justify-end gap-2";

/** The one region inside a stretched card that absorbs the slack. */
export const CARD_BODY = "flex flex-1 flex-col gap-4";

/** Size overrides only; the role stays the `Tag` variant's job. */
export const HEAD_TAG = "h-[1.375rem] px-2.5";

// -----------------------------------------------------------------------------
// Identity rows
// -----------------------------------------------------------------------------

/** 44px PINNED so the skeleton mirrors a row exactly. */
const METRIC_HEIGHT = "h-11";

/** Pill rows, 6px apart, on their own ground. No hairlines in the identity card. */
export const METRIC = {
  HEIGHT: METRIC_HEIGHT,
  STACK: "flex flex-col gap-1.5",
  ROW: `flex ${METRIC_HEIGHT} items-center gap-3 rounded-pill bg-surface-container px-4`,
  /** The label recedes; the value is the answer. Both carry the row step's
   *  20px line box explicitly, so neither depends on a default leading. */
  LABEL:
    "text-on-surface-variant flex-none text-[0.78125rem] leading-5 font-semibold",
  VALUE:
    "text-on-surface ml-auto min-w-0 truncate text-right text-[0.8125rem] leading-5 font-medium",
  /** Machine voice: an address, a hostname, a relay name, a tailnet. */
  VALUE_MONO:
    "text-on-surface ml-auto min-w-0 truncate text-right font-mono text-[0.8125rem] leading-5",
} as const;

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

/** 66px: the row's resting height, kept as a FLOOR so a longer translated
 *  description can still wrap. The skeleton reads the same constant. */
const SWITCH_MIN_HEIGHT = "min-h-[4.125rem]";

/** A setting's tonal tile. On, it becomes a primary container. */
export const SWITCH_ROW = {
  MIN_HEIGHT: SWITCH_MIN_HEIGHT,
  ROOT: `flex ${SWITCH_MIN_HEIGHT} items-center gap-3.5 rounded-tile px-[1.125rem] py-3.5`,
  REST: "bg-surface-container text-on-surface",
  ON: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "mt-0.5 text-xs opacity-85",
  /** A setting the daemon cannot apply yet. It is still legible, never a wash. */
  NOTE: "mt-1 text-xs font-medium",
  /** The pseudo-element target reaches 44px without a layout box. */
  CONTROL:
    "relative flex-none before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']",
  /** A disabled switch cannot hold focus, so a tooltip needs its own target.
   *  That target is a real tab stop and therefore needs its own ring. */
  CONTROL_WRAP:
    "relative flex-none rounded-pill outline-none before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-[''] focus-visible:ring-ring/50 focus-visible:ring-[3px]",
} as const;

// -----------------------------------------------------------------------------
// The peer table
// -----------------------------------------------------------------------------

/** One measurement, one literal: the head row and its skeleton read this. */
const HEAD_HEIGHT = "h-9";

/** A genuine data table, so it keeps hairline rules where a pill list would not. */
export const TABLE = {
  /** PINNED at 52px so the skeleton mirrors the loaded row exactly: the device
   *  cell is two lines (20px name + 16px DNS name) inside 16px of cell padding,
   *  so a 44px pin was inert and every row overshot it. */
  ROW_HEIGHT: "h-13",
  /** PINNED at 36px, for the same reason the row height is. */
  HEAD_HEIGHT: HEAD_HEIGHT,
  HEAD: `text-on-surface-variant ${HEAD_HEIGHT} px-3 text-[0.6875rem] font-semibold tracking-[0.02em] uppercase`,
  ROW: "border-border border-b last:border-b-0",
  CELL: "px-3 text-sm",
  /** Machine voice: an address the device emitted. */
  CELL_MONO: "px-3 font-mono text-xs",
  CELL_MUTED: "text-on-surface-variant px-3 text-xs",
  /** Both line boxes are explicit, so the row's pinned height is arithmetic
   *  rather than whatever the two default leadings happen to add up to. */
  NAME: "truncate text-sm leading-5 font-medium",
  /** A DNS name under the hostname. Machine voice, one step down. */
  SUBNAME:
    "text-on-surface-variant block truncate font-mono text-[0.6875rem] leading-4",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  TAG: "h-[1.125rem] shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
} as const;

// -----------------------------------------------------------------------------
// The install panel
// -----------------------------------------------------------------------------

/** The install transcript. A surface container in both themes, never a raw ink. */
export const LOG_PANEL = {
  ROOT: "text-on-surface w-full overflow-hidden rounded-tile bg-surface-container",
  HEAD: "flex items-center justify-between gap-3 px-4 pt-3 pb-2",
  TITLE:
    "text-on-surface-variant text-[0.6875rem] font-semibold tracking-[0.02em] uppercase",
  GLYPH: "text-on-surface-variant size-3.5",
  BODY: "h-56 overflow-y-auto px-4 pb-3 text-left font-mono text-xs leading-relaxed whitespace-pre outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  PLACEHOLDER: "text-on-surface-variant",
} as const;

/** One labelled machine-voice row, replacing the "or install manually" ritual. */
export const COMMAND = {
  ROOT: "flex w-full flex-col gap-1.5",
  LABEL:
    "text-on-surface-variant text-[0.6875rem] font-semibold tracking-[0.02em] uppercase",
  BOX: "flex items-center gap-2 rounded-tile bg-surface-container px-4 py-2.5",
  TEXT: "text-on-surface min-w-0 flex-1 overflow-x-auto font-mono text-xs select-all",
  COPY: "text-on-surface-variant hover:bg-surface-container-high grid size-9 flex-none place-items-center rounded-pill pointer-coarse:size-11",
} as const;

// -----------------------------------------------------------------------------
// The danger row
// -----------------------------------------------------------------------------

/** Low emphasis on purpose: destructive is the button, not the whole surface. */
export const DANGER = {
  ROOT: "flex flex-wrap items-center gap-4 rounded-card bg-surface-container px-6 py-5",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "text-on-surface-variant mt-0.5 text-xs leading-[1.5]",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/**
 * The three condition tones this surface can reach. Keyed onto `BadgeVariant`
 * so a tone with no matching role fails the build.
 */
export type ConditionTone = Extract<
  BadgeVariant,
  "muted" | "warning" | "destructive"
>;

export const CONDITION = {
  ROOT: "flex flex-1 flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
  /** A line beneath the action — the auth wait, and nothing else. */
  FOOT: "flex items-center gap-2 text-xs font-medium",
} as const;

/**
 * A condition block is one of the sanctioned container uses: the block IS the
 * state. The action pill is drawn from the container's own ink, never a wash.
 */
export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  warning: {
    ROOT: "bg-warning-container text-on-warning-container",
    DISC: "bg-warning text-warning-foreground",
    ACTION:
      "bg-on-warning-container/10 text-on-warning-container hover:bg-on-warning-container/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/**
 * The surface's ONE ambient loop, and only while the device is waiting for the
 * user to finish authenticating. `bg-current` takes the container's own ink.
 */
export const LIVE_DOT =
  "animate-pulse-ring size-[7px] flex-none rounded-pill bg-current";

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/** A stale-read or health notice: non-blocking, above the thing, never replacing it. */
export const NOTICE =
  "rounded-field flex items-start gap-2 px-3.5 py-2 text-xs leading-[1.45] font-medium";
export const NOTICE_GLYPH = "mt-px size-3.5 flex-none";
export const NOTICE_BODY = "min-w-0 flex-1";
export const NOTICE_LIST = "flex flex-col gap-1";

export const NOTICE_TONE = {
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
} satisfies Partial<Record<BadgeVariant, string>>;

export type NoticeTone = keyof typeof NOTICE_TONE;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Skeleton and content share ONE grid cell, so the swap costs zero layout shift. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/**
 * Every placeholder box reads its geometry from the loaded view's own constant,
 * so a height can never drift out from under its skeleton.
 */
export const SKELETON = {
  TILE: `${TILE.HEIGHT} rounded-tile`,
  METRIC: `${METRIC_HEIGHT} rounded-pill`,
  SWITCH: `${SWITCH_MIN_HEIGHT} rounded-tile`,
  ACTION: `${ACTION_HEIGHT} rounded-pill`,
  HEAD: `${HEAD_HEIGHT} rounded-inline`,
  /** Table rows are hairline-separated with NO gap between them, so the
   *  placeholder stack takes none either — a gap would make the skeleton
   *  taller than the table it stands in for, and the swap would shift. */
  TABLE_STACK: "flex flex-col",
  /** The row's pinned box AND its hairline, so the stack measures exactly what
   *  the table does. The bar inside is what the eye reads. */
  ROW_SLOT: `flex ${TABLE.ROW_HEIGHT} items-center ${TABLE.ROW}`,
  ROW: "h-5 w-full rounded-inline",
  /** A text placeholder takes the small role radius, not the row's. */
  LINE: "rounded-inline",
} as const;

import type { BadgeVariant } from "@/components/ui/badge";

// Watchdog — the /monitoring/watchdog family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).
// Geometry is RESTATED from its sibling /monitoring families, never imported.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

/** The rest tone for a ghost pill in the page header. */
export const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/**
 * Ladder 7fr beside Detection 5fr, one height (Symmetric-Pair). The ladder is
 * fixed-height, so Detection's timeline absorbs the slack; stacks below 56rem.
 */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @4xl/main:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]";

/** A pair cell: a stretched grid track, so its card fills the row height. */
export const PAIR_CELL = "grid min-w-0 *:h-full";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The one anchor card on this surface: the status card. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-7 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** A `CardAction` that keeps the title's line, so the description spans under both. */
export const HEAD_ACTION = "row-span-1 self-center";
export const HEAD_DESC_SPAN = "col-span-2";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

// -----------------------------------------------------------------------------
// The status card
// -----------------------------------------------------------------------------

/** The disc carries the phase colour; the card body stays neutral. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
  info: "bg-primary text-primary-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/** The surface's ONE ambient loop, spent on the disc while the ladder is running. */
export const DISC_LIVE = "animate-pulse-ring";

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

/** Ink for a figure reporting something standing. Neutral is the default. */
export const FIGURE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type FigureTone = keyof typeof FIGURE_TONE;

/**
 * Phase on the left edge, three figures on the right edge, the probe strip
 * under both. Below a 30rem card the figures become receipt rows.
 */
export const STATUS = {
  BODY: "flex flex-col gap-5",
  HEAD: "flex flex-wrap items-center gap-x-8 gap-y-4",
  PHASE: "flex min-w-0 flex-[1_1_18rem] items-center gap-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-col gap-0.5",
  TITLE: "text-xl leading-[1.2] font-bold tracking-[-0.01em]",
  BLURB: "text-on-surface-variant text-[0.8125rem] text-pretty",
  BLURB_NUM: "text-on-surface-variant text-[0.8125rem] text-pretty tabular-nums",
  FIGS: "grid flex-[1_1_100%] grid-cols-1 gap-2.5 @[30rem]/card:grid-cols-3 @[30rem]/card:gap-x-7 @[30rem]/card:gap-y-3 @[44rem]/card:flex-[0_1_auto] @[44rem]/card:grid-cols-[repeat(3,auto)]",
  /** A receipt row on a phone (grid placement); a stacked figure above 30rem (flex ignores placement). */
  FIG: "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @[30rem]/card:flex @[30rem]/card:flex-col @[30rem]/card:gap-0.5",
  FIG_EYEBROW: "col-start-1 row-start-1 whitespace-nowrap",
  FIG_VALUE:
    "col-start-2 row-span-2 row-start-1 text-xl leading-[1.15] font-bold tracking-[-0.01em] tabular-nums",
  FIG_CAPTION: "text-on-surface-variant col-start-1 row-start-2 text-xs tabular-nums",
} as const;

/** A line placeholder's height for the phase title, eyebrow and figure value. */
const STATUS_LINE = {
  TITLE: "h-5",
  BLURB: "h-3.5",
  EYEBROW: "h-3",
  VALUE: "h-[1.375rem]",
} as const;

const STRIP_HEIGHT = "h-10";

/** One bar per probe, newest on the right. A failed probe is a full red bar. */
export const STRIP = {
  /** Slots drawn, so a short history still reads as "the last N, padded". */
  SLOTS: 60,
  ROOT: "flex flex-col gap-2",
  HEAD: "text-on-surface-variant flex items-center justify-between gap-3 text-xs",
  TITLE: "text-on-surface text-[0.8125rem] font-semibold",
  HEAD_END: "inline-flex min-w-0 items-center gap-2 tabular-nums",
  HEIGHT: STRIP_HEIGHT,
  BARS: `flex ${STRIP_HEIGHT} items-end gap-0.5`,
  /** A data mark, not a role shape: the 3px radius keeps 60 bars from fusing. */
  BAR: "min-w-0 flex-1 rounded-[3px]",
  BAR_OK: "bg-primary",
  BAR_MISS: "h-full bg-destructive",
  BAR_NONE: "h-full bg-surface-container-high",
  FOOT: "text-on-surface-variant flex items-center justify-between gap-3 text-xs tabular-nums",
  EMPTY: `rounded-field bg-surface-container text-on-surface-variant grid ${STRIP_HEIGHT} place-items-center px-3 text-xs`,
  /** Bar height = floor + span × (value / max), in percent. */
  FLOOR_PCT: 22,
  SPAN_PCT: 60,
} as const;

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

const RUNG_MIN_HEIGHT = "min-h-16";

/**
 * One rung: disc, name + one cost line, controls. No fill at rest. Below a
 * 30rem card the controls take a second row, right-aligned under the text.
 */
export const RUNG = {
  STACK: "flex flex-col gap-1",
  MIN_HEIGHT: RUNG_MIN_HEIGHT,
  ROOT: `-mx-3 grid ${RUNG_MIN_HEIGHT} grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-tile px-3 py-2 @[30rem]/card:grid-cols-[2rem_minmax(0,1fr)_auto] @[30rem]/card:items-center`,
  REST: "text-on-surface",
  /** Highlight-by-Container: the running tier promotes, never washes. */
  RUNNING: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "col-start-1 row-start-1 mt-0.5 grid size-8 flex-none place-items-center rounded-pill text-[0.8125rem] font-semibold tabular-nums @[30rem]/card:mt-0",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  /** Step 3's companion row keeps the disc column empty. */
  SUB_DISC: "col-start-1 row-start-1 size-8",
  DISC_RUNNING: "bg-primary text-primary-foreground",
  /** Tried and climbed past: it did not restore the link, so neutral, not a verdict. */
  DISC_DONE: "bg-surface-container-high text-on-surface",
  DONE_GLYPH: "size-4",
  TEXT: "col-start-2 row-start-1 flex min-w-0 flex-col gap-px",
  NAME: "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-pretty",
  NAME_INACTIVE: "text-on-surface-variant",
  COST: "text-on-surface-variant text-[0.78125rem] text-pretty",
  COST_RUNNING: "opacity-85",
  CONTROLS:
    "col-start-2 row-start-2 flex items-center gap-2.5 justify-self-end @[30rem]/card:col-start-3 @[30rem]/card:row-start-1",
  /** Tier 4's field plus pill spans the full row on a phone. */
  CONTROLS_WIDE:
    "col-span-2 col-start-1 row-start-2 flex items-center gap-2.5 justify-self-end @[30rem]/card:col-span-1 @[30rem]/card:col-start-3 @[30rem]/card:row-start-1",
  ERROR:
    "text-destructive-on-surface col-span-full text-right text-xs leading-[1.5]",
  /** "Running now" on the promoted rung: the container already reports state. */
  MARKER:
    "flex shrink-0 items-center gap-1 text-[0.6875rem] leading-none font-semibold",
  MARKER_DOT: "size-1.5 flex-none rounded-pill bg-current",
  /** The "Up to" lead before tier 4's cap; dropped on a phone-width card. */
  CAP: "text-on-surface-variant inline-flex items-center gap-2 text-[0.8125rem] whitespace-nowrap",
  CAP_LEAD: "hidden @[30rem]/card:inline",
} as const;

// -----------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------

const FIELD_HEIGHT = "h-[2.625rem]";

/** A compact number with its unit inside the field (InputGroup). */
export const NUM_FIELD = {
  HEIGHT: FIELD_HEIGHT,
  GROUP: `${FIELD_HEIGHT} w-auto flex-none data-[disabled=true]:opacity-50`,
  /** The group dims as a whole; the input's own disabled dim would compound. */
  INPUT:
    "h-full w-[3.25rem] flex-none pr-1.5 pl-3 text-right text-[0.9375rem] font-semibold tabular-nums disabled:opacity-100 md:text-[0.9375rem]",
  UNIT: "text-on-surface-variant pr-3 pl-0 text-[0.8125rem] font-normal whitespace-nowrap group-data-[disabled=true]/input-group:opacity-100",
} as const;

// -----------------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------------

/** Receipt rows: key left, control right, 6px apart. */
export const DETECT = {
  BODY: "flex flex-1 flex-col gap-3.5",
  ROWS: "flex flex-col gap-1.5",
  ROW: "flex min-h-[2.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2",
  KEY: "text-sm font-medium",
  /** A key with a one-line caption under it (the switch rows). */
  KEY_STACK: "flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5",
  CAPTION:
    "text-on-surface-variant flex flex-wrap items-center gap-x-2 text-[0.78125rem] text-pretty tabular-nums",
  LINK: "text-primary-on-surface inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline",
  CONTROLS: "ml-auto flex flex-wrap items-center justify-end gap-2.5",
  ERROR: "text-destructive-on-surface -mt-1 basis-full text-right text-xs leading-[1.5]",
  /** Six numeric segments fit a 30rem card only at the tighter padding. */
  PROBE_PILL: "[&_[data-slot=toggle-group-item]]:px-2.5",
  PROBE_SELECT: "w-auto min-w-[7.5rem] px-4 text-[0.84375rem] font-medium",
} as const;

/** The derived reading, and Detection's one slack region (content bottom-aligned). */
export const TIMELINE = {
  ROOT: "flex min-h-0 flex-1 flex-col justify-end gap-2.5",
  ROWS: "flex flex-col gap-1.5",
  ROW: "flex items-baseline justify-between gap-4 text-[0.8125rem]",
  KEY: "min-w-0 text-pretty",
  VALUE: "flex-none font-medium tabular-nums",
  NOTE: "text-on-surface-variant text-[0.78125rem] text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The activity log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** The header link to the full Network Events log. */
export const LOG_LINK =
  "text-primary-on-surface hover:bg-surface-container dark:hover:bg-surface-container h-9 gap-1 pr-2.5 pl-3.5 text-[0.8125rem]";

/** The newest rows shown; the rest live on Network Events. */
export const LOG_LIMIT = 5;

/**
 * PINNED at 52px, which is what lets the skeleton mirror it exactly: 8px of
 * padding over an 18.9px message line, a 2px gap and a 16px meta line.
 */
const ROW_HEIGHT = "h-[3.25rem]";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `flex ${ROW_HEIGHT} items-center gap-3 rounded-tile px-4 py-2`,
  TRANSITION:
    "transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  META_CHIP: "h-4 shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
  /** On a tinted row the chip takes the container's OWN ink, at the 65% that
   *  holds the stroke at 3:1; 45% measured 2.13:1 on `warning-container`. */
  META_CHIP_ON_TONAL: "border-current/65 text-current",
  META_ID:
    "text-on-surface-variant truncate font-mono text-[0.6875rem] leading-none",
  META_ID_ON_TONAL:
    "truncate font-mono text-[0.6875rem] leading-none opacity-90",
  WHEN: "flex flex-none flex-col items-end pl-2",
  RELATIVE: "text-[0.8125rem] leading-none font-semibold tabular-nums",
  ABSOLUTE: "text-[0.6875rem] leading-none tabular-nums pt-[4px]",
} as const;

/** Ink for the absolute time on a row with no chromatic container. */
export const ABSOLUTE_INK = "text-on-surface-variant";

/** The day divider. The one place the canon allows a square edge. */
export const DAY = {
  ROOT: "flex items-center gap-3 px-1",
  LABEL:
    "text-on-surface-variant shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
  RULE: "h-px flex-1 bg-border",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** Keyed onto `BadgeVariant` so a tone with no matching role fails the build. */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
} as const;

/** The block IS the state; the retry pill draws from the container's own ink. */
export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<
  ConditionTone,
  { ROOT: string; DISC: string; ACTION: string }
>;

// -----------------------------------------------------------------------------
// Card feet: Ladder and Detection each commit their own draft
// -----------------------------------------------------------------------------

export const FOOT = {
  /** One status line: glyph or dot, then a sentence that wraps. */
  LINE: "flex min-w-0 items-center gap-2",
  /** A static marker: nothing is happening, so nothing loops here. */
  DOT: "size-[7px] flex-none rounded-pill bg-primary",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own constant. A restated number is a lie. */
export const SKELETON = {
  LINE: "rounded-inline",
  STATUS_TITLE: `${STATUS_LINE.TITLE} rounded-inline`,
  STATUS_BLURB: `${STATUS_LINE.BLURB} rounded-inline`,
  FIG_EYEBROW: `${STATUS_LINE.EYEBROW} rounded-inline`,
  FIG_VALUE: `${STATUS_LINE.VALUE} rounded-inline`,
  STRIP: `${STRIP_HEIGHT} rounded-field`,
  /** Line boxes (font size × line height) of the text each one stands in for. */
  CARD_TITLE: "h-[1.40625rem] rounded-inline",
  CARD_DESC: "h-5 rounded-inline",
  EYEBROW: "h-[1.03125rem] rounded-inline",
  TIMELINE_ROW: "h-[1.21875rem] rounded-inline",
  FOOT_STATUS: "h-5 rounded-inline",
  RUNG_NAME: "h-5 w-28 rounded-inline",
  RUNG_COST: "h-[1.1875rem] w-40 rounded-inline",
  ROW: `${ROW_HEIGHT} rounded-tile`,
  FIELD: `${FIELD_HEIGHT} rounded-field`,
  /** A `size="action"` Button or a SegmentedField track. */
  PILL: "h-[2.625rem] rounded-pill",
} as const;

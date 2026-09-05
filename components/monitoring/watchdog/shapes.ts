import type { BadgeVariant } from "@/components/ui/badge";

// Watchdog — the /monitoring/watchdog family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).
// Geometry is RESTATED from its sibling /monitoring families, never imported:
// one owner per shape, and a sibling's value is not this family's contract.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** A 36px header pill. The coarse-pointer bump is what reaches the 44px floor. */
export const PILL_ACTION =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

/** The rest tone for a ghost pill in the page header. */
export const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

// THERE IS NO `COLS` ON THIS SURFACE, DELIBERATELY. Detection and Recovery
// activity were built as a symmetric pair and measured at 1280px: with an empty
// feed both cards resolve to 491px, but at 25 events — one real incident —
// Activity drives the track to 1614px and strands 1123px of dead space in
// Detection, which is three fixed-height fields and cannot fill. Which card
// drives flips with the event count, which is the Radio Information failure
// DESIGN.md already records. Split by cadence, not by symmetry: both are
// full-width bands.

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/**
 * Four tiles that reflow by their own minimum rather than by a breakpoint
 * ladder, so the band is correct at every sidebar state without a query.
 */
export const TILE = {
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]",
  /** 104px PINNED, never floored: a floor cannot mirror a skeleton. */
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4 shadow-[var(--shadow-whisper)]!",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** The tile body stays neutral; the disc is the only place colour lands. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
  info: "bg-primary text-primary-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The surface's ONE ambient loop (One-Loop Rule), spent on the state disc and
 * only while the daemon is actually working through the ladder. An unsaved
 * edit is a marker, not a live thing, so the save bar's dot does not loop.
 */
export const DISC_LIVE = "animate-pulse-ring";

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. `tabular-nums` in the UI face, never mono: it is a live count. */
export const TILE_VALUE =
  "truncate text-[1.375rem] leading-[1.1] font-bold tracking-[-0.015em] tabular-nums";

/** Ink for a figure reporting something standing. Neutral is the default. */
export const TILE_VALUE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type TileValueTone = keyof typeof TILE_VALUE_TONE;

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

/** A caption carrying a live countdown. Same slot, tabular so it cannot jitter. */
export const TILE_CAPTION_NUM =
  "text-on-surface-variant truncate text-xs tabular-nums";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The one anchor card on this surface: the recovery ladder. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-7 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Title left, actions pinned right. */
export const CARD_HEAD = "flex items-start justify-between gap-3";
export const CARD_HEAD_ACTIONS = "flex flex-none items-center gap-2";

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

const SWITCH_MIN_HEIGHT = "min-h-[4.125rem]";

/** The master enable. Its fill IS the state, so it takes a role container. */
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
} as const;

/**
 * The 44px coarse-pointer target for a `Switch`, which paints 18x32px. An
 * overlay reaches the floor without a layout box that would shift the label.
 */
export const SWITCH_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

const RUNG_MIN_HEIGHT = "min-h-[6.5rem]";

/**
 * One rung. The read-only stepper and the editable switch list are one object
 * here, so a rung states what it does, what it costs, and whether it is armed.
 */
export const RUNG = {
  STACK: "flex flex-col gap-2.5",
  MIN_HEIGHT: RUNG_MIN_HEIGHT,
  ROOT: `flex ${RUNG_MIN_HEIGHT} gap-3.5 rounded-tile px-[1.125rem] py-3.5`,
  REST: "bg-surface-container text-on-surface",
  /** Highlight-by-Container: the running tier promotes, never washes. */
  RUNNING: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "grid size-8 flex-none place-items-center rounded-pill text-[0.8125rem] font-semibold tabular-nums",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  DISC_RUNNING: "bg-primary text-primary-foreground",
  BODY: "flex min-w-0 flex-1 flex-col gap-1",
  HEAD: "flex min-w-0 items-center gap-2",
  NAME: "min-w-0 truncate text-sm font-semibold",
  EFFECT: "text-[0.8125rem] leading-[1.4]",
  /** What this rung costs the user. Never a tooltip: it is part of the choice. */
  CONSEQUENCE: "text-xs leading-[1.45] opacity-85",
  META: "flex flex-wrap items-center gap-1.5 pt-0.5",
  /** Machine voice: the AT sequence the device actually issues. */
  META_CHIP:
    "h-4 shrink-0 px-1.5 py-0 font-mono text-[0.6875rem] leading-none",
  META_CHIP_ON_TONAL: "border-current/45 text-current",
  /** "Running now" on the promoted rung: the container already reports state. */
  MARKER:
    "flex shrink-0 items-center gap-1 text-[0.6875rem] leading-none font-semibold",
  MARKER_DOT: "size-1.5 flex-none rounded-pill bg-current",
  /** Stacked, not inline: a chip beside a switch eats a phone-width rung. */
  ACTIONS: "flex flex-none flex-col items-end gap-2.5 self-start",
  /** Tier 3's slot select and tier 4's cap live INSIDE their own rung. */
  FIELD_SLOT: "pt-1.5",
} as const;

// -----------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------

const FIELD_HEIGHT = "h-[2.625rem]";

/**
 * The `!` markers are load-bearing. `Select` ships `data-[size=default]:h-9` at
 * (0,2,0) and both it and `Input` ship a `dark:` fill, so a bare call-site
 * height or fill loses — silently, and in dark mode only.
 */
export const FIELD = {
  ROW: "flex flex-col gap-[7px]",
  LABEL: "text-[0.8125rem] font-semibold",
  HINT: "text-on-surface-variant text-xs leading-[1.5]",
  HEIGHT: FIELD_HEIGHT,
  SHELL: `${FIELD_HEIGHT}! w-full rounded-field! border-0! bg-surface-container dark:bg-surface-container! px-4 text-sm text-on-surface shadow-none! placeholder:text-on-surface-variant`,
  /** A field hosted by a `surface-container` rung steps to `-high` instead. */
  SHELL_ON_CONTAINER: `${FIELD_HEIGHT}! w-full rounded-field! border-0! bg-surface-container-high dark:bg-surface-container-high! px-4 text-sm text-on-surface shadow-none! placeholder:text-on-surface-variant`,
  INVALID: "aria-invalid:ring-[3px] aria-invalid:ring-destructive/50",
  NUM: "tabular-nums",
  NARROW: "max-w-[17.5rem]",
  ERROR: "text-destructive-on-surface text-xs leading-[1.5]",
} as const;

/** The field stack Detection nominates to absorb the pair's height lock. */
export const FIELD_STACK = "flex flex-col gap-5";

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/** A derived reading or a standing caveat, above the thing it qualifies. */
export const NOTICE =
  "rounded-field flex items-center gap-2 px-3.5 py-2 text-xs leading-[1.35] font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

export const NOTICE_TONE = {
  info: "bg-primary-container text-on-primary-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
} satisfies Partial<Record<BadgeVariant, string>>;

export type NoticeTone = keyof typeof NOTICE_TONE;

/** A figure ticking inside notice copy stays tabular in the interface font. */
export const NOTICE_NUM = "tabular-nums";

// -----------------------------------------------------------------------------
// The activity log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** Skeleton and content share ONE grid cell, so the swap shifts no layout. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

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
  /** On a tinted row the chip takes the container's OWN ink. */
  META_CHIP_ON_TONAL: "border-current/45 text-current",
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

/**
 * The two condition tones this surface can reach. Keyed onto `BadgeVariant` so
 * a tone with no matching role fails the build.
 */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
} as const;

/**
 * A condition block is one of the sanctioned container uses: the block IS the
 * state. The retry pill draws from the container's own ink, never a wash.
 */
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
// The save bar
// -----------------------------------------------------------------------------

/** Page-level and NOT sticky: the form is short enough to reach its own foot. */
export const SAVEBAR = {
  ROOT: "flex flex-wrap items-center gap-3 pt-1",
  STATUS: "text-on-surface-variant flex items-center gap-2 text-[0.8125rem]",
  ACTIONS: "ml-auto flex gap-2.5",
  /** A static marker: nothing is happening, so nothing loops here. */
  PULSE: "size-[7px] flex-none rounded-pill bg-primary",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own constant. A restated number is a lie. */
export const SKELETON = {
  TILE: `${TILE.HEIGHT} rounded-tile`,
  SWITCH: `${SWITCH_MIN_HEIGHT} rounded-tile`,
  RUNG: `${RUNG_MIN_HEIGHT} rounded-tile`,
  ROW: `${ROW_HEIGHT} rounded-tile`,
  FIELD: `${FIELD_HEIGHT} rounded-field`,
  LINE: "rounded-inline",
} as const;

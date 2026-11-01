import type { BadgeVariant } from "@/components/ui/badge";

// Network Events — the /monitoring family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT =
  "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The pill's lucide glyph. */
export const PILL_GLYPH = "size-4";

/** Right now + Activity: stacked, then one 5fr / 7fr row of equal height (Symmetric-Pair). */
export const TOP_GRID =
  "grid grid-cols-1 gap-5 @[58rem]/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @[58rem]/main:items-stretch";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

/** A card body that owns the card's slack region. */
export const CARD_FILL = "flex flex-1 flex-col";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** One description line's box, for its skeleton. */
export const CARD_DESC_LINE = "h-5";

/** A section label inside a card. Same voice as the day divider. */
export const SECTION_LABEL =
  "text-on-surface-variant px-1 pt-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase";

// -----------------------------------------------------------------------------
// Right now
// -----------------------------------------------------------------------------

const NOW_TITLE_LINE = "h-[1.3125rem]";
const NOW_CAPTION_LINE = "h-[1.125rem]";

export const NOW = {
  BODY: "flex flex-1 flex-col gap-4",
  /** A 44px disc beside a two-line stack (Stack-Height). */
  VERDICT: "flex min-w-0 items-center gap-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  DISC_GLYPH: "size-[1.375rem]",
  DISC_WARN: "bg-warning text-warning-foreground",
  DISC_OK: "bg-success text-success-foreground",
  STACK: "flex min-w-0 flex-col gap-0.5",
  TITLE_LINE: NOW_TITLE_LINE,
  TITLE: `${NOW_TITLE_LINE} truncate text-base leading-[1.3125rem] font-semibold`,
  CAPTION_LINE: NOW_CAPTION_LINE,
  CAPTION: `${NOW_CAPTION_LINE} text-on-surface-variant truncate text-[0.8125rem] leading-[1.125rem]`,
  /** The card's slack region. */
  LIST: "flex flex-1 flex-col gap-1.5",
  QUIET: "text-on-surface-variant px-1 text-[0.8125rem]",
  /** A repeating run is a whole-row button into the log. */
  JUMP:
    "w-full cursor-pointer text-left outline-none hover:bg-surface-container focus-visible:ring-[3px] focus-visible:ring-ring",
} as const;

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export const ACTIVITY = {
  BODY: "flex flex-1 flex-col",
  /** The card's slack region; the chart and its skeleton share this box. */
  CHART: "relative min-h-48 w-full flex-1",
  /** Pinned to the slot: a percent height inside a flex item resolves to zero. */
  PLOT: "absolute inset-0 aspect-auto",
  /** Axis and gridline ink, so ticks read on the card surface. */
  TICK_INK:
    "[&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:text-[0.6875rem] [&_.recharts-cartesian-axis-tick_text]:tabular-nums",
  AXIS_W: 28,
  LEGEND_LINE: "mt-3 h-5",
} as const;

/** Bottom-up fills. Problems are destructive: amber fails contrast on the neutral
 *  and collapses with green under protanopia. */
export const ACTIVITY_SERIES_COLOR = {
  problems: "var(--destructive)",
  routine: "var(--tag-neutral-border)",
  recoveries: "var(--success)",
} as const;

/** Bottom-up stack order; the topmost non-empty segment wears the rounded data end. */
export const ACTIVITY_STACK = ["problems", "routine", "recoveries"] as const;

/** The data end's corner, and the surface gap drawn between touching segments. */
export const ACTIVITY_BAR = { RADIUS: 4, GAP: 2 } as const;

// -----------------------------------------------------------------------------
// The log card
// -----------------------------------------------------------------------------

/** The filter and sort rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2";

/** A default-size filter Button. The active state is a fill, never a border. */
export const FILTER_PILL = "gap-1.5 px-3.5 text-[0.8125rem]";
export const FILTER_PILL_REST =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";
export const FILTER_PILL_ACTIVE =
  "bg-primary text-primary-foreground hover:bg-primary/90";
/** The live count riding inside a chip. */
export const FILTER_COUNT = "text-[0.6875rem] font-semibold tabular-nums opacity-70";

/** The list scrolls inside the card past about ten rows; rail and header stay put. */
export const LOG_SCROLL =
  "max-h-[min(36rem,70svh)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-tile outline-none [scrollbar-width:thin] focus-visible:ring-[3px] focus-visible:ring-ring";

// -----------------------------------------------------------------------------
// The log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** Skeleton and content share ONE grid cell, so the swap shifts nothing. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/** PINNED at 52px so the skeleton mirrors it exactly. */
const ROW_HEIGHT = "h-[3.25rem]";

/** Time leads, then disc, body and a right-edge slot (Row-Span). */
const ROW_GRID =
  "grid grid-cols-[4.25rem_2rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 @[30rem]/card:grid-cols-[4.5rem_2rem_minmax(0,1fr)_auto] @[30rem]/card:gap-x-3 @[30rem]/card:px-4";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `${ROW_GRID} ${ROW_HEIGHT} rounded-tile py-2`,
  /** The settle from weighted to quiet. It must read as a row going quiet. */
  TRANSITION: "transition-colors duration-(--duration-standard) ease-standard",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5 overflow-hidden",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  META_CHIP: "h-4 shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
  /** On a tinted row the chip takes the container's own ink; 65% holds 3:1. */
  META_CHIP_ON_TONAL: "border-current/65 text-current",
  /** "Ongoing" is a plain marker: the container and disc already report the state. */
  META_MARKER: "flex shrink-0 items-center gap-1 text-[0.6875rem] leading-none font-semibold",
  META_MARKER_DOT: "size-1.5 flex-none rounded-pill bg-current",
  /** A PCI or "was B28" is a quantity: UI face, tabular figures (Machine-Voice). */
  META_ID:
    "text-on-surface-variant truncate text-[0.6875rem] leading-none tabular-nums",
  /** Inherit the container's `on-` ink on a chromatic row. */
  META_ID_ON_TONAL: "truncate text-[0.6875rem] leading-none tabular-nums opacity-90",
  WHEN: "flex min-w-0 flex-col",
  RELATIVE: "truncate text-[0.8125rem] leading-none font-semibold tabular-nums",
  ABSOLUTE: "truncate text-[0.6875rem] leading-none tabular-nums pt-[4px]",
  /** The run's Show / Hide pill, drawn from the row's own ink; chevron-only on a phone-width card. */
  GROUP_TOGGLE:
    "h-8 w-8 gap-1 px-0 text-xs font-semibold text-current bg-current/10 hover:bg-current/15 hover:text-current dark:hover:bg-current/15 @[30rem]/card:w-auto @[30rem]/card:px-3",
  GROUP_TOGGLE_LABEL: "hidden @[30rem]/card:inline",
  GROUP_CHEVRON:
    "size-3.5 transition-transform duration-(--duration-quick) ease-standard",
  GROUP_CHEVRON_OPEN: "rotate-180",
  /** Expanded members: quiet, 40px, no meta line, clock time only. */
  MEMBERS: "flex flex-col gap-0.5",
  MEMBER_ROOT: `${ROW_GRID} h-10 rounded-tile`,
  MEMBER_DISC:
    "grid size-6 flex-none place-items-center justify-self-center rounded-pill",
  MEMBER_GLYPH: "size-3",
  MEMBER_BODY: "flex min-w-0 items-center gap-1.5 overflow-hidden",
  MEMBER_MESSAGE: "text-on-surface truncate text-[0.8125rem] leading-[1.35]",
  MEMBER_WHEN:
    "text-on-surface-variant truncate text-xs leading-none tabular-nums",
} as const;

/** Ink for the absolute time on a row that has no chromatic container. */
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

/** The two condition tones this surface can reach, keyed onto `BadgeVariant`. */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
} as const;

/** A condition block IS the state; the retry pill is drawn from its own ink. */
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
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/** A stale-data notice: non-blocking, above the list, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

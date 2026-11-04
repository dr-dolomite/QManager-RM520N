import type { BadgeVariant } from "@/components/ui/badge";

// Alerts — the /monitoring/alerts family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The lucide glyph inside a header pill. */
export const PILL_GLYPH = "size-4";

/**
 * Coverage over Channels on the left, Activity spanning both rows on the right.
 * The `1fr` second row absorbs Activity's extra height, so Coverage and
 * Channels never drift apart.
 */
export const BENTO =
  "grid grid-cols-1 items-stretch gap-5 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @5xl/main:grid-rows-[auto_1fr]";

/** `[&>*]:h-full` makes each card fill its stretched cell (Symmetric-Pair Rule). */
export const BENTO_AREA = {
  COVERAGE: "min-w-0 [&>*]:h-full @5xl/main:col-start-1 @5xl/main:row-start-1",
  /** `empty:hidden`: with no channels to show, the cell gives its gap back. */
  CHANNELS:
    "min-w-0 [&>*]:h-full empty:hidden @5xl/main:col-start-1 @5xl/main:row-start-2",
  ACTIVITY:
    "min-w-0 [&>*]:h-full @5xl/main:col-start-2 @5xl/main:row-span-2 @5xl/main:row-start-1",
} as const;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** 16px radius, no hairline, the whisper carrying the edge. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

// -----------------------------------------------------------------------------
// Coverage: three receipt rows, restated from ROW_SHAPE in
// components/cellular/radio/cellular-information-card.tsx
// -----------------------------------------------------------------------------

const COVERAGE_ROW_HEIGHT = "min-h-[2.625rem]";

export const COVERAGE_ROW = {
  STACK: "flex flex-col gap-[0.3125rem]",
  HEIGHT: COVERAGE_ROW_HEIGHT,
  /** A tile while it may wrap; a pill once the card is wide enough to hold one line. */
  ROOT: `flex ${COVERAGE_ROW_HEIGHT} flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-tile bg-surface-container px-4 py-[0.5625rem] @lg/card:flex-nowrap @lg/card:rounded-pill`,
  EVENT: "flex min-w-0 items-center gap-2.5 text-[0.8125rem] font-semibold",
  EVENT_GLYPH: "text-on-surface-variant size-4 flex-none",
  VIA: "ml-auto flex flex-wrap items-center justify-end gap-1.5",
  /** The default answer when nothing anywhere is sent: quiet, never a chip. */
  QUIET: "text-on-surface-variant text-[0.8125rem] font-medium",
} as const;

// -----------------------------------------------------------------------------
// The channel rail
// -----------------------------------------------------------------------------

export const RAIL = {
  ROOT: "flex flex-wrap items-center gap-2",
  /** A 36px selector pill. The active state is a fill, never a border. */
  PILL: "h-9 gap-[7px] rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11",
  PILL_REST:
    "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  PILL_ACTIVE: "bg-primary text-primary-foreground hover:bg-primary/90",
  /** 7px. On the selected pill it inherits the pill's own ink instead. */
  DOT: "size-[7px] flex-none rounded-pill",
  DOT_ON_ACTIVE: "bg-current",
} as const;

/** The rail dot is a second channel beside the pill label, never the only one. */
export const RAIL_DOT_TONE = {
  ready: "bg-success",
  attention: "bg-warning",
  off: "bg-on-surface-variant/50",
} as const;

export type RailDotTone = keyof typeof RAIL_DOT_TONE;

// -----------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------

/** 42px, the `Input` primitive's height, for the skeleton box. */
const FIELD_HEIGHT = "h-[2.625rem]";

export const FIELD = {
  ROW: "flex flex-col gap-[7px]",
  LABEL_ROW: "flex items-center gap-1.5",
  LABEL: "text-[0.8125rem] font-semibold",
  HINT: "text-on-surface-variant text-xs leading-[1.5]",
  HEIGHT: FIELD_HEIGHT,
  /** Pinned at the primitive's 42px so no flex or grid rule can shrink a field. */
  SHELL: `${FIELD_HEIGHT} shrink-0 text-sm`,
  /** A stronger invalid ring than the primitive's own. */
  INVALID: "aria-invalid:ring-[3px] aria-invalid:ring-destructive/50",
  /** Machine voice: a phone number, an address, a Discord id. */
  MONO: "font-mono text-[0.8125rem]",
  ERROR: "text-destructive-on-surface text-xs leading-[1.5]",
} as const;

/** The one alert wait, receipt style: label left, a narrow field right. */
export const WAIT_ROW = {
  ROOT: "flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5",
  TEXT: "flex min-w-0 flex-col gap-0.5 pt-1",
  TITLE: "text-[0.8125rem] font-semibold",
  HINT: "text-on-surface-variant text-xs",
  FIELD_COL: "flex flex-col items-end gap-1.5",
  /** 136px: two digits and the unit, never the full column. */
  FIELD: `relative ${FIELD_HEIGHT} w-[8.5rem] shrink-0`,
  INPUT: "pr-12 text-[0.9375rem] font-semibold tabular-nums",
  UNIT: "text-on-surface-variant pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[0.8125rem]",
} as const;

// -----------------------------------------------------------------------------
// One channel's panel: on/off and its events left, its fields right at 3xl.
// -----------------------------------------------------------------------------

export const PANEL = {
  ROOT: "grid grid-cols-1 items-start gap-5 @3xl/card:grid-cols-2 @3xl/card:gap-x-7",
  COL: "flex min-w-0 flex-col gap-3.5",
  HEAD: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
  HEAD_TEXT: "flex min-w-40 flex-1 flex-col gap-0.5",
  TITLE: "text-sm font-semibold",
  SUB: "text-on-surface-variant text-xs",
  SECTION_LABEL:
    "text-on-surface-variant pt-1.5 text-xs font-medium tracking-[0.04em] uppercase",
  TICKS: "flex flex-col gap-[0.3125rem]",
} as const;

const TICK_ROW_HEIGHT = "min-h-[2.625rem]";

/** A routing tick: event left, checkbox right, the whole pill is the target. */
export const TICK_ROW = {
  HEIGHT: TICK_ROW_HEIGHT,
  ROOT: `flex ${TICK_ROW_HEIGHT} items-center justify-between gap-4 rounded-pill bg-surface-container pr-2 pl-4 text-[0.8125rem] font-semibold`,
  INTERACTIVE:
    "cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring",
  /** 20px box inside a 42px row; the fill eases on the quick token. */
  BOX: "m-[0.6875rem] size-5 rounded-[6px] transition-[background-color,border-color,color] duration-[var(--duration-quick)] ease-[var(--ease-quick)] motion-reduce:transition-none",
  REASON: "text-on-surface-variant pr-2 text-xs font-medium",
} as const;

// -----------------------------------------------------------------------------
// The channels card's foot (the row itself is the shared `CardFoot`)
// -----------------------------------------------------------------------------

export const FOOT = {
  /** One status line: glyph or dot, then a sentence that wraps. */
  LINE: "flex min-w-0 items-center gap-2",
  /** Static: an unsaved draft is not live, so it takes no loop (One-Loop Rule). */
  DOT: "size-[7px] flex-none rounded-pill bg-primary",
} as const;

// -----------------------------------------------------------------------------
// The activity log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** Restated from Network Events: the list scrolls inside the card past about ten rows. */
export const LOG_SCROLL =
  "max-h-[min(36rem,70svh)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-tile outline-none [scrollbar-width:thin] focus-visible:ring-[3px] focus-visible:ring-ring @5xl/main:h-full @5xl/main:max-h-none";

/** Skeleton and content share ONE grid cell, so the swap shifts nothing. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/**
 * Activity's feed cell. Wide, the feed is pinned inside the cell and scrolls, so
 * the left column sets the row height and Activity stretches to match it.
 */
export const FEED_FILL = `${CROSSFADE_STACK} relative flex-1 @5xl/main:min-h-80 @5xl/main:*:absolute @5xl/main:*:inset-0`;

/** PINNED at 52px so the skeleton mirrors it exactly. Restated from Network Events. */
const ROW_HEIGHT = "h-[3.25rem]";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `flex ${ROW_HEIGHT} items-center gap-3 rounded-tile px-4 py-2`,
  TRANSITION:
    "transition-colors duration-(--duration-standard) ease-standard motion-reduce:transition-none",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  META_CHIP: "h-4 shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
  /** On a tinted row the chip takes the container's own ink, held at 3:1. */
  META_CHIP_ON_TONAL: "border-current/65 text-current",
  /** Machine voice: a recipient the device addressed verbatim. */
  META_ID:
    "text-on-surface-variant truncate font-mono text-[0.6875rem] leading-none",
  META_ID_ON_TONAL: "truncate font-mono text-[0.6875rem] leading-none opacity-90",
  WHEN: "flex flex-none flex-col items-end pl-2",
  RELATIVE: "text-[0.8125rem] leading-none font-semibold tabular-nums",
  ABSOLUTE: "text-[0.6875rem] leading-none tabular-nums pt-[4px]",
} as const;

/** Ink for the absolute time on a row that has no chromatic container. */
export const ABSOLUTE_INK = "text-on-surface-variant";

/** A delivered alert is the expected outcome, so only a failure keeps a fill. */
export const ROW_TONE = {
  sent: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-success text-success-foreground",
  },
  failed: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
  },
  notable: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-warning text-warning-foreground",
  },
  neutral: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
  },
} satisfies Record<string, { ROOT: string; DISC: string }>;

export type RowTone = keyof typeof ROW_TONE;

/** True for the grounds that carry their own `on-` ink. */
export const ROW_TONE_IS_TONAL = {
  sent: false,
  failed: true,
  notable: false,
  neutral: false,
} satisfies Record<RowTone, boolean>;

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
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
} as const;

/** The block IS the state. The retry pill is drawn from the container's own ink. */
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

/** A staleness or failure notice: non-blocking, above the thing, never replacing it. */
export const NOTICE =
  "rounded-field flex items-center gap-2 px-3.5 py-2 text-xs leading-[1.35] font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

export const NOTICE_TONE = {
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
} satisfies Partial<Record<BadgeVariant, string>>;

export type NoticeTone = keyof typeof NOTICE_TONE;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

export const SKELETON = {
  COVERAGE_ROW: `${COVERAGE_ROW_HEIGHT} rounded-tile @lg/card:rounded-pill`,
  TICK_ROW: `${TICK_ROW_HEIGHT} rounded-pill`,
  ROW: `${ROW_HEIGHT} rounded-tile`,
  FIELD: `${FIELD_HEIGHT} rounded-field`,
  /** A Badge's 22px box. */
  CHIP: "h-[1.375rem] rounded-pill",
  /** A `size="action"` Button. */
  ACTION: "h-[2.625rem] rounded-pill",
  /** A text placeholder takes the small role radius, not the row's. */
  LINE: "rounded-inline",
} as const;

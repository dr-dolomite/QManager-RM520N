import type { BadgeVariant } from "@/components/ui/badge";
import type { ConnectivityState } from "@/types/modem-status";

// Latency Monitor — this family's geometry and tone contract.
// Restated from the Network Events sibling, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** A 36px header pill. The coarse-pointer bump is what reaches the 44px floor. */
export const PILL_ACTION =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The pill's lucide glyph. */
export const PILL_GLYPH = "size-4";

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
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** Binary alert, not the five-stop ramp: a tile has no room for a bar. */
export const DISC_NEUTRAL = "bg-surface-container-high text-on-surface-variant";
export const DISC_ALERT = "bg-warning text-warning-foreground";

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. Aligned figures in the UI face, never mono: it is a live reading. */
export const TILE_VALUE =
  "truncate text-[1.375rem] leading-[1.1] font-bold tracking-[-0.015em] tabular-nums";

/** Ink for a figure that is reporting something standing. */
export const TILE_VALUE_ALERT = "text-warning-on-surface";

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

/** Two short facts side by side. The No-Dot-Separator Rule forbids glue punctuation. */
export const TILE_META = "flex min-w-0 items-center gap-2.5";

/** Machine voice: a probe target and a resolver family the device emitted verbatim. */
export const TILE_META_MONO = "truncate font-mono text-[0.6875rem]";

// -----------------------------------------------------------------------------
// The connection chip
// -----------------------------------------------------------------------------

/** Keyed onto the exported variant type, so a tone with no role fails the build. */
export const STATUS_VARIANT = {
  connected: "success",
  degraded: "warning",
  disconnected: "destructive",
  recovery: "info",
  unknown: "muted",
} satisfies Record<ConnectivityState, BadgeVariant>;

/** Label keys under the `dashboard` namespace's `latencyMonitor` block. */
export const STATUS_LABEL_KEY = {
  connected: "latencyMonitor.status.connected",
  degraded: "latencyMonitor.status.degraded",
  disconnected: "latencyMonitor.status.disconnected",
  recovery: "latencyMonitor.status.recovery",
  unknown: "latencyMonitor.status.unknown",
} satisfies Record<ConnectivityState, string>;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** The control rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2";

/** A 36px filter chip. The active state is a fill, never a border. */
export const FILTER_PILL =
  "h-9 gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11";
export const FILTER_PILL_REST =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";
export const FILTER_PILL_ACTIVE =
  "bg-primary text-primary-foreground hover:bg-primary/90";

// -----------------------------------------------------------------------------
// The range switcher
// -----------------------------------------------------------------------------

/**
 * A segmented pill above the card query, a Select below it. The active fill
 * travels on one shared `layoutId` rather than cross-fading two fills.
 */
export const SEGMENT = {
  TRACK: "hidden rounded-pill bg-surface-container p-1 @[540px]/card:flex",
  ITEM: "relative h-auto rounded-pill px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-transparent hover:text-on-surface data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground",
  INDICATOR: "absolute inset-0 rounded-pill bg-primary",
  /** Lifts the label above the travelling fill. */
  LABEL: "relative",
  SELECT_TRIGGER:
    "flex w-32 rounded-pill **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[540px]/card:hidden",
  SELECT_CONTENT: "rounded-tile",
  SELECT_ITEM: "rounded-field",
} as const;

// -----------------------------------------------------------------------------
// The chart
// -----------------------------------------------------------------------------

/**
 * Two stacked plots sharing one X domain. They are different units, so they
 * never merge onto one Y scale.
 */
export const CHART = {
  PLOT_H: "h-[200px]",
  LOSS_H: "h-[72px]",
  /** A number, not a class: recharts takes it as the `YAxis` width prop. */
  AXIS_W: 34,
  TICK_INK:
    "[&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:tabular-nums [&_.recharts-cartesian-axis-tick_text]:text-xs [&_.recharts-cartesian-axis-tick_text]:font-medium",
  LEGEND:
    "text-on-surface-variant flex flex-wrap items-center gap-4 text-xs font-medium",
  LEGEND_ENTRY: "inline-flex items-center gap-1.5",
  /** Shape only; the entry's ink comes from the call site. */
  LEGEND_SWATCH: "h-[3px] w-3 flex-none rounded-pill",
  /** The threshold guide's key, mirroring the dashed reference line. */
  LEGEND_SWATCH_DASH: "h-0 w-3 flex-none border-t-2 border-dashed",
  /** The spread band's key: the series ink at the band's own alpha. */
  LEGEND_BAND: "h-2.5 w-3 flex-none rounded-pill opacity-30",
} as const;

// -----------------------------------------------------------------------------
// The samples table
// -----------------------------------------------------------------------------

/** A genuine data table, so it keeps hairline rules where a pill list would not. */
export const TABLE = {
  /** PINNED at 44px so the skeleton mirrors the loaded row exactly. */
  ROW_HEIGHT: "h-11",
  HEAD: "text-on-surface-variant h-9 px-3 text-[0.6875rem] font-semibold tracking-[0.02em] uppercase",
  ROW: "border-border border-b last:border-b-0",
  CELL: "px-3 text-sm",
  CELL_NUM: "text-right font-medium tabular-nums",
  CELL_INK_WARN: "text-warning-on-surface",
  CELL_INK_ALERT: "text-destructive-on-surface",
} as const;

/** The day divider. The one place the canon allows a square edge. */
export const DAY = {
  ROOT: "flex items-center gap-3 px-1",
  LABEL:
    "text-on-surface-variant shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
  RULE: "h-px flex-1 bg-border",
} as const;

/** Skeleton and content share ONE grid cell, so the swap costs zero layout shift. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/**
 * The two condition tones this surface can reach. Keyed onto `BadgeVariant` so
 * a tone with no matching role fails the build.
 */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
} as const;

/**
 * A condition block is one of the three sanctioned container uses: the block IS
 * the state. The retry pill is drawn from the container's own ink, never a wash.
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
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/** A stale-data notice: non-blocking, above the content, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

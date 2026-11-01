import type { BadgeVariant } from "@/components/ui/badge";
import type { ConnectivityState } from "@/types/modem-status";

import type { Tone } from "./derive";

// Latency Monitor: this family's geometry and tone contract, imported by the
// loaded views AND their skeletons. Restated here, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Right now (5fr) beside History (7fr), one height, stacked below 58rem. */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @[58rem]/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** A pair card fills its row; the body nominates one region to take the slack. */
export const CARD_FILL = "h-full";

export const CARD_PAD = "px-6";

/** The body column. `flex-1` lets a pair card hand its slack to one region. */
export const CARD_BODY = "flex flex-1 flex-col gap-5";

/** Pinned to column 1, or a wrapped action leaves column 2 for the description. */
export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

/** Header actions: beside the title on a wide card, on their own row below it. */
export const HEADER_ACTIONS =
  "col-span-2 col-start-1 row-span-1 row-start-3 flex flex-wrap items-center justify-self-start gap-2 @lg/card:col-span-1 @lg/card:col-start-2 @lg/card:row-span-2 @lg/card:row-start-1 @lg/card:justify-self-end";

/** Skeleton and content share ONE grid cell, so a swap costs zero layout shift. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/** Bars, strips and figures retarget on the standard clock. */
export const TRANSITION_FILL =
  "transition-[width,height,background-color] duration-[var(--duration-standard)] ease-standard";
export const TRANSITION_INK =
  "transition-[color,opacity] duration-[var(--duration-standard)] ease-standard";

export const EYEBROW =
  "text-on-surface-variant text-[0.6875rem] leading-[0.875rem] font-semibold tracking-[0.06em] uppercase";
export const EYEBROW_H = "h-3.5";

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

/** A figure's ink. A healthy reading stays plain ink; only a fault takes a role. */
export const FIGURE_INK = {
  ok: "text-on-surface",
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const satisfies Record<Tone, string>;

/** The History figures stay plain ink; the alert glyph carries the verdict. */
export const ALERT_INK = {
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const satisfies Record<Exclude<Tone, "ok">, string>;

/** A site's latency: it reads as a verdict against the limit, so healthy is green. */
export const SITE_INK = {
  ok: "text-success-on-surface",
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const satisfies Record<Tone, string>;

export const BAR_FILL = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const satisfies Record<Tone, string>;

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
// Right now
// -----------------------------------------------------------------------------

export const NOW = {
  /** The badge slot in the header; the skeleton pill matches the chip's box. */
  BADGE_SK: "h-[1.375rem] w-24 rounded-pill",
  FIGURE: "flex flex-col gap-2.5",
  VALUE:
    "flex items-baseline gap-1.5 text-[2.5rem] leading-10 font-bold tracking-[-0.02em] tabular-nums",
  VALUE_H: "h-10",
  VALUE_UNIT: "text-on-surface-variant text-base font-semibold tracking-normal",
  /** Gap between the pairs of a two-part outage length (2 h 5 min). */
  VALUE_PAIR: "ml-2",
  /** No reading and no last answer: a quiet dash, never a red phrase. */
  VALUE_DASH: "text-on-surface-variant",
  CAPTION: "text-on-surface-variant truncate text-[0.8125rem] leading-5 tabular-nums",
  CAPTION_H: "h-5",
  /** The RTT bar: 8px, scaled to twice the cut, a tick at the cut. */
  BAR: "relative h-2 rounded-pill bg-surface-container-high",
  BAR_FILL: "absolute inset-y-0 left-0 rounded-pill",
  BAR_TICK:
    "bg-on-surface-variant absolute -inset-y-[3px] left-1/2 w-0.5 -translate-x-1/2 rounded-pill opacity-55",
} as const;

export const STRIP = {
  ROOT: "flex flex-col gap-1.5",
  BARS: "grid h-11 auto-cols-[minmax(0,1fr)] grid-flow-col items-end gap-0.5",
  BARS_H: "h-11",
  BAR: "block min-h-[3px] rounded-[2px]",
  EMPTY: "bg-surface-container-high h-[3px]",
  /** A missed probe is an empty track with a red base tick: a gap, not a wall. */
  MISS: "bg-surface-container-high relative h-full after:absolute after:inset-x-0 after:bottom-0 after:h-[5px] after:rounded-[2px] after:bg-destructive",
  FOOT: "text-on-surface-variant flex justify-between text-[0.71875rem] leading-4 tabular-nums",
  /** The bars' box anchors the hover readout; it sits above the bars, clamped to the card. */
  HOVER_ROOT: "relative touch-pan-y",
  READOUT:
    "bg-surface-container-high pointer-events-none absolute bottom-full z-10 mb-2 grid min-w-[6.5rem] -translate-x-1/2 gap-0.5 rounded-field px-3 py-2 text-xs leading-5 tabular-nums shadow-lg",
  READOUT_VALUE: "font-semibold",
  READOUT_AGE: "text-on-surface-variant",
  /** Bars other than the hovered one step back, like a chart cursor. */
  DIM: "opacity-40",
  BAR_FADE: "transition-[opacity,height,background-color] duration-[var(--duration-standard)] ease-standard",
  FOOT_H: "h-4",
} as const;

/** Receipt rows as pills on surface-container, restated from Cellular Information. */
export const ROWS = {
  ROOT: "mt-auto flex flex-col gap-[0.3125rem]",
  ROW: "flex h-[2.625rem] items-center justify-between gap-4 rounded-pill bg-surface-container px-4 text-[0.8125rem] leading-5 font-semibold",
  KEY: "text-on-surface-variant truncate",
  VALUE: "flex min-w-0 items-center gap-2 tabular-nums",
  QUIET: "text-on-surface-variant font-normal",
  MONO: "truncate font-mono text-[0.8125rem] font-semibold",
  /** The inline 56px loss lane beside its figure. */
  LANE: "relative h-2 w-14 flex-none rounded-pill bg-surface-container-high",
  LINK: "text-primary-on-surface inline-flex items-center gap-1 font-semibold hover:underline",
  LINK_GLYPH: "size-3.5",
  COUNT: 4,
} as const;

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

export const FIGS = {
  ROOT: "grid grid-cols-3 gap-4",
  FIG: "flex min-w-0 flex-col gap-1.5",
  VALUE:
    "text-on-surface flex min-w-0 items-center gap-1.5 text-[1.375rem] leading-7 font-bold tracking-[-0.01em] tabular-nums",
  VALUE_H: "h-7",
  /** A notch under the 22px figure, centred on its line box. */
  ALERT: "size-[1.125rem] flex-none",
  UNIT: "text-on-surface-variant ml-0.5 text-[0.8125rem] font-semibold tracking-normal",
} as const;

export const CHART = {
  /** 200px plot plus a 26px time axis; a pair card may grow it. */
  AREA: "relative min-h-[14.125rem] flex-1",
  FILL: "absolute inset-0 aspect-auto",
  /** Numbers, not classes: recharts takes them as props. */
  AXIS_W: 44,
  X_AXIS_H: 26,
  TICK_INK:
    "[&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:tabular-nums [&_.recharts-cartesian-axis-tick_text]:text-[0.6875rem] [&_.recharts-cartesian-axis-tick_text]:font-medium",
  LEGEND:
    "text-on-surface-variant flex h-4 flex-wrap items-center gap-4 text-xs leading-4 font-medium",
  LEGEND_H: "h-4",
  LEGEND_ENTRY: "inline-flex items-center gap-1.5",
  LEGEND_SWATCH: "h-[3px] w-3.5 flex-none rounded-pill bg-primary",
  LEGEND_DASH: "border-chart-threshold h-0 w-3.5 flex-none border-t-2 border-dashed",
  TOOLTIP:
    "bg-surface-container-high grid min-w-[9rem] gap-1 rounded-field px-3 py-2 text-xs leading-5 tabular-nums shadow-lg",
  TOOLTIP_ROW: "flex items-center justify-between gap-4",
  TOOLTIP_KEY: "text-on-surface-variant",
} as const;

// -----------------------------------------------------------------------------
// Sites
// -----------------------------------------------------------------------------

/** Bare cells (One-Nest): three columns on a phone, auto-fill on a wider card. */
export const SITES = {
  GRID: "grid grid-cols-3 gap-x-2 gap-y-5 @lg/card:grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] @lg/card:gap-x-3 @lg/card:gap-y-6",
  CELL: "flex min-w-0 flex-col items-center gap-1.5 text-center",
  TILE: "bg-surface-container-high mb-1 grid size-14 flex-none place-items-center rounded-tile",
  MARK: "size-7",
  MONOGRAM: "text-on-surface-variant text-xl leading-none font-bold",
  /** Favicon and monogram share the plate's one grid cell and crossfade. */
  STACK: "*:col-start-1 *:row-start-1",
  FAVICON: "size-7 rounded-inline object-contain",
  FADE: "transition-opacity duration-[var(--duration-standard)] ease-standard",
  LABEL: "max-w-full truncate text-[0.8125rem] leading-5 font-medium",
  LABEL_H: "h-5",
  VALUE: "text-[0.8125rem] leading-5 font-semibold tabular-nums",
  VALUE_H: "h-5",
  QUIET: "text-on-surface-variant font-medium",
  CHECKING: "opacity-45",
  /** The default list length, so a first-load skeleton matches the usual grid. */
  SKELETON_COUNT: 13,
} as const;

// -----------------------------------------------------------------------------
// Manage sites dialog
// -----------------------------------------------------------------------------

export const DIALOG = {
  /** A card container, so the interval pill can fall back to a Select on a phone. */
  CONTENT: "@container/card gap-5 rounded-card sm:max-w-xl",
  ROW: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
  ROW_LABEL: "text-[0.84375rem] font-medium",
  WELL: "bg-surface-container max-h-72 overflow-y-auto rounded-tile",
  LIST: "divide-border flex flex-col divide-y py-1",
  ITEM: "grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 pr-2 pl-3.5",
  LOGO: "bg-surface-container-high grid size-8 flex-none place-items-center rounded-inline",
  LOGO_MARK: "size-4",
  LOGO_FAVICON: "size-4 rounded-[2px] object-contain",
  LOGO_MONOGRAM: "text-on-surface-variant text-[0.8125rem] leading-none font-bold",
  HOST: "font-mono text-[0.78125rem] leading-5 font-medium [overflow-wrap:anywhere]",
  EMPTY: "text-on-surface-variant px-3.5 py-3 text-sm",
  ADD: "flex gap-2",
  ERROR: "text-destructive-on-surface -mt-3 text-[0.78125rem]",
  FOOTER: "flex-row items-center justify-end gap-2",
  COUNT: "text-on-surface-variant me-auto text-[0.78125rem] tabular-nums",
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

/** A stale-data notice: non-blocking, above the content, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

/** A quiet fact above the content: the link is down, so the figures below are expected. */
export const NOTICE_QUIET =
  "rounded-field bg-surface-container text-on-surface-variant flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";

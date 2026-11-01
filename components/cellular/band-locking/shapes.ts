import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { BandCategory } from "@/types/band-locking";

// =============================================================================
// Band Locking — shared geometry and tone contract
// =============================================================================
// Ported back from RM551E v0.1.34 (itself a port of this file). RM520N keeps
// three categories: RM551E's NR-DC slot is not ported (unverified here).
//
// Two kinds of object: the STATUS CARD (`BAND_HERO`) reports what the modem is doing; the CATEGORY CARDS change it.
// Loading, empty and loaded branches import their shell from here so they cannot disagree on radius.
//
// TWO-AXIS BAND CHIP: SELECTED (draft) rides the FILL, LIVE (on the modem now) rides a 2px inset `--primary` RING, so
// pending adds and removals show before Apply; an inset shadow, not a border, so the grid never reflows.
// =============================================================================

/** The page's status card. `rounded-hero` (20px), one per surface. */
export const BAND_HERO =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/** One category card. `rounded-card` (16px), a peer in a grid. */
export const BAND_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 24px on a peer card (the hero bakes in 28px). */
export const CARD_PAD = "px-6";

// -----------------------------------------------------------------------------
// The status card
// -----------------------------------------------------------------------------

/** On-air panel beside the posture rail; stacks below `@2xl/hero`, panels stretch to one height. */
export const HERO_SPLIT =
  "flex flex-col gap-4 @2xl/hero:flex-row @2xl/hero:items-stretch";

export const HERO_ONAIR_PANEL =
  "@container/onair flex min-w-0 flex-1 flex-col gap-4 rounded-card bg-surface-container px-6 py-6";

export const HERO_RAIL_PANEL =
  "flex w-full flex-none flex-col gap-3.5 rounded-card bg-surface-container px-5 py-6 @2xl/hero:w-[25rem]";

export const HERO_RAIL_DISC =
  "grid size-11 flex-none place-items-center rounded-pill bg-primary text-primary-foreground";
export const HERO_RAIL_TITLE = "text-base font-semibold";
export const HERO_RAIL_SUBTITLE = "text-[13px] text-on-surface-variant";

/** A rail row: label + ratio, status chip, chevron. The row scrolls to the
 *  card that changes it, so the chevron is a real affordance. */
export const HERO_RAIL_ROW =
  "group flex w-full items-center gap-3 rounded-field bg-surface px-4 py-3 text-left transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none";
export const HERO_RAIL_ROW_LABEL = "text-sm font-semibold";
export const HERO_RAIL_ROW_RATIO = "text-xs text-on-surface-variant tabular-nums";

/** The failover row's floor, shared with its skeleton. A floor rather than a
 *  pin because the row wraps on a narrow container. */
export const HERO_ROW_MIN_H = "min-h-[3.25rem]";

/** Failover, at hero level spanning both panels: one watcher covers the whole
 *  modem, so it is not a fourth row of the category rail. */
export const HERO_ROW = `flex ${HERO_ROW_MIN_H} flex-wrap items-center gap-x-4 gap-y-3 rounded-field bg-surface-container px-5 py-3`;
export const HERO_ROW_LABEL = "text-sm font-semibold";

/** The carrier grid: a fixed 3-column ceiling stepping on the panel's own width. */
export const HERO_ONAIR_GRID =
  "grid flex-1 grid-cols-1 gap-3 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3";

/** One on-air tile's floor, shared with its skeleton (Skeleton-Mirror Rule). */
export const ONAIR_TILE_MIN_H = "min-h-[8.5rem]";

/**
 * One on-air tile: neutral body, identity on the disc, so the RSRP ramp lands on the numeral and bar.
 */
export const HERO_ONAIR_TILE = {
  ROOT: `relative flex ${ONAIR_TILE_MIN_H} flex-col gap-2.5 rounded-tile bg-surface px-5 py-4`,
  TOP: "flex items-center gap-3",
  DISC: "grid size-10 flex-none place-items-center rounded-pill",
  TEXT: "grid min-w-0 flex-1 gap-1",
  BAND_ROW: "flex flex-wrap items-baseline gap-2 pr-14",
  /** A band is a quantity you read (Rethink + tabular-nums, not mono). */
  BAND: "text-2xl leading-none font-semibold tabular-nums text-on-surface",
  BANDWIDTH:
    "absolute top-4 right-5 text-xs font-semibold tabular-nums text-on-surface-variant",
  /** EARFCN / PCI are quantities too. */
  DETAIL:
    "flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-on-surface-variant",
  METRICS_GROUP: "mt-auto flex flex-col gap-1",
  RSRP_ROW: "flex items-baseline gap-1.5",
  RSRP: "text-lg font-semibold tabular-nums",
  RSRP_UNIT: "text-xs font-medium text-on-surface-variant",
} as const;

/** Identity disc fill: NR on the brand, LTE on its identity role. Never quality. */
export function carrierDiscTone(technology: "LTE" | "NR"): string {
  return technology === "NR"
    ? "bg-primary text-primary-foreground"
    : "bg-lte text-lte-foreground";
}

/** One signal-bars mark for both: the disc fill (NR brand, LTE identity) carries the difference. */
export const CARRIER_DISC_GLYPH: Record<"LTE" | "NR", MaterialSymbolName> = {
  NR: "signal_cellular_alt",
  LTE: "signal_cellular_alt",
};

// -----------------------------------------------------------------------------
// The band chip
// -----------------------------------------------------------------------------

export const BAND_CHIP_LIVE_RING = "shadow-[inset_0_0_0_2px_var(--primary)]";

export const BAND_CHIP = {
  /** Wraps rather than scrolls: a hidden band is an unlockable band. */
  GRID: "flex flex-wrap gap-2",
  /**
   * One chip: paints at 40px, the `before:` overlay lifts the hit area to the 44px coarse-pointer floor. Named
   * transition properties, never `transition-all`.
   */
  ROOT: [
    "relative inline-flex h-10 min-w-[3.5rem] items-center justify-center rounded-pill px-3.5",
    "text-[0.8125rem] font-semibold tabular-nums select-none",
    "transition-[color,background-color,box-shadow] duration-[var(--duration-standard)] ease-standard",
    "before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-['']",
    "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ].join(" "),
  SKELETON: "h-10 w-[3.5rem] rounded-pill",
} as const;

/** Fill by SELECTED. Brand container, never a functional role. Hovers are
 *  `enabled:`-scoped so a gated grid does not advertise an interaction. */
function bandChipFill(selected: boolean): string {
  return selected
    ? "bg-primary-container text-on-primary-container enabled:hover:bg-primary-container/80"
    : "bg-surface-container text-on-surface-variant enabled:hover:bg-surface-container-high";
}

export function bandChipClass(selected: boolean, live: boolean): string {
  return [BAND_CHIP.ROOT, bandChipFill(selected), live ? BAND_CHIP_LIVE_RING : ""]
    .filter(Boolean)
    .join(" ");
}

/** The sentence a chip announces: three states, not a colour. */
export function bandChipA11yKey(selected: boolean, live: boolean): string {
  const base = "band_locking.a11y";
  if (selected && live) return `${base}.band_live`;
  return selected ? `${base}.band_selected` : `${base}.band_unselected`;
}

export const BAND_LEGEND = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant",
  ITEM: "inline-flex items-center gap-1.5",
  SWATCH_SELECTED: "size-3 rounded-pill bg-primary-container",
  SWATCH_LIVE: `size-3 rounded-pill bg-surface-container ${BAND_CHIP_LIVE_RING}`,
} as const;

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

export type FailoverKey = "disabled" | "fallback" | "monitoring" | "ready";

/** Failover verdict chip. Every state wears its own glyph: `success` and
 *  `warning` containers are 1.03:1 apart, so the glyph is the only separation. */
export const FAILOVER_BADGE: Record<
  FailoverKey,
  { variant: BadgeVariant; glyph: MaterialSymbolName; spin?: boolean }
> = {
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  fallback: { variant: "warning", glyph: "warning" },
  monitoring: { variant: "info", glyph: "progress_activity", spin: true },
  ready: { variant: "success", glyph: "check_circle" },
};

export function failoverKey(failover: {
  enabled: boolean;
  activated: boolean;
  watcher_running?: boolean;
}): FailoverKey {
  if (!failover.enabled) return "disabled";
  // A watcher that already fired reports a fallback, not progress.
  if (failover.activated) return "fallback";
  if (failover.watcher_running) return "monitoring";
  return "ready";
}

export type BandPosture = "locked" | "unrestricted" | "unknown" | "unavailable";

/**
 * Category status -> chip. `locked` is `warning` (a narrowed list can cost the connection); `scenario` is `info`
 * (something else owns it).
 */
export const CATEGORY_BADGE: Record<
  BandPosture | "scenario",
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  scenario: { variant: "info", glyph: "shield" },
  unrestricted: { variant: "success", glyph: "lock_open" },
  locked: { variant: "warning", glyph: "lock" },
  unknown: { variant: "muted", glyph: "help" },
  unavailable: { variant: "muted", glyph: "visibility_off" },
};

export const BADGE_GLYPH_SIZE = 12;

/**
 * `hasReading` is a parameter because an empty locked list only arrives when `current.sh` failed, while the poller's
 * supported list stays populated, so the arrays alone would report "0 of 31 locked".
 */
export function categoryPosture(
  locked: number[],
  supported: number[],
  hasReading: boolean,
): BandPosture {
  if (!hasReading) return "unavailable";
  if (supported.length === 0) return "unknown";
  if (locked.length === 0) return "locked";
  return locked.length >= supported.length &&
    supported.every((b) => locked.includes(b))
    ? "unrestricted"
    : "locked";
}

/** The rail disc summarises the rows beneath it, so it speaks their glyphs. */
export const POSTURE_GLYPH: Record<BandPosture, MaterialSymbolName> = {
  locked: "lock",
  unrestricted: "lock_open",
  unknown: "help",
  unavailable: "visibility_off",
};

// -----------------------------------------------------------------------------
// Skeleton mirrors
// -----------------------------------------------------------------------------

export const SKELETON_SHAPE = {
  CARD_TITLE: "h-5 w-28",
  CARD_DESC: "h-4 w-52",
  CARD_CHIP: "h-5 w-24",
  CHIP: BAND_CHIP.SKELETON,
  CHIP_COUNT: 12,
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-44 rounded-pill",
  HERO_DISC: "size-11 rounded-pill",
  RAIL_ROW: "h-[3.375rem] w-full rounded-field",
  HERO_ROW: `${HERO_ROW_MIN_H} w-full rounded-field`,
  ONAIR_TILE: `${ONAIR_TILE_MIN_H} rounded-tile`,
} as const;

// -----------------------------------------------------------------------------
// Category identity
// -----------------------------------------------------------------------------

/** The rail's order, and the category cards' order. */
export const RAIL_CATEGORIES: BandCategory[] = ["lte", "nsa_nr5g", "sa_nr5g"];

/** i18n stems keyed off the category, never off the rendered title. */
export const categoryTitleKey = (c: BandCategory) =>
  `band_locking.cards.${c}.title`;
export const categoryDescriptionKey = (c: BandCategory) =>
  `band_locking.cards.${c}.description`;
export const categoryShortKey = (c: BandCategory) =>
  `band_locking.card_category_label.${c}`;

/** The DOM id a rail row scrolls to. */
export const categoryCardId = (c: BandCategory) => `band-locking-card-${c}`;

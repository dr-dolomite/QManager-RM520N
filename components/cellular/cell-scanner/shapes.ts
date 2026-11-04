import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { TagVariant } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

// =============================================================================
// Cell Scanner family — shared geometry and tone contract
// =============================================================================
// One module for the sweep, the neighbour read and the calculator (its section is last).
// Rationale and history: docs/reference/cell-scanner.md.
// =============================================================================

// -----------------------------------------------------------------------------
// Page and section shells
// -----------------------------------------------------------------------------

/** The page column. Every route in this family opens with it. */
export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";

/** The anchor geometry, shared by the run hero and the calculator (no gap: see `RUN_HERO`). */
const HERO_SHELL =
  "@container/section flex flex-col rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * The run hero. No flex gap: `HERO_MORPH.BODY` carries the separation inside the
 * clip so a collapsed body leaves none. `cn()` so the phone padding replaces the shell's.
 */
export const RUN_HERO = cn(HERO_SHELL, "p-5 sm:p-7");

/** The calculator's results card. The scanning routes use `SCAN_RESULTS_CARD`. */
export const RESULTS_CARD =
  "@container/section flex flex-col gap-5 rounded-card border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/** The scanning routes' results card, on `RUN_HERO`'s padding so both cards share one edge on a phone. */
export const SCAN_RESULTS_CARD = cn(RESULTS_CARD, "p-5 sm:p-7");

/** The header row both sections share: stacked title and description, meta slot on the right. */
export const SECTION_HEAD = {
  ROOT: "flex flex-wrap items-start gap-x-6 gap-y-3",
  TITLES: "flex min-w-0 flex-col gap-1",
  TITLE: "text-base leading-normal font-semibold",
  DESC: "max-w-[56ch] text-sm text-on-surface-variant text-pretty",
  META: "ms-auto flex flex-wrap items-center gap-2",
} as const;

/**
 * Run-hero-only override for `SECTION_HEAD.META` (the calculator shares META).
 * Below `@xl/section` the link takes the left edge and the action the right.
 */
export const RUN_HERO_META =
  "w-full basis-full justify-between gap-y-2 ms-0 [&>:last-child]:ms-auto @xl/section:w-auto @xl/section:basis-auto @xl/section:justify-normal @xl/section:ms-auto @xl/section:[&>:last-child]:ms-0";

/** The hero's `0fr -> 1fr` height morph on the emphasized clock; `data-open` holds both states. */
export const HERO_MORPH = {
  WRAP: "grid grid-rows-[0fr] transition-[grid-template-rows] duration-[var(--duration-emphasized)] ease-emphasized motion-reduce:transition-none data-[open=true]:grid-rows-[1fr]",
  /** The zero min-height is what lets a grid row shrink below its content. */
  CLIP: "min-h-0 overflow-hidden",
  BODY: "pt-6",
} as const;

/**
 * The results card's error panel and the calculator's empty panels: a centred
 * stack one radius step below its host. Never an auto top margin on its last child.
 */
export const POSTURE = {
  ROOT: "flex min-h-[13rem] flex-col items-center justify-center gap-3 rounded-tile bg-surface-container p-6 text-center",
  /** 64px; glyph is 32px at the call site. */
  DISC: "grid size-16 flex-none place-items-center rounded-pill",
  TITLE: "text-sm font-semibold",
  BODY: "max-w-[22rem] text-xs/relaxed text-on-surface-variant text-pretty",
} as const;

/**
 * The scanning routes' "the run listed nothing" panel — reached only after a
 * completed run with zero rows. No button: the hero above owns the action.
 */
export const EMPTY_PANEL =
  "min-h-[13rem] rounded-tile border border-dashed border-outline";

/** The cross-link to the sibling route. `aria-disabled` so a blocked link can still host its reason. */
export const HERO_LINK = {
  ROOT: "h-9 gap-2 px-4 text-xs font-semibold aria-disabled:opacity-60",
} as const;

// -----------------------------------------------------------------------------
// The ledger — the run's status cell and its group rows, as one object
// -----------------------------------------------------------------------------

/**
 * One `rounded-tile` fill: a status cell, then (scanning/complete only) a rows
 * region. `ROOT_SPLIT` and `STATUS_DIVIDER` are appended only when rows exist.
 */
export const LEDGER = {
  ROOT: "grid grid-cols-1 overflow-hidden rounded-tile bg-surface-container",
  ROOT_SPLIT: "@2xl/section:grid-cols-[minmax(0,14.5rem)_minmax(0,1fr)]",

  /** A strip on a phone, a full-height track beside the rows from `@2xl/section`. */
  STATUS_ROOT:
    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3.5 @2xl/section:grid-cols-[auto_minmax(0,1fr)] @2xl/section:grid-rows-[auto_1fr] @2xl/section:items-start @2xl/section:gap-y-[18px] @2xl/section:px-5 @2xl/section:py-[18px] @2xl/section:min-h-[8rem]",
  STATUS_DIVIDER:
    "border-b border-border @2xl/section:border-b-0 @2xl/section:border-r",
  /** 36px narrow, 40px wide; glyph is 20px at the call site. */
  STATUS_DISC:
    "grid size-9 flex-none place-items-center rounded-pill @2xl/section:size-10",
  STATUS_TEXT: "flex min-w-0 flex-col gap-0.5",
  STATUS_TITLE: "text-sm font-semibold text-pretty",
  /** The modem's own error string, in machine voice. */
  STATUS_TITLE_MACHINE: "font-mono text-[13px] font-semibold text-pretty",
  STATUS_BODY: "text-xs text-on-surface-variant text-pretty",
  /** The complete posture: the check beside the figure, held at the top of the cell. */
  SUMMARY_ROOT:
    "grid grid-cols-[auto_minmax(0,1fr)] content-start items-center gap-x-3 px-4 py-3.5 @2xl/section:px-5 @2xl/section:py-[18px]",
  /** The run's total, never a count of rendered rows. */
  SUMMARY_FIG: "flex min-w-0 items-baseline gap-1.5",
  SUMMARY_FIG_NUM:
    "tabular-nums text-[28px] font-semibold leading-none tracking-tight @2xl/section:text-[40px]",
  SUMMARY_FIG_UNIT: "text-sm font-semibold text-on-surface-variant",
  /** The sweep's estimated-progress bar. */
  STATUS_BAR:
    "col-span-3 mt-3 @2xl/section:col-span-2 @2xl/section:mt-0 @2xl/section:self-end",

  /** Its own container, so a row responds to the rows region's width, not the card's. */
  ROWS_ROOT: "@container/rows flex min-w-0 flex-col",
  /** Wide-only column header; `aria-hidden` at the call site. */
  HEAD: "hidden text-xs font-medium text-on-surface-variant @lg/rows:grid @lg/rows:grid-cols-[minmax(0,1.25fr)_3.25rem_minmax(0,1fr)_6rem_5.25rem] @lg/rows:gap-x-3.5 @lg/rows:px-5 @lg/rows:pt-3 @lg/rows:pb-2",
  HEAD_BEST: "col-start-4 col-span-2 text-right",

  /** A two-line receipt on a phone, one five-track grid from `@lg/rows`. */
  ROW: "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3.5 @lg/rows:grid-cols-[minmax(0,1.25fr)_3.25rem_minmax(0,1fr)_6rem_5.25rem] @lg/rows:gap-x-3.5 @lg/rows:gap-y-0 @lg/rows:px-5 @lg/rows:py-[11px]",
  /** Appended from the second rendered row on. */
  ROW_DIVIDER: "border-t border-border",

  NAME: "col-start-1 row-start-1 flex min-w-0 items-center gap-2",
  NAME_TEXT: "min-w-0 truncate text-sm font-semibold",
  /** A provider the modem named only by its numeric codes. */
  NAME_TEXT_MACHINE: "min-w-0 truncate font-mono text-[13px] font-semibold",
  /** Display-contents from `@lg/rows`, so its two children fall into the count and bands tracks. */
  META: "col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @lg/rows:contents",
  CELLS:
    "tabular-nums text-[13px] font-semibold whitespace-nowrap text-on-surface-variant @lg/rows:text-sm @lg/rows:font-normal @lg/rows:text-on-surface @lg/rows:text-right",
  CELLS_UNIT: "font-medium text-on-surface-variant @lg/rows:hidden",
  BANDS: "flex min-w-0 flex-wrap items-center gap-1",
  CHIP: "col-start-2 row-start-2 flex justify-self-end @lg/rows:col-auto @lg/rows:row-auto",
  DBM: "col-start-2 row-start-1 flex items-baseline gap-0.5 justify-self-end @lg/rows:col-auto @lg/rows:row-auto",
  DBM_VALUE:
    "whitespace-nowrap text-right tabular-nums font-semibold text-[15px] @lg/rows:text-sm",
  DBM_UNIT: "text-xs font-semibold text-on-surface-variant",
  DBM_NONE: "text-on-surface-variant",

  /** A completed run that grouped into nothing — padded like a row. */
  EMPTY: "px-4 py-3.5 text-sm text-on-surface-variant text-pretty @lg/rows:px-5",
} as const;

/** The verdict strip below the ledger, shown only when it has something true to say. */
export const VERDICT = {
  ROOT: "flex items-start gap-2.5 rounded-field px-4 py-3",
  TEXT: "text-xs/relaxed text-pretty",
} as const;

/** The verdict's tone. Keyed so a tone without a container pair fails the build. */
export type VerdictTone = "muted" | "success" | "warning" | "destructive";

export const VERDICT_TONE: Record<VerdictTone, string> = {
  /** One step off the card's `surface`, so it never reads as a wider ledger. */
  muted: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
};

// -----------------------------------------------------------------------------
// Value voice
// -----------------------------------------------------------------------------

/** Band, EARFCN, PCI, Cell ID, TAC, channel: quantities, so interface face with tabular figures. */
export const IDENT = "text-[13px] tabular-nums";

/** Readings: RSRP, RSRQ, SINR, RSSI, a computed frequency, any count. */
export const FIGURE = "tabular-nums";

// -----------------------------------------------------------------------------
// The results table
// -----------------------------------------------------------------------------

export const TABLE = {
  SHELL: "overflow-x-auto rounded-tile bg-surface-container",
  ROOT: "min-w-[38rem]",
  HEAD: "sticky top-0 z-10 bg-surface-container",
  /** Pins the row at 40px so `SKELETON_SHAPE.ROW` mirrors it. */
  ROW: "text-[13px]/5",
  /** Every second rendered row; applied in JS so `ROW_HOVER` always wins. */
  ROW_STRIPE: "bg-surface-container-high",
  ROW_HOVER: "hover:bg-surface focus-within:bg-surface",
  IDENT,
  FIGURE,
} as const;

/** Filter, toolbar actions, the icon-only column menu. The count lives on the pager row. */
export const TOOLBAR = {
  ROOT: "flex flex-wrap items-center gap-3",
  FILTER: "max-w-[18rem]",
  ACTIONS: "ms-auto flex flex-wrap items-center gap-2",
  COUNT: "text-xs tabular-nums text-on-surface-variant",
} as const;

/** The strip under the table: what a row can do (left), what the rows add up to (right). */
export const TABLE_NOTE = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-field bg-surface-container px-4 py-3",
  TEXT: "min-w-[16rem] flex-1 text-xs/relaxed text-on-surface-variant text-pretty",
  TALLY:
    "ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-on-surface-variant",
} as const;

/** Pagination, under the table; rendered only when the set pages. */
export const PAGER = {
  ROOT: "flex flex-wrap items-center gap-3",
  ACTIONS: "ms-auto flex items-center gap-2",
  /** `chevron_left` is not in the subset. Rotating the right chevron is the house precedent. */
  BACK_GLYPH: "rotate-180",
} as const;

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/** Primary and secondary actions use `size="action"`. A third action is `tonal-neutral` + `PILL_QUIET`, never ghost. */
export const PILL_QUIET = "h-9 px-3.5 text-xs font-semibold";

/** Every glyph rendered inside a `Badge`, on every surface in the product. */
export const BADGE_GLYPH_SIZE = 12;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------
// Every posture and tier carries a DISTINCT glyph: success- and warning-container
// measure 1.03:1 apart, so the glyph is the only separation.

export type RunPosture = "idle" | "scanning" | "complete" | "failed";

/** The status disc's mark. */
export const POSTURE_GLYPH: Record<
  RunPosture,
  { glyph: MaterialSymbolName; filled: boolean }
> = {
  idle: { glyph: "radar", filled: false },
  scanning: { glyph: "progress_activity", filled: false },
  complete: { glyph: "check_circle", filled: true },
  failed: { glyph: "error", filled: true },
};

/** The worker's transport status -> the surface's posture. */
export function runPosture(
  status: "idle" | "running" | "complete" | "error",
): RunPosture {
  switch (status) {
    case "running":
      return "scanning";
    case "complete":
      return "complete";
    case "error":
      return "failed";
    default:
      return "idle";
  }
}

/** The status disc's fill, one tone step into the role. */
export const POSTURE_DISC: Record<RunPosture, string> = {
  idle: "bg-surface-container-high text-on-surface-variant",
  scanning: "bg-primary-container text-on-primary-container",
  complete: "bg-tone-success-1 text-success-on-surface",
  failed: "bg-tone-destructive-1 text-destructive-on-surface",
};

/**
 * Three tiers at -85/-100 dBm, deliberately NOT `RSRP_THRESHOLDS`: a scan rates
 * candidate cells, not the camped one. `none` is the worker's 0 sentinel, muted.
 */
export type SignalTier = "good" | "fair" | "poor" | "none";

export const SIGNAL_BADGE: Record<
  SignalTier,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  good: { variant: "success", glyph: "signal_cellular_3_bar" },
  fair: { variant: "warning", glyph: "signal_cellular_2_bar" },
  poor: { variant: "destructive", glyph: "signal_cellular_1_bar" },
  none: { variant: "muted", glyph: "signal_cellular_off" },
};

const SIGNAL_GOOD_DBM = -85;
const SIGNAL_FAIR_DBM = -100;

export function signalTier(strength: number | null | undefined): SignalTier {
  // 0 dBm is the workers' "unreported" sentinel, not a reading.
  if (strength === null || strength === undefined || strength === 0)
    return "none";
  if (strength >= SIGNAL_GOOD_DBM) return "good";
  if (strength >= SIGNAL_FAIR_DBM) return "fair";
  return "poor";
}

/** Radio identity, an outline `Tag` variant — never a verdict. */
export function networkIdentity(networkType: string): TagVariant {
  return networkType.toUpperCase().startsWith("NR") ? "nr" : "lte";
}

// -----------------------------------------------------------------------------
// Skeleton mirrors — ALWAYS LAST
// -----------------------------------------------------------------------------

/** Loaded geometry restated once, so skeletons mirror it by import. Sizes are line boxes. */
export const SKELETON_SHAPE = {
  TITLE: "h-6 w-40 rounded-inline",
  DESC: "h-5 w-56 rounded-inline",
  CHIP: "h-[1.375rem] w-24 rounded-pill",
  /** Mirrors `LEDGER.STATUS_DISC`'s narrow size. */
  LEDGER_DISC: "size-9 flex-none rounded-pill",
  LEDGER_ROW_NAME: "h-4 w-28 rounded-inline",
  LEDGER_ROW_CELLS: "h-3.5 w-10 rounded-inline",
  LEDGER_ROW_BANDS: "h-4 w-16 rounded-inline",
  LEDGER_ROW_CHIP: "h-[1.375rem] w-16 rounded-pill",
  LEDGER_ROW_DBM: "h-4 w-14 rounded-inline",
  /** How many row placeholders the ledger draws while scanning. */
  LEDGER_ROWS: 2,
  /** Mirrors `HERO_LINK.ROOT`'s height. */
  LINK: "h-9 w-40 rounded-pill",
  /** Mirrors `TOOLBAR.FILTER`. */
  FILTER: "h-[2.625rem] w-[18rem] max-w-full rounded-field",
  /** Mirrors `TABLE.ROW`'s resolved 40px height. */
  ROW: "h-10 w-full rounded-inline",
  /** Mirrors the action Button size's height. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// The frequency calculator
// -----------------------------------------------------------------------------
// The anchor geometry without the run vocabulary: no posture, clock, spinner or cost — nothing runs here.
// Controls sit left and the answer rail right (`CALC_SPLIT`); readings are Rethink + tabular-nums.

/** Channel numbers and bands are quantities you read, so interface face, not the scanner's mono `IDENT`. */
const CALC_IDENT = "text-[13px] tabular-nums";

/**
 * `HERO_SHELL` PLUS THE GAP, rather than `RUN_HERO`, which it used to alias.
 *
 * The alias stopped being honest when the run hero dropped its `gap-5` for the
 * idle collapse (see `RUN_HERO`). Nothing on the calculator collapses — the
 * readout rail and the form are both always present — so its sections are
 * separated by a real flex gap, exactly as before. The geometry that genuinely
 * IS shared is still shared, by both reading from `HERO_SHELL`, so a retune of
 * the anchor's radius, padding or shadow still moves the two together.
 */
export const CALC_HERO = `${HERO_SHELL} gap-5`;

/** Controls first, answer second; calculator-only. */
export const CALC_SPLIT =
  "grid grid-cols-1 gap-4 @3xl/section:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] @3xl/section:items-stretch";

/** The answer rail: a horizontal row whose min height matches the ledger's status cell. */
export const CALC_RAIL = {
  ROOT: "flex min-h-[6.5rem] min-w-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-tile bg-surface-container px-5 py-4",
  /** 56px; the glyph is 28px at the call site. */
  DISC: "grid size-14 flex-none place-items-center rounded-pill",
  /** The swapped value, then the unanimated channel caption under it. */
  FIGURE: "flex min-w-0 flex-col gap-1.5",
  FIGURE_VALUE: "flex items-baseline gap-1.5",
  /** Pinned to the rail's right edge, mirroring the figure block on the left. */
  IDENTITY: "ms-auto flex flex-col items-end gap-1.5 text-right",
  IDENTITY_ROW: "flex flex-wrap items-center justify-end gap-2",
  /** The idle/failed message column; `flex-1` claims the row's slack. */
  MESSAGE: "flex min-w-[12rem] flex-1 flex-col gap-0.5",
} as const;

/** The rail's type. 40px figure: the widest value ("3489.42") plus unit still fits beside the identity block. */
export const READOUT = {
  FIGURE: "text-[40px] font-semibold leading-none tabular-nums tracking-tight",
  UNIT: "text-sm font-semibold text-on-surface-variant",
  CHANNEL: `${CALC_IDENT} text-on-surface-variant`,
  BAND: "text-sm font-semibold tabular-nums",
  /** The band's name, or the "several bands" line. */
  CAPTION: "text-xs text-on-surface-variant",
  TITLE: "text-sm font-semibold",
  BODY: "text-xs/relaxed text-on-surface-variant text-pretty",
} as const;

/**
 * Readout disc tones.
 *
 * `lte` and `nr` are IDENTITY, never health — they say which radio family owns
 * the answer, exactly as the `NetworkTypeBadge` beside them does. The rule that
 * identity fills must carry their meaning non-chromatically is satisfied by the
 * band label and the badge directly beneath the disc, both of which say "n78"
 * or "B3" in words.
 *
 * `idle` and `failed` are not identities and take the neutral and destructive
 * steps. Four states, four distinct glyphs at the call site — `tune`, then
 * `graphic_eq` for either radio, then `error`.
 */
export const READOUT_DISC: Record<"idle" | "lte" | "nr" | "failed", string> = {
  idle: "bg-surface-container-high text-on-surface-variant",
  lte: "bg-lte-container text-on-lte-container",
  nr: "bg-primary-container text-on-primary-container",
  failed: "bg-tone-destructive-1 text-destructive-on-surface",
};

/** The form column: a label/mode row over an input/button row, centred in the rail-height cell. */
export const FORM = {
  ROOT: "flex h-full flex-col justify-center gap-3",
  TOP: "flex flex-wrap items-center justify-between gap-2",
  LABEL: "text-sm font-medium",
  /** Fixed 13.5rem so three one-word choices read as one control, not three stretched buttons. */
  TABS: "grid h-[2.125rem] w-[13.5rem] grid-cols-3 rounded-pill bg-surface-container p-1",
  TAB: "rounded-pill text-xs",
  ROW: "flex gap-2",
  INPUT: `min-w-0 flex-1 ${CALC_IDENT} placeholder:text-sm`,
} as const;

/**
 * Matching bands: ONE well (the card's one inner container), a hairline section per band,
 * each a Downlink/Uplink table. `@container/band` lets a phone-width section drop the note column.
 */
export const BAND_TILE = {
  /** `flex-1` so the well grows with the paired card's equal-height row. */
  WELL: "flex min-w-0 flex-1 flex-col rounded-tile bg-surface-container",
  HEAD: "flex flex-wrap items-baseline gap-x-2 gap-y-1",
  BAND: "text-sm font-semibold tabular-nums",
  NAME: "min-w-0 text-sm text-on-surface-variant",
  DUPLEX: "ms-auto",
  SECTION: "@container/band flex flex-col gap-3 border-t border-border p-5 first:border-t-0",
  TABLE: "w-full border-collapse text-[13px]",
  /** Fixed key column so Downlink/Uplink start at the same x band to band. */
  TH: "w-[5.5rem] @md/band:w-[7.5rem] px-0 pt-0 pb-2 pr-3 text-left align-bottom text-xs font-medium whitespace-nowrap text-on-surface-variant",
  TH_DIRECTION: "pr-3 pb-2 text-left align-bottom text-xs font-medium whitespace-nowrap text-on-surface-variant",
  TD: "border-t border-border py-1.5 pr-3 align-middle leading-5",
  TD_KEY: "text-on-surface-variant",
  TD_VALUE: `${FIGURE} font-medium @md/band:whitespace-nowrap`,
  /** The quiet "of low – high" half of a channel cell. */
  OF_RANGE: "block font-normal text-on-surface-variant @md/band:inline",
  TD_NOTE: "border-t border-border py-1.5 align-top text-xs/relaxed text-pretty text-on-surface-variant",
  /** TDD/SDL note: a spanning third column from `@md/band` up, a closing full-width row below it. */
  WIDE_ONLY: "hidden @md/band:table-cell",
  NOTE_ROW: "@md/band:hidden",
  POSITION_TRACK: "relative h-1.5 max-w-48 rounded-pill bg-surface-container-high",
  POSITION_DOT: "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-container",
} as const;

/** Identity ink for the DL frequency cell and position dot; keyed so a missing radio fails the build. */
export const BAND_HIT_INK: Record<"lte" | "nr", { text: string; bg: string }> = {
  lte: { text: "text-lte-on-surface", bg: "bg-lte-on-surface" },
  nr: { text: "text-primary-on-surface", bg: "bg-primary-on-surface" },
};

/** A history row: recall and delete are sibling buttons in one `<li>`; `RECALL` is a 2x2 receipt grid. */
export const HISTORY_ROW = {
  LIST: "flex flex-col divide-y divide-border",
  ROOT: "group/row flex items-center",
  RECALL: "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-tile py-2.5 pr-1 pl-4 text-left hover:bg-surface-container-high",
  LEAD: "flex min-w-0 items-center gap-2",
  CHANNEL: `${CALC_IDENT} font-semibold`,
  FIGURE: `${FIGURE} text-right text-[13px] font-medium text-on-surface-variant`,
  BANDS: "min-w-0 truncate text-xs text-on-surface-variant",
  TIME: "text-right text-xs tabular-nums whitespace-nowrap text-on-surface-variant",
  /** Revealed on hover/focus, always shown under a coarse pointer, which has no hover. */
  DELETE: "mx-1 size-8 flex-none text-on-surface-variant opacity-0 transition-opacity duration-[var(--duration-quick)] ease-out group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
} as const;

/** Clearing local history is not a modem action: a quiet ghost pill, destructive only on hover. */
export const HISTORY_CLEAR =
  "text-on-surface-variant hover:bg-destructive-container hover:text-on-destructive-container";

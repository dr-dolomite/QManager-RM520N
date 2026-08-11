import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Cell Scanner family — shared geometry and tone contract
// =============================================================================
// The single source of truth for the shapes, tones and skeleton mirrors used by
// all three routes under `/cellular/cell-scanner/`: the full scan, the
// neighbour-cell read, and the frequency calculator.
//
// RESTATED, NOT IMPORTED. Several strings here are byte-identical to the
// tower-locking and frequency-locking contracts'. That is the house convention
// rather than an oversight — a surface takes no dependency on a sibling route's
// module graph, so tower locking can be re-shaped without silently re-shaping
// this page.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
// -----------------------------------------------------------------------------
// The incumbent surface had no contract, and the cost of that is measurable:
// `neighbourcell/` is a FORK of the parent scanner, not a sibling. The error
// block was byte-for-byte identical in both files; so were the action row, the
// lock dialog and the CSV builder. Because each was authored twice, the fork
// silently missed four things the parent later gained — the column-label map,
// the responsive column hiding, the filtered-result count, and the poller's
// stale-closure fix. Two copies of a layout do not stay equal; they diverge in
// one direction, and the copy nobody is looking at is the one that rots.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// Two kinds of object, in reading order, on BOTH scanning routes:
//
//   1. THE RUN HERO (`RUN_HERO`) is the premise: a scan is a RUN, with a cost, a
//      duration and a verdict. It is the page's anchor because it is the only
//      part that changes on its own — the table below it changes only when a run
//      completes.
//   2. THE RESULTS CARD (`RESULTS_CARD`) is the data, and nothing else.
//
// THE SPLIT IS THE WHOLE REDESIGN. The incumbent swapped its entire card body
// between four unrelated full-height layouts — an `Empty`, a centred spinner
// stack, a centred error stack, and the table — so "start a scan", "a scan is
// running" and "a scan failed" were three different pages that happened to share
// a route. Nothing was stable across them, which is exactly why the two routes
// could drift: every branch was hand-authored separately in each file.
//
// Split, the hero OWNS the run and the card OWNS the rows. The hero is always
// present and morphs through its posture; the card shows a skeleton, an empty
// state, or the table. That is what lets the two routes read as one feature
// while remaining two routes.
//
// -----------------------------------------------------------------------------
// THE COST ASYMMETRY IS DESIGN, NOT TRIVIA
// -----------------------------------------------------------------------------
// These two runs differ by roughly 100x in what they cost the modem.
// `AT+QSCAN=3,1` holds the single global AT mutex for 30-180 seconds and pauses
// every other modem operation; `AT+QENG="neighbourcell"` holds it for about two
// seconds. The incumbent expressed that difference NOWHERE — both routes shipped
// a button reading the identical string "Start New Scan".
//
// So `COST` is a required slot in the hero, not an optional flourish. Same
// shape on both routes, different content: the surface teaches the difference
// instead of leaving the reader to discover it by locking up their modem. This
// is the product's "make the dangerous obvious, the safe effortless" principle
// applied to the one axis where these two pages genuinely disagree.
// =============================================================================

// -----------------------------------------------------------------------------
// Page and section shells
// -----------------------------------------------------------------------------

/** The page column. Every route in this family opens with it. */
export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The run hero, and the page's anchor. `rounded-hero` (40px) — one per surface,
 * claimed by the section that leads the page.
 *
 * It declares `@container/section`, which `HERO_SPLIT` and `COST` query. The
 * container is named `section` rather than `hero` deliberately: the frequency
 * calculator hosts two sibling sections at this level, and a query written
 * against `/hero` would silently never match inside `RESULTS_CARD`.
 *
 * `shadow-whisper` as a bare utility does NOT resolve; it must go through the
 * custom property, exactly as written.
 */
export const RUN_HERO =
  "@container/section flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * The results card. Identical to `RUN_HERO` except its radius — `rounded-card`
 * (36px), because it is a peer below the anchor and not a second hero. Imported
 * by the loaded, loading, empty AND error branches so the four can never again
 * disagree about their own radius, which is how the incumbent ended up with a
 * `rounded-lg` table inside a `rounded-xl` card inside nothing.
 */
export const RESULTS_CARD =
  "@container/section flex flex-col gap-5 rounded-card border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * The header row both sections share. The description sits on the title's row
 * rather than under it: a section header is a signpost over content the reader
 * can already see, and stacking it spends two lines of rhythm restating what the
 * content demonstrates.
 *
 * `META` carries `ms-auto` rather than the root carrying `justify-between`,
 * because the row wraps — with three children and `justify-between`, a wrap
 * leaves the description marooned against the right edge of its own line.
 */
export const SECTION_HEAD = {
  ROOT: "flex flex-wrap items-center gap-x-3 gap-y-1.5",
  TITLE: "text-base font-semibold",
  DESC: "text-sm text-on-surface-variant",
  META: "ms-auto flex flex-wrap items-center gap-2",
} as const;

/**
 * The hero's two-panel split: a fixed posture rail beside the flexing run
 * detail. Collapses to one column below `@2xl/section`, which on the modem's
 * own narrow web view is the common case rather than the exception.
 */
export const HERO_SPLIT =
  "grid grid-cols-1 gap-4 @2xl/section:grid-cols-[minmax(0,17rem)_1fr]";

/**
 * The posture rail — a centred empty-state stack, one radius step DOWN from its
 * host (`rounded-tile` inside a `rounded-hero`).
 *
 * Counter-rule, learned on the frequency-locking surface: never put `mt-auto` on
 * the last child of this stack. It eats the free space and silently cancels the
 * centring the stack exists to provide.
 */
export const POSTURE = {
  ROOT: "flex min-h-[11rem] flex-col items-center justify-center gap-3 rounded-tile bg-surface-container p-6 text-center",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  TITLE: "text-sm font-semibold",
  BODY: "max-w-[22rem] text-xs/relaxed text-on-surface-variant text-pretty",
  /**
   * The elapsed clock and the result count both land here. Size derives from the
   * slot rather than a ramp step — per the Numeric rule, a literal `text-[Npx]`
   * is correct by construction here.
   *
   * `tabular-nums` in the INTERFACE font, not `font-mono`: an elapsed timer
   * changes while the reader watches without them acting, which is the exact
   * test the Machine-Voice Rule applies. Mono is for the identifiers in the
   * table below (EARFCN, PCI, Cell ID), which hold steady until something
   * reconfigures them.
   */
  CLOCK: "text-[28px] font-semibold leading-none tabular-nums tracking-tight",
} as const;

/**
 * The cost statement. A required slot, for the reason given in the file header.
 * `rounded-field` and a container fill rather than a tinted wash, so it reads as
 * a stated fact rather than as a warning the reader must clear.
 */
export const COST = {
  ROOT: "flex items-start gap-2.5 rounded-field bg-surface-container px-4 py-3",
  TEXT: "text-xs/relaxed text-on-surface-variant text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The results table
// -----------------------------------------------------------------------------

/**
 * The table shell. `overflow-x-auto` is what makes the header's `sticky top-0`
 * meaningful — the incumbent neighbour table set a sticky header inside a
 * horizontal-only scroll container, so it had no vertical scroll parent to stick
 * within and the stickiness was inert.
 */
export const TABLE = {
  SHELL: "overflow-x-auto rounded-tile bg-surface-container",
  ROOT: "min-w-[38rem]",
  HEAD: "sticky top-0 z-10 bg-surface-container",
  /** 13px/600 on an explicit 20px line box — pins the row at 40px so the skeleton's `h-10` mirrors it without restating a number. */
  ROW: "text-[13px]/5",
  /** Identifiers: band, EARFCN, PCI, Cell ID, TAC. These hold steady until something reconfigures them, so they are machine voice. */
  IDENT: "font-mono text-[13px] tabular-nums",
  /** Measurements: RSRP, RSRQ, SINR, RSSI. These are readings, so they take the interface font with tabular figures. */
  FIGURE: "tabular-nums",
} as const;

/**
 * The toolbar above the table: filter, column menu, count.
 *
 * The count is a CHANGING FIGURE and therefore interface-font `tabular-nums`,
 * never mono — and it must be assembled by the i18n layer's plural machinery,
 * never by a JS ternary. The incumbent hardcoded English pluralisation in both
 * copies (`filtered === 1 ? "cell" : "cells"`), which is wrong in four of the
 * five shipped locales before a translator ever sees it.
 */
export const TOOLBAR = {
  ROOT: "flex flex-wrap items-center gap-3",
  FILTER: "h-[2.625rem] max-w-[18rem] rounded-field",
  ACTIONS: "ms-auto flex flex-wrap items-center gap-2",
  COUNT: "text-xs tabular-nums text-on-surface-variant",
} as const;

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/** Primary and secondary pill actions. Restated from the sibling contracts by convention. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";
export const PILL_QUIET = "h-9 rounded-pill px-3.5 text-xs font-semibold";

/**
 * Never `variant="ghost"` for a third action here. On the frequency-locking
 * surface a ghost button sat beside a filled primary and an outlined secondary
 * and read as DISABLED rather than as a quieter third option, because it has no
 * resting fill at all. `variant="tonal-neutral"` + `PILL_QUIET` is the third
 * step.
 */

/** Every glyph rendered inside a `Badge`, on every surface in the product. */
export const BADGE_GLYPH_SIZE = 12;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------
// Keyed onto `BadgeVariant` and `MaterialSymbolName` rather than class strings,
// so a new posture without a matching role fails the build instead of shipping
// untinted. Every posture carries a DISTINCT glyph: `success-container` and
// `warning-container` measure 1.03:1 apart — the same surface to the eye, and
// identical under deuteranopia — so the glyph is the only thing separating a
// healthy state from a degraded one.

export type RunPosture = "idle" | "scanning" | "complete" | "failed";

export const RUN_BADGE: Record<
  RunPosture,
  { variant: BadgeVariant; glyph: MaterialSymbolName; filled: boolean }
> = {
  idle: { variant: "muted", glyph: "radar", filled: false },
  scanning: { variant: "info", glyph: "progress_activity", filled: false },
  complete: { variant: "success", glyph: "check_circle", filled: true },
  failed: { variant: "destructive", glyph: "error", filled: true },
};

/**
 * The posture disc's fill, one tone step into the role rather than an opacity
 * wash. The incumbent used `bg-primary/10` behind a `bg-primary/15` disc — two
 * stacked alphas, which is the unmigrated pattern the canon replaces with
 * explicit tone steps.
 *
 * `idle` and `scanning` have no `--tone-primary-*` ramp to draw on (the ramp
 * exists for the three functional roles only), so they take the container role
 * directly, which is the correct tonal step for a disc at this size.
 */
export const POSTURE_DISC: Record<RunPosture, string> = {
  idle: "bg-surface-container-high text-on-surface-variant",
  scanning: "bg-primary-container text-on-primary-container",
  complete: "bg-tone-success-1 text-success-on-surface",
  failed: "bg-tone-destructive-1 text-destructive-on-surface",
};

/**
 * Signal quality.
 *
 * DELIBERATELY THREE TIERS, AND DELIBERATELY NOT `RSRP_THRESHOLDS`. The rest of
 * the product rates the cell it is CAMPED ON using the four-tier
 * `RSRP_THRESHOLDS` in `types/modem-status.ts` (-80/-100/-110/-140). A scan
 * lists candidate cells the modem is not camped on, which is a different
 * judgement, so this surface keeps its own -85/-100 boundaries. Reviewed and
 * kept on purpose, 2026-08-11 — not an oversight, and not to be "unified" as a
 * side effect of unrelated work.
 *
 * `none` exists because the neighbour worker emits 0 for an unreported
 * measurement. It is `muted`, NOT `warning`: the incumbent gave "No data" the
 * warning role in the same table column that already used warning for "Fair",
 * so two unrelated states shared one tone in one slot.
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

/** The scanner's own boundaries. See the note on `SignalTier`. */
export const SIGNAL_GOOD_DBM = -85;
export const SIGNAL_FAIR_DBM = -100;

export function signalTier(strength: number | null | undefined): SignalTier {
  // The workers emit 0 rather than null for an unreported reading, and 0 dBm is
  // not a physically meaningful RSRP, so it is the sentinel rather than a value.
  if (strength === null || strength === undefined || strength === 0)
    return "none";
  if (strength >= SIGNAL_GOOD_DBM) return "good";
  if (strength >= SIGNAL_FAIR_DBM) return "fair";
  return "poor";
}

/**
 * Radio identity. `nr` and `lte` are IDENTITY variants — they say which radio a
 * row belongs to and never mean "healthy".
 *
 * The incumbent painted this chip `variant="default"`, i.e. solid `bg-primary`:
 * the brand's one acting colour, spent on a passive label, for both radios at
 * once. Identity was unreadable and the chip advertised an action it did not
 * have.
 */
export function networkIdentity(networkType: string): BadgeVariant {
  return networkType.toUpperCase().startsWith("NR") ? "nr" : "lte";
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

/** `m:ss`. Pure — no locale in it, so it is safe outside the i18n provider. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// Skeleton mirrors — ALWAYS LAST
// -----------------------------------------------------------------------------

/**
 * Loaded geometry, restated once so the skeletons mirror it by IMPORT rather
 * than by estimate.
 *
 * Sizes are the loaded element's LINE BOX, not its font size: a skeleton sized
 * to the glyph reflows the moment real text lands. Where a state can be two
 * heights, mirror the TALLER one — a shrinking skeleton pulls the panel below it
 * up into text the reader has already started.
 */
export const SKELETON_SHAPE = {
  TITLE: "h-6 w-40 rounded-inline",
  DESC: "h-5 w-56 rounded-inline",
  CHIP: "h-[1.375rem] w-24 rounded-pill",
  /** Mirrors `POSTURE.ROOT`'s min-height. */
  POSTURE: "h-[11rem] w-full rounded-tile",
  /** Mirrors `COST.ROOT` at one line of copy. */
  COST: "h-[3.25rem] w-full rounded-field",
  /** Mirrors `TOOLBAR.FILTER`. */
  FILTER: "h-[2.625rem] w-[18rem] max-w-full rounded-field",
  /** Mirrors `TABLE.ROW`'s resolved 40px height. */
  ROW: "h-10 w-full rounded-inline",
  /** Mirrors `PILL_ACTION`'s height. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;

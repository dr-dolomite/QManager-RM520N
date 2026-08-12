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
//
// -----------------------------------------------------------------------------
// TWO THINGS THIS SURFACE DELIBERATELY DOES NOT HAVE (2026-08-12)
// -----------------------------------------------------------------------------
// 1. NO POSTURE CHIP. The hero header carried a `Badge` restating the posture
//    the rail below it already shows with a disc, a tone, a glyph, a title and a
//    body. Two objects, one fact, ~200px apart, and the chip was the one with
//    the least room to explain itself. The RAIL is the posture carrier now, on
//    all four postures and both routes. That is why `POSTURE_GLYPH` below no
//    longer keys onto `BadgeVariant`: there is no badge left to tint.
//
// 2. NO NUMBERS WHILE A RUN IS IN FLIGHT. The sweep's elapsed clock is gone, and
//    nothing replaced it — no `m:ss`, no count, no percentage, no ETA. The modem
//    reports NOTHING between `AT+QSCAN` going out and the result landing (no
//    per-band progress, no partial rows, no remaining time), so any figure the
//    running state could show would be a number the page invented about a
//    process it cannot see. The "is it hung?" question is answered by the disc's
//    ambient spin and by copy that sets the expectation instead.
//
// Both were user decisions, not oversights. A later canon pass should not
// "restore" either one. See docs/reference/cell-scanner.md > The running state
// carries no numbers.
//
// -----------------------------------------------------------------------------
// AND A THIRD, ADDED 2026-08-12: THE COMPLETE RAIL IS TWO MARKS, NOT FIVE
// -----------------------------------------------------------------------------
// The completed posture used to stack disc -> count -> context line -> title ->
// body: "8", "across 3 providers on 7 bands", "Sweep finished", "8 cells in
// range." Three of those five say the same thing. The count IS the count, so the
// body restating it as a sentence was pure duplication, and the context line
// ("across 3 providers on 6 bands") re-derived from rows the summary panel two
// hundred pixels to the right already breaks down provider by provider and band
// by band.
//
// Both lines are GONE on the complete posture, and the two survivors are sized
// up to carry the rail on their own: a 64px disc over a 48px figure. `POSTURE`'s
// body copy is retained for idle, scanning and failed, where it is the only
// thing explaining what is happening.
//
// USER DECISION. A later canon pass should not restore either line, and should
// not "recover" the unit by putting a caption back under the figure — the
// summary panel beside it and the "Cells found" card below it both name the
// unit already.
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
 * ALSO THE RESULTS CARD'S EMPTY AND ERROR PANELS (`scan-states.tsx`). Those are
 * the same object at a different address: a disc, a title, a line of body copy,
 * centred in a tile inside a section. Giving them a second, near-identical
 * constant is exactly how the incumbent ended up with three hand-authored
 * centred stacks whose paddings disagreed by 8px. One shape, three call sites,
 * and `SKELETON_SHAPE.POSTURE` mirrors all of them at once.
 *
 * Counter-rule, learned on the frequency-locking surface: never put `mt-auto` on
 * the last child of this stack. It eats the free space and silently cancels the
 * centring the stack exists to provide.
 */
export const POSTURE = {
  /**
   * `min-h-[13rem]` is the COMPLETE stack measured: 48px of padding, a 64px
   * disc, a 48px figure, a 20px title and two 12px gaps. It also covers the
   * idle/scanning/failed stack (disc, title, up to three lines of body) and the
   * `scan-states.tsx` panels, which are the same object at a different address.
   *
   * `SKELETON_SHAPE.POSTURE` mirrors this number and the two must move
   * together. They are written as literals rather than composed from a shared
   * string because Tailwind's JIT scans source text — an interpolated
   * `min-h-[${X}]` produces no class at all.
   */
  ROOT: "flex min-h-[13rem] flex-col items-center justify-center gap-3 rounded-tile bg-surface-container p-6 text-center",
  /**
   * 64px, up from 52px. The rail lost its context and body lines on the
   * complete posture (see the file header), so the disc and the figure are the
   * only two marks left carrying it and both were sized for a five-element
   * stack. Glyph goes to 32px at every call site — `MaterialSymbol` sets
   * `fontSize` inline, so a utility on the parent cannot reach it.
   */
  DISC: "grid size-16 flex-none place-items-center rounded-pill",
  TITLE: "text-sm font-semibold",
  BODY: "max-w-[22rem] text-xs/relaxed text-on-surface-variant text-pretty",
  /**
   * THE RESULT COUNT, and only the result count. Size derives from the slot
   * rather than a ramp step — per the Numeric rule, a literal `text-[Npx]` is
   * correct by construction here.
   *
   * It was named CLOCK because it used to hold the sweep's elapsed timer as
   * well. The running state carries no numbers at all now (see the file
   * header), so the timer is gone and this slot has one occupant. The NAME is
   * kept because it is the geometry that matters and both scanning routes and
   * their skeletons key onto it; the ROLE is "the one large figure in the
   * posture rail".
   *
   * 48px, up from 28px, and the reason is the same one the disc grew for: the
   * count is now one of two marks in the rail rather than one of five, and it
   * has to read as the rail's subject. Three digits at 48px measure ~90px,
   * which clears the 272px rail on desktop and the full-width rail on mobile
   * with room either side.
   *
   * `tabular-nums` in the INTERFACE font, not `font-mono`: a count that moves
   * when a run completes is a figure the reader watches change, which is the
   * exact test the Machine-Voice Rule applies. Mono is for the identifiers in
   * the table below (EARFCN, PCI, Cell ID), which hold steady until something
   * reconfigures them.
   */
  CLOCK: "text-[48px] font-semibold leading-none tabular-nums tracking-tight",
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

/**
 * The cross-link to the sibling scanning route, in the hero header.
 *
 * The two routes had NO path between them: the only way from a sweep to a
 * neighbour read was the sidebar, on a surface whose whole argument is that
 * these are two answers to one question at very different prices. `SECTION_HEAD.META`
 * is where it sits, which is also where the retired posture chip used to.
 *
 * It is disabled — WITH ITS REASON — while a run is in flight, because the scan
 * singleton would refuse the second scan anyway (one `flock`, two routes). A
 * control that cannot currently work explains itself rather than sitting there
 * dead; see DESIGN.md > The State-Honesty Rule.
 */
export const HERO_LINK = {
  /** `aria-disabled`, never `disabled`: a disabled button is not focusable and
   *  cannot host the tooltip that carries the reason. */
  ROOT: "h-9 gap-2 rounded-pill px-4 text-xs font-semibold aria-disabled:opacity-60",
} as const;

// -----------------------------------------------------------------------------
// The run summary
// -----------------------------------------------------------------------------

/**
 * "What this sweep found" / "What this read returned" — the panel that turns a
 * result count into a shape before the reader reaches the table.
 *
 * ONE RADIUS STEP DOWN AT EVERY LEVEL, and one EXPLICIT tone step at every
 * level: `rounded-tile` on `surface-container` inside the `rounded-hero`
 * `surface` card, holding `rounded-field` tiles on `surface-container-high`.
 * Never an alpha wash to fake the step — that is the Explicit-Tone Rule, and the
 * unmigrated pattern this family already removed once from its posture disc.
 *
 * The GRID is a container query against `@container/section`, declared by
 * `RUN_HERO`. It has to survive one provider and it has to survive nine, so the
 * caller caps the tile count and the columns cap themselves at three.
 */
export const SUMMARY = {
  ROOT: "flex min-h-[13.5rem] flex-col gap-3 rounded-tile bg-surface-container p-5",
  TITLE: "text-sm font-semibold",
  GRID: "grid grid-cols-1 gap-2 @md/section:grid-cols-2 @3xl/section:grid-cols-3",
  /**
   * Background and ink are NOT here — they come from `summaryTileTone(index)`
   * below, one per tile. The tile stays a container-shape constant; the tone is
   * the one thing that legitimately varies per tile.
   */
  TILE: "flex min-w-0 flex-col gap-1.5 rounded-field px-4 py-3",
  /**
   * `opacity-85` on the tile's OWN ink rather than a fixed `text-on-surface-variant`
   * — the tile's tone now varies per index (see `summaryTileTone`), so a hardcoded
   * neutral would sit wrong on a solid `bg-primary` tile. Same idiom the SMS
   * summary strip uses for its tile labels.
   */
  LABEL: "truncate text-xs font-semibold opacity-85",
  /** The count. A changing figure, so interface font — see `TABLE.FIGURE`. */
  VALUE: "text-xl font-semibold leading-none tabular-nums",
  /**
   * The facts under the count, as separate inline items with a gap rather than
   * one string glued with `·` (the No-Dot-Separator Rule).
   */
  DETAILS: "flex flex-wrap items-baseline gap-x-2.5 gap-y-1",
  /**
   * Band lists, EARFCNs, channels — identifiers, so machine voice.
   *
   * `text-xs`, not the mock's 11px: the mock is dark-only and sizes by eye, and
   * a new type step invented for one caption is exactly what the ramp exists to
   * prevent. Caption is the smallest documented step and it is the right one.
   */
  DETAIL_IDENT: "font-mono text-xs tabular-nums opacity-85",
  /** Readings and counts — interface font with tabular figures. */
  DETAIL_FIGURE: "text-xs tabular-nums opacity-85",
} as const;

/**
 * Tile tone triad, rotating by index — the SMS summary strip's fill/container/
 * uplink pattern (`components/cellular/sms/summary-tiles.tsx`), applied here
 * because this panel had the opposite problem: every tile sat on the identical
 * `surface-container-high`, so three (or nine) peer facts read as one grey
 * block with numbers in it rather than as distinct findings.
 *
 * Tile 0 is always the FILL pair — the group the reader's eye lands on first.
 * Every tile after it alternates the two CONTAINER pairs, so the panel never
 * runs out of distinct tones however many groups a sweep returns (up to nine,
 * per the file header). `lte-container` is deliberately never used here: it is
 * the 4G identity hue and none of these tiles mean "LTE" (DESIGN.md > The
 * Identity-Chip Rule) — `uplink-container` is the system's spare identity hue
 * for exactly this "counts and supporting readouts" role.
 */
const SUMMARY_TILE_TONE = [
  "bg-primary text-primary-foreground",
  "bg-primary-container text-on-primary-container",
  "bg-uplink-container text-on-uplink-container",
] as const;

export function summaryTileTone(index: number): string {
  if (index === 0) return SUMMARY_TILE_TONE[0];
  return SUMMARY_TILE_TONE[1 + ((index - 1) % 2)];
}

/**
 * The verdict strip under the tiles: one line explaining what the numbers
 * above it actually mean, shown ONLY when it has something true to say.
 *
 * A container fill and `rounded-field`, no border — it is a STATED FACT, not an
 * alarm the reader must clear, which is the same reasoning `COST` is built on.
 * Its glyph must differ from every other glyph that can appear in this slot, so
 * the tier variants take the bar-count marks (which also survive greyscale).
 */
export const VERDICT = {
  ROOT: "flex items-start gap-2.5 rounded-field px-4 py-3",
  TEXT: "text-xs/relaxed text-pretty",
} as const;

/** The verdict's tone. Keyed so a tone without a container pair fails the build. */
export type VerdictTone = "muted" | "success" | "warning" | "destructive";

export const VERDICT_TONE: Record<VerdictTone, string> = {
  /**
   * `surface`, NOT `surface-container-high`. The tiles above this strip are
   * `surface-container-high` on the panel's `surface-container`, so a muted
   * verdict painted the same step read as a fifth, wider tile rather than as a
   * statement about the four above it — and `muted` is the tone the neighbour
   * route's only verdict uses, so that was its normal appearance rather than an
   * edge case. Stepping to the card's own `surface` is a LIFT off the panel in
   * both themes, which is the same move `TABLE.ROW_HOVER` makes for the same
   * reason.
   */
  muted: "bg-surface text-on-surface-variant",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
};

// -----------------------------------------------------------------------------
// Machine voice
// -----------------------------------------------------------------------------
// The Machine-Voice Rule applied VALUE BY VALUE, as two classes rather than a
// habit. The test is whether a figure changes while the reader watches without
// them acting on it: a channel number and a band's fixed edges hold still until
// something reconfigures them (mono), while anything derived from what was just
// typed or last measured is a reading (interface font, tabular figures).
//
// These are module-level because THREE surfaces on this prefix need them and
// only one of the three is a table. `TABLE.IDENT` / `TABLE.FIGURE` now alias
// these rather than restating the strings — the calculator had drifted to five
// different mono treatments precisely because the contract's copy lived inside
// a constant named for a component it does not use.

/** Identifiers: band, EARFCN, PCI, Cell ID, TAC, channel and frequency ranges. */
export const IDENT = "font-mono text-[13px] tabular-nums";

/** Readings: RSRP, RSRQ, SINR, RSSI, a computed frequency, any count. */
export const FIGURE = "tabular-nums";

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
  /**
   * Zebra striping, applied to every SECOND row. A real sweep returns dozens of
   * rows across nine mono columns, and a hairline alone stops carrying the eye
   * across them somewhere around row six.
   *
   * AN EXPLICIT TONE STEP, not an alpha wash: `surface-container-high` on the
   * shell's `surface-container`. It is applied in JS from the row index rather
   * than with `odd:`, because `ROW_HOVER` below has to WIN over it and Tailwind's
   * variant ordering between two pseudo-class variants is not something a
   * component should be betting on. An unvariant base class always loses to a
   * `hover:` one, whatever order they land in.
   */
  ROW_STRIPE: "bg-surface-container-high",
  /**
   * Hover and keyboard focus, one step to the card's own `surface` — a LIFT off
   * the table block, which reads identically over a striped row and an unstriped
   * one, in both themes. `focus-within` is not decoration: every row carries a
   * menu trigger, and a keyboard reader needs to see which row they are in.
   */
  ROW_HOVER: "hover:bg-surface focus-within:bg-surface",
  /** Identifiers: band, EARFCN, PCI, Cell ID, TAC. See the module-level `IDENT`. */
  IDENT,
  /** Measurements: RSRP, RSRQ, SINR, RSSI. See the module-level `FIGURE`. */
  FIGURE,
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

/**
 * The strip under the table: what a row can DO on the left, what the rows ADD UP
 * TO on the right.
 *
 * It exists because the table answers "which cells are there" and answers
 * nothing else — the reader had no way to learn that locking a row copies its
 * band, EARFCN and PCI into Tower Locking except by trying it, and no way to see
 * the distribution without counting chips by hand.
 *
 * `TALLY` is a set of separate inline items with a gap, NOT one string. Each
 * item is its own i18next plural (the No-Dot-Separator Rule bans `·` glue, and
 * one sentence cannot carry four independent counts through a plural rule
 * anyway). Interface-font `tabular-nums`, because these are changing figures.
 */
export const TABLE_NOTE = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-field bg-surface-container px-4 py-3",
  TEXT: "min-w-[16rem] flex-1 text-xs/relaxed text-on-surface-variant text-pretty",
  TALLY:
    "ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-on-surface-variant",
} as const;

/**
 * Pagination, under the table.
 *
 * ADDED after the contract's first draft: `TOOLBAR` owns the row ABOVE the
 * table and the pager is a second row below it, so hanging the page controls off
 * `TOOLBAR.ACTIONS` would have put them in the wrong row or forced a second,
 * silently different flex string at the call site. The count moved down here
 * with them — it describes what the pager is paging through, and reading
 * "12 of 40 cells" directly above Previous/Next is what makes the pager's
 * position in the set legible at all.
 */
export const PAGER = {
  ROOT: "flex flex-wrap items-center gap-3",
  ACTIONS: "ms-auto flex items-center gap-2",
  /** `chevron_left` is not in the subset. Rotating the right chevron is the house precedent. */
  BACK_GLYPH: "rotate-180",
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
// Keyed onto `MaterialSymbolName` and `BadgeVariant` rather than class strings,
// so a new posture or tier without a matching role fails the build instead of
// shipping untinted. Every posture carries a DISTINCT glyph: `success-container`
// and `warning-container` measure 1.03:1 apart — the same surface to the eye,
// and identical under deuteranopia — so the glyph is the only thing separating a
// healthy state from a degraded one.

export type RunPosture = "idle" | "scanning" | "complete" | "failed";

/**
 * The posture disc's MARK. Was `RUN_BADGE`, and carried a `variant` alongside
 * these two fields.
 *
 * THE `BadgeVariant` KEYING WENT AWAY WITH THE CHIP IT TINTED. The hero header
 * used to restate the posture as a `Badge` beside the title, duplicating the
 * rail's disc/tone/glyph/title/body two hundred pixels away. The chip is gone on
 * all four postures and both routes, so the only consumer of a badge role here
 * went with it — and an exported field nothing reads is exactly the kind of dead
 * contract this file exists to prevent.
 *
 * The glyph and its fill stay, because the DISC still needs both, and the disc's
 * container tone is `POSTURE_DISC` below.
 */
export const POSTURE_GLYPH: Record<
  RunPosture,
  { glyph: MaterialSymbolName; filled: boolean }
> = {
  idle: { glyph: "radar", filled: false },
  scanning: { glyph: "progress_activity", filled: false },
  complete: { glyph: "check_circle", filled: true },
  failed: { glyph: "error", filled: true },
};

/**
 * The worker's transport status -> the surface's posture.
 *
 * ADDED because both scanning routes need it and neither should own it. The
 * parameter is a structural union rather than an import of `ScanStatus` from
 * `types/cell-scanner.ts`, so this module keeps its no-imports-from-app-code
 * property (it already imports two types and nothing else) while the two unions
 * still have to agree — a transport state added there without a posture here
 * fails the build at the call site.
 *
 * The two vocabularies are deliberately different words. "running" is what the
 * modem is doing; "scanning" is what the page is showing. Collapsing them would
 * make a rename of one a silent rename of the other.
 */
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
// `formatElapsed` lived here and is DELIBERATELY GONE. It had exactly one
// consumer, the sweep hero's `m:ss` clock, and the running state carries no
// numbers now (see the file header). A pure formatter with no call sites is a
// standing invitation to put the clock back.
//
// `useCellScanner` still returns `elapsedSeconds` — the transport was left
// alone on purpose, so this is a surface decision that can be revisited without
// a hook change. The routes simply do not destructure it.

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
  /** Mirrors `POSTURE.ROOT`'s min-height. Move both or neither. */
  POSTURE: "h-[13rem] w-full rounded-tile",
  /** Mirrors `COST.ROOT` at one line of copy. */
  COST: "h-[3.25rem] w-full rounded-field",
  /**
   * Mirrors `SUMMARY.ROOT`'s min-height.
   *
   * It has a REAL call site: the summary is drawn from rows a run is currently
   * replacing, so while a sweep is in flight the panel is a skeleton rather than
   * last run's numbers wearing this run's posture. Mirroring the taller state is
   * what stops the cost statement below it jumping when the result lands.
   */
  SUMMARY: "h-[13.5rem] w-full rounded-tile",
  /** Mirrors `HERO_LINK.ROOT`'s height. */
  LINK: "h-9 w-40 rounded-pill",
  /** Mirrors `TOOLBAR.FILTER`. */
  FILTER: "h-[2.625rem] w-[18rem] max-w-full rounded-field",
  /** Mirrors `TABLE.ROW`'s resolved 40px height. */
  ROW: "h-10 w-full rounded-inline",
  /** Mirrors `PILL_ACTION`'s height. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// The frequency calculator
// -----------------------------------------------------------------------------
// THE ANCHOR GEOMETRY WITHOUT THE RUN VOCABULARY.
//
// This surface used to argue, in its own file header, that it should have no
// 40px radius anywhere: "a hero radius with no hero behind it is a promise of
// importance the page cannot keep." The premise was right and the conclusion
// was wrong. What a hero promises is not that something RAN — it is that one
// object on the page is the thing you came for and everything else reports on
// it. That is exactly true here: the reader came to turn a channel number into
// a frequency, and the bands and the history are both readings of that answer.
// Two peer cards said the converter and its own history were equally important,
// which is the one thing this page is certain they are not.
//
// So the calculator takes `RUN_HERO`'s geometry and none of its semantics. It
// has no posture (nothing runs), no cost statement (nothing is spent), no
// elapsed clock and no spinner. The left rail holds a resolved frequency where
// the scanner holds a posture; the right column holds the form. Reusing the
// value rather than restating it is what keeps the two anchors one object when
// the geometry is retuned — and `HERO_SPLIT` is shared outright.

export const CALC_HERO = RUN_HERO;

/**
 * The readout rail — the answer, at the size the answer deserves.
 *
 * `FIGURE` is 44px rather than `POSTURE.CLOCK`'s 48: a frequency runs to seven
 * characters ("3489.42") where an elapsed clock runs to four ("1:23"), and at
 * 48px the longest value collides with the 17rem rail on the narrow view the
 * modem serves to a phone. Slot-derived, per the Numeric rule.
 *
 * The unit is a SEPARATE node at label size. Baking "MHz" into the 44px figure
 * would make the unit shout as loudly as the number and cost three characters
 * of the width the number actually needs.
 */
export const READOUT = {
  FIGURE: "text-[44px] font-semibold leading-none tabular-nums tracking-tight",
  UNIT: "text-sm font-semibold text-on-surface-variant",
  /** The channel that produced the figure. An identifier, so machine voice. */
  CHANNEL: `${IDENT} text-on-surface-variant`,
  /** The band the figure belongs to, when exactly one band claims it. */
  BAND: "font-mono text-sm font-semibold tabular-nums",
  /** Pre-calculation copy, and the "several bands" line. */
  CAPTION: "max-w-[16rem] text-xs/relaxed text-on-surface-variant text-pretty",
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

/**
 * The form column of the anchor.
 *
 * `NOTE` and the scanner's `COST` are the same shape deliberately: both are the
 * quiet sentence under the controls that says what the thing you are about to
 * press actually does. They are not aliased because the calculator's note is a
 * spec citation that changes with the mode, not a fixed cost.
 */
export const FORM = {
  /**
   * `h-full` so the column fills the rail's 13rem beside it, which is what lets
   * `NOTE` sit on the bottom edge instead of leaving a void under the field.
   */
  ROOT: "flex h-full flex-col gap-4",
  TABS: "grid h-[2.625rem] w-full grid-cols-3 rounded-pill bg-surface-container p-1",
  TAB: "rounded-pill",
  FIELD: "flex flex-col gap-2",
  ROW: "flex flex-wrap gap-2",
  /**
   * The VALUE is an identifier and takes machine voice; the PLACEHOLDER is
   * human-authored instruction and does not. `placeholder:font-sans` is the
   * whole of that distinction — without it the field asks "Enter channel
   * number" in the modem's voice, which the Machine-Voice Rule reserves for
   * things the device actually said.
   */
  INPUT: `h-[2.625rem] min-w-0 flex-1 rounded-field ${IDENT} placeholder:font-sans placeholder:text-sm`,
  /** `mt-auto` — see `ROOT`. */
  NOTE: "mt-auto flex items-start gap-2.5 rounded-field bg-surface-container px-4 py-3",
  NOTE_TEXT: "text-xs/relaxed text-on-surface-variant text-pretty",
  ERROR:
    "flex items-start gap-2.5 rounded-field bg-destructive-container px-4 py-3 text-sm/relaxed text-on-destructive-container text-pretty",
} as const;

/**
 * A matching band, as a tile in a grid.
 *
 * The incumbent stacked these full-width, one per row, so four matching NR
 * bands pushed the method note two screens down and the reader compared them by
 * scrolling. They are peers answering the same question, so they belong side by
 * side — and the grid is the same 1 / 2 / 3 progression `SUMMARY.GRID` uses,
 * against `/section` because `RESULTS_CARD` declares it.
 *
 * `LIST` keeps the label column narrower than the scanner's 9.5rem: these keys
 * are short ("Duplex", "DL frequency") and the values carry ranges that wrap
 * badly, so the value column gets the difference.
 */
export const BAND_TILE = {
  /**
   * Declares its OWN container. `LIST` below keys off the tile rather than off
   * the card, because the tile's width is a function of how many bands matched
   * — three tiles share the row at ~23rem each, one tile takes the whole 70rem.
   * A query against `/section` cannot tell those apart: the card is the same
   * width either way, so the lone tile would inherit a layout tuned for a third
   * of the row and leave the other two thirds empty.
   */
  ROOT: "@container/tile flex min-w-0 flex-col gap-3 rounded-tile bg-surface-container p-5",
  HEAD: "flex flex-wrap items-baseline gap-x-2 gap-y-1",
  BAND: "font-mono text-sm font-semibold tabular-nums",
  NAME: "min-w-0 text-sm text-on-surface-variant",
  /**
   * `auto-fit`, not a fixed 1 / 2 / 3 progression, because the COUNT is data.
   *
   * LTE EARFCN ranges are disjoint, so an LTE answer is always exactly one band
   * — under a fixed three-column grid that tile sits in the first third with
   * two empty columns beside it, which reads as two tiles that failed to load.
   * NR ranges overlap and routinely return two or three. `auto-fit` collapses
   * the empty tracks, so one band fills the row and three share it, with no
   * count-aware branch in the component.
   */
  GRID: "grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-3",
  /**
   * One key/value column at phone width, one PAIR of them once the tile is wide
   * enough to carry both. The four-column step is what a lone matching band
   * gets: seven rows down the left half of a 70rem tile is a column of facts
   * with a column of nothing beside it.
   */
  LIST: "grid grid-cols-1 gap-x-4 gap-y-1 text-[13px]/5 @xs/tile:grid-cols-[7.5rem_minmax(0,1fr)] @xs/tile:gap-y-2 @3xl/tile:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_minmax(0,1fr)] @3xl/tile:gap-x-8",
  KEY: "text-on-surface-variant",
  VALUE: "min-w-0 font-medium",
} as const;

/**
 * A history row.
 *
 * `rounded-tile` on `surface-container`, matching a band tile — the two lists
 * are the same kind of object (a past answer, a possible answer) and reading
 * one should teach the other.
 */
export const HISTORY_ROW = {
  ROOT: "flex items-start justify-between gap-3 rounded-tile bg-surface-container p-4",
  MAIN: "flex min-w-0 flex-col gap-1",
  HEAD: "flex flex-wrap items-center gap-2",
  CHANNEL: `${IDENT} font-semibold`,
  FIGURE: `${FIGURE} text-sm font-medium text-on-surface-variant`,
  BANDS: "text-[13px]/5 text-pretty",
  BANDS_KEY: "text-on-surface-variant",
  BANDS_VALUE: IDENT,
  TIME: "text-xs tabular-nums text-on-surface-variant",
  DELETE: "size-9 flex-none rounded-pill text-on-surface-variant",
} as const;

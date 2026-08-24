// =============================================================================
// Antenna Alignment — geometry and tone contract
// =============================================================================
// The single source of truth for this route family's geometry, imported by
// every consumer INCLUDING the skeletons. A skeleton that restates a number has
// left the contract (DESIGN.md > The Skeleton-Mirror Rule).
//
// This file exists because the surface shipped without one while every sibling
// /cellular/ family had one, and the drift was measurable: four byte-identical
// card-shell strings duplicated across three files, three different control
// heights (40 / 42 / 44px) in one card, five glyph sizes, two spellings of the
// same duration token, and two arbitrary letter-spacings for one label role.
// None of that was visible in any single file, which is exactly why it survived.
//
// House convention: geometry is RESTATED across sibling routes, never imported
// from one. A surface takes no dependency on another route's module graph.
// Genuinely family-wide primitives get promoted to `components/cellular/`
// instead — which is what `tile-shape.ts` and `signal-quality-display.ts` are.
//
// LOAD-BEARING, do not "simplify":
//   * Never interpolate a Tailwind class. `@${step}/main:flex` and
//     `min-h-[${x}]` compile to no rule at all and fail silently.
//   * Container queries only (`@container/main`), never viewport breakpoints.
//     Viewport widths are for the page gutter and the shell alone.
//   * Every pinned HEIGHT mirrors its ROOT's resolved height AND radius. A
//     `min-h-` is not a mirror — measured drift on this page's twin was 26px.
// =============================================================================

import type { MaterialSymbolName } from "@/components/ui/material-symbol";

/**
 * The one small-caps key role on this surface, declared once.
 *
 * It forked before: the same label wore `tracking-[0.06em]` in one file and
 * `tracking-[0.09em]` in another, which is invisible in review and legible on
 * screen. Declared above its consumers so `as const` still infers literals.
 */
export const KEY_LABEL =
  "shrink-0 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant";

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";
export const PAGE_DESCRIPTION =
  "text-on-surface-variant text-sm leading-relaxed text-pretty";
export const PAGE_HEADER_BLOCK = "flex max-w-[41rem] flex-col gap-1.5";

/**
 * The two-column split.
 *
 * The console column must STRETCH — the grid's default — and this is the whole
 * pinned console, so do not "tidy" an `items-start` onto it.
 *
 * A sticky element travels inside its own containing block, which is its
 * parent. Under `items-start` the console column shrinks to the console's own
 * height and the sticky child never moves at all. `stretch` resolves the
 * column to the taller work column's height and `CONSOLE.SHELL`'s `h-full`
 * then fills that exactly, per the equal-height hard rule — so Live Aim and
 * Positions match, `top-4` still pins the card's top edge, and there is no
 * separate travel distance left for the console to ride.
 */
export const CONSOLE_SPLIT = "grid grid-cols-1 gap-5 @4xl/main:grid-cols-12";
/**
 * `flex flex-col`, not a bare grid cell: the sticky wrapper inside needs a
 * flex parent to stretch into, which is what lets the console CARD match
 * `Positions`' height exactly (the hard equal-height rule) rather than
 * riding loose inside a taller column.
 */
export const CONSOLE_COLUMN = "flex flex-col @4xl/main:col-span-5";
export const WORK_COLUMN = "flex flex-col gap-5 @4xl/main:col-span-7";

/**
 * Receive Chains sits BELOW the split, spanning the full width — it is not a
 * third item in the work column.
 *
 * Measured: with it in the work column, that column ran 929px against the
 * console's 403px, so the left half of a desktop viewport was ~525px of empty
 * canvas beside a dense right half. That gap is the sticky travel, so it grows
 * with content rather than being a fixture of the empty state, and it read as a
 * missing card rather than as intentional space.
 *
 * Moving it out fixes two things at once. The columns come within ~20px of each
 * other, and the strip gets the full width, so it can run 4-up and finally read
 * as the diagnostic footnote it is documented to be — in the work column it was
 * the TALLEST card on the page while being described as a footnote.
 *
 * The mobile order is unchanged by this: console, positions, chains.
 */
export const CHAINS_ROW = "flex flex-col";

// -----------------------------------------------------------------------------
// The console — the pinned aim instrument
// -----------------------------------------------------------------------------

/**
 * The two work-column cards. `rounded-card` (36px), because this surface's one
 * `rounded-hero` (40px) belongs to the console — a grid of peers takes `card`
 * and the card that anchors the surface takes `hero`.
 *
 * Declared here rather than in either card, and imported by the skeleton too:
 * this exact string existed as four byte-identical copies across three files
 * before, which is the drift this module was created to end.
 */
export const CARD_SHELL =
  "h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]";
export const CARD_TITLE = "min-w-0 truncate text-lg font-semibold";
export const CARD_DESCRIPTION = "min-w-0 text-sm leading-relaxed text-pretty";
export const CARD_HEADER = "gap-1 px-0";
export const CARD_CONTENT = "flex flex-col gap-4 px-0";

export const CONSOLE = {
  /**
   * `flex-1`, so the wrapper fills `CONSOLE_COLUMN`'s stretched height rather
   * than sizing to the console's own content. Paired with `SHELL`'s `h-full`
   * this is what makes Live Aim match Positions exactly — the equal-height
   * hard rule takes priority over the sticky card riding loose in extra
   * column slack, so `top-4` still pins the card's top edge, but there is no
   * longer any travel distance left to ride.
   */
  STICKY: "flex-1 @4xl/main:sticky @4xl/main:top-4",
  SHELL:
    "h-full gap-5 rounded-hero border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]",
  TITLE: "min-w-0 truncate text-lg font-semibold",
  DESCRIPTION: "min-w-0 text-sm leading-relaxed text-pretty",

  /** The composite numeral. Sized to its slot, per The Numeric rule. */
  SCORE: "text-[52px] font-semibold leading-none tabular-nums",
  SCORE_BOX: "h-[52px]",

  /** The composite meter. 8px so it out-weighs the 4px leg lanes. */
  METER_LANE: "relative flex h-2 items-center",
  /**
   * The session peak. Positioned with `left`, deliberately never animated: a
   * peak is a discrete event, and DESIGN.md's Transform-Only Rule keeps layout
   * properties out of transitions. Snapping is the honest gesture.
   */
  PEAK_TICK: "absolute top-[-2px] h-3 w-0.5 rounded-pill bg-on-surface-variant",

  /** One weighted leg. A 40px metric-row pill, per DESIGN.md > Metric rows. */
  LEG_ROW:
    "flex items-center gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  LEG_KEY: KEY_LABEL,
  /** The 56px inline bar lane. A 4px bar in a 20px line box adds no height. */
  LEG_LANE: "w-14 shrink-0",
  LEG_VALUE: "w-[4.75rem] shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
  /**
   * The scoring weights. Kept, because decomposability is what earns a 52px
   * composite numeral: the score never appears alone, and printing what it is
   * made of is the difference between an instrument and an oracle. Demoted to a
   * label, because at value weight they read as a second reading.
   */
  LEG_WEIGHT: "ml-1.5 text-xs font-medium tabular-nums text-on-surface-variant",

  /** The small-caps label above the composite numeral. */
  EYEBROW: KEY_LABEL,
  /** Peak / updated-at / primary-chain. Free to wrap; never truncated. */
  CAPTION: "text-xs text-on-surface-variant",
} as const;

// `CONSOLE.LEG_KEY` deliberately carries NO fixed width, even though a column
// rule would align "RSRP" under "SINR". The weight annotation renders inside
// the key element, so "RSRP 60%" would overflow any width narrow enough to be
// worth setting. The lane and value align on the right instead.

/**
 * The condensed readout that pins once the full console scrolls away.
 *
 * Mobile only: on `@4xl/main` and wider the console itself is sticky and this
 * never mounts. It is a SEPARATE element rather than a collapsing console on
 * purpose — a collapse animates height, which is off DESIGN.md's transform-and-
 * opacity scale, while a second element crossfades on pure opacity + translate.
 *
 * The fill is a solid container step, never an alpha wash or a backdrop blur:
 * an alpha over a scrolling page collapses in dark mode, and the Tonal-
 * Elevation Rule already owns "this floats above that".
 *
 * The wrapper is `h-0`, which is the whole trick: a zero-height sticky element
 * placed first inside the page column pins at the top for the page's entire
 * scroll range and contributes NO layout, so the resting page is not 64px
 * taller for a bar nobody has summoned yet. The bar overflows downward out of
 * it and crossfades on a sentinel.
 *
 * It stays inset and pill-shaped rather than spanning full-bleed: DESIGN.md
 * gives pill radius to "chips, buttons, nav items, metric rows, meters", and a
 * pinned readout is a meter. A full-bleed bar would be the one square-cornered
 * element on the surface.
 */
export const CONDENSED = {
  ROOT: "sticky top-0 z-20 h-0 @4xl/main:hidden",
  /**
   * An opaque shade behind the pill, spanning the page gutter and the gap above
   * it. Without it the bar floats with a transparent 8px band over its head and
   * the page scrolls through that band — measured, a primary button slid across
   * the top of the viewport above the pinned readout, which reads as a z-index
   * bug rather than as a pinned element. The shade carries the crossfade too,
   * so ground and bar arrive as one object.
   */
  SHADE: "-mx-2 bg-background px-2 pt-2 pb-2 transition-opacity duration-(--duration-standard) ease-standard",
  /**
   * `surface-container-high`, one step ABOVE the slot rows, and it keeps the
   * console's key label.
   *
   * Both are here for one reason: at `bg-surface-container` this pill was
   * geometrically identical to a position row — same `h-16`, same
   * `rounded-pill`, same fill, same numeral-plus-meter anatomy — and it pins
   * directly above three of them. The behaviour was right and the read was
   * wrong: a floating instrument looked like a slot that had come loose. The
   * tonal step says "above", and the label says which instrument.
   */
  BAR: "flex h-16 items-center gap-3 rounded-pill bg-surface-container-high px-5 shadow-[var(--shadow-whisper)]",
  KEY: KEY_LABEL,
  HIDDEN: "pointer-events-none opacity-0",
  SHOWN: "opacity-100",
  SCORE: "shrink-0 text-[28px] font-semibold leading-none tabular-nums",
  LANE: "min-w-0 flex-1",
} as const;

// -----------------------------------------------------------------------------
// Positions — the recorder
// -----------------------------------------------------------------------------

/**
 * Three comparison ROWS, at every width — not a grid of tiles.
 *
 * The outgoing card stacked three 290px tiles down the phone, 923px for a card
 * that displays nothing until used: 39% of the page, and 1.1 phone screens of
 * empty affordance. Rows also make the comparison readable by BAR LENGTH on one
 * shared 0-100 scale, so "which position won" is answered by shape rather than
 * by reading three numerals against each other.
 */
export const SLOT = {
  STACK: "flex flex-col gap-3",
  ROOT: "flex h-16 items-center gap-3 rounded-pill px-4 transition-colors duration-(--duration-standard) ease-standard",
  HEIGHT: "h-16",
  NEUTRAL: "bg-surface-container text-on-surface",
  /** The winning position. Highlight-by-Container, never a ring around a block. */
  BEST: "bg-primary-container text-on-primary-container",
  /**
   * Deliberately NOT for the `Input` primitive — hand it to a raw `<input>`.
   *
   * `Input`'s base string carries `dark:bg-input/30` and `md:text-sm`, and
   * `cn()` cannot let an unprefixed class displace a variant-prefixed one. So
   * the fill silently reverts in dark mode, and the size reverts at a **768px
   * viewport** — a viewport breakpoint leaking into a container-query surface,
   * which is the one thing this file's header forbids. The focus ring is folded
   * in here so the next consumer cannot forget it.
   */
  /**
   * A SHELL around the input, not the input itself — the page's only text field
   * has to look like one.
   *
   * At `border-0` on a single tonal step it read as a static chip in a row full
   * of static chips, so the one editable thing on the surface advertised
   * nothing. DESIGN.md keeps inputs borderless at rest, so the affordance is a
   * glyph rather than a stroke: the fill and radius stay canon and an `edit`
   * mark says the value is yours to change. The shell owns fill, radius, height
   * and focus ring; the `<input>` inside is transparent and unstyled.
   */
  LABEL_SHELL:
    "flex h-11 w-[5.5rem] shrink-0 items-center gap-1.5 rounded-field bg-surface-container-high px-3 focus-within:ring-[3px] focus-within:ring-ring/50",
  LABEL_FIELD:
    "min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold focus-visible:outline-none",
  LABEL_STATIC: "w-[5.5rem] shrink-0 truncate text-[13px] font-semibold",
  /**
   * Ramp ink applies on a NEUTRAL row only. On the winning row the score
   * inherits `on-primary-container` instead: `--quality-N` is computed for
   * 4.5:1 against a card ground, not against `primary-container`, and in dark
   * mode a bright ramp ink on a deep-blue container is the weakest pair on the
   * surface. Quality is still carried there by bar length and the `sr-only`
   * verdict, which is the non-chromatic channel the rule actually requires.
   */
  SCORE: "w-[3.25rem] shrink-0 text-right text-[28px] font-semibold leading-none tabular-nums",
  LANE: "min-w-0 flex-1",
  CAPTION: "text-xs",
  /** 44px, the coarse-pointer floor. Every slot-level action uses this. */
  ICON_TARGET: "size-11 shrink-0 rounded-pill",
  /** Sample progress is dots, never a fill — a bar would make a count look measured. */
  DOT: "size-2 rounded-pill transition-colors duration-(--duration-standard) ease-standard",
} as const;

// -----------------------------------------------------------------------------
// Receive chains — the diagnostic footnote
// -----------------------------------------------------------------------------

/**
 * 2-up on a phone, 4-up on a wide surface. The outgoing strip ran one column at
 * phone width, 743px for the card that answers "am I aiming with all the chains
 * I think I have" — a question asked FIRST, at a scroll position reached last.
 */
export const PORT = {
  /**
   * 4-up from `@3xl`, which is only safe because this card spans the FULL page
   * width (see `CHAINS_ROW`) rather than living in the 7-of-12 work column.
   *
   * The history is the rule: inside the work column the step had to wait until
   * `@6xl`. At `@4xl` there, the column was ~580px, a 4-up block ~123px, and
   * `px-4` left ~91px inside — while one metric needs ~27px of key plus ~58px
   * of value plus gaps. The bar lane collapsed to nothing and the bar vanished,
   * which is DESIGN.md's named bug: ramp ink on a numeral with no bar beside
   * it. **Cost a grid step against the narrowest cell it produces in the column
   * it actually lives in, not against the page width.** Full-width at `@3xl`
   * (768px) gives a ~170px block, comfortably clear.
   */
  GRID: "grid grid-cols-2 gap-2.5 @2xl/main:gap-3.5 @3xl/main:grid-cols-4",
  ROOT: "flex h-40 flex-col gap-2 rounded-tile bg-surface-container px-3.5 py-3.5 @2xl/main:px-4",
  HEIGHT: "h-40",
  NAME: "min-w-0 truncate text-sm font-semibold",
  RX: "inline-flex shrink-0 items-center rounded-pill bg-surface-container-high px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant",

  /**
   * A metric is a baseline row of key + value with the bar on its own full
   * width beneath — the same anatomy `radio/active-bands-card.tsx` ships, which
   * is the reference implementation for this exact problem.
   *
   * The inline key-bar-value row it replaces is width-fragile by construction:
   * the lane is the only flexible track, so it is always the thing that
   * collapses first. Stacked, the bar is `w-full` at every width and all four
   * ports' bars start and end at the same x, which is what makes their LENGTHS
   * comparable — and length is the channel carrying the adjacent-ramp-stop
   * distinction that colour deliberately does not.
   */
  METRIC: "flex flex-col gap-1",
  METRIC_HEAD: "flex items-baseline justify-between gap-2",
  KEY: KEY_LABEL,
  /** Pinned so a bar, a caption and a "not reported" line share one band. */
  LANE: "flex h-1 items-center",
  VALUE: "shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Controls — one height each, named once
// -----------------------------------------------------------------------------

/** 42px. The house pill, byte-identical across every /cellular/ route. */
export const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";
export const PILL_ACTION_PLAIN = "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";
/** 44px icon-only target. The coarse-pointer floor wins over the 42px pill. */
export const ICON_TARGET = "size-11 shrink-0 rounded-pill";
export const SEGMENTED_ITEM =
  "h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium";

// -----------------------------------------------------------------------------
// Glyph sizes — three, not five
// -----------------------------------------------------------------------------

export const GLYPH = {
  /** Inside a Badge or Tag. */
  CHIP: 12,
  /** Inline beside a label, and inside an icon-only control. */
  INLINE: 16,
  /** On a pill action or a segmented item. */
  ACTION: 18,
} as const;

// -----------------------------------------------------------------------------
// Voices
// -----------------------------------------------------------------------------

/** A live measurement: the interface reporting a number. Never `font-mono`. */
export const FIGURE = "tabular-nums";
/** Machine truth that holds steady until something reconfigures it. */
export const IDENT = "font-mono text-[13px] tabular-nums";

// -----------------------------------------------------------------------------
// Tone maps — keyed onto exported types, never onto class strings
// -----------------------------------------------------------------------------

/**
 * Keying onto `MaterialSymbolName` rather than `string` is what makes a glyph
 * that is missing from the font subset a BUILD failure instead of an empty box
 * on a device nobody is looking at.
 */
export const SLOT_GLYPH = {
  directional: "explore",
  omni: "location_on",
} as const satisfies Record<"directional" | "omni", MaterialSymbolName>;

/**
 * `radar` rather than a record dot: it is already in the font subset, and a
 * sweep glyph is native to this surface in a way a transport control is not.
 * Adding a glyph means editing the shared subset manifest and re-running
 * `bun run icons:subset`, so a name outside this list is a build failure, which
 * is exactly what `satisfies Record<_, MaterialSymbolName>` is here to cause.
 */
export const RECORD_GLYPH = {
  idle: "radar",
  recording: "progress_activity",
  recorded: "check_circle",
  best: "trophy",
  clear: "delete",
  cancel: "close",
} as const satisfies Record<string, MaterialSymbolName>;

// -----------------------------------------------------------------------------
// Skeleton — mirrors sized to the loaded element's LINE BOX, not its font size
// -----------------------------------------------------------------------------

export const SKELETON_SHAPE = {
  SCORE: "h-[52px] w-28 rounded-inline",
  CHIP: "h-[1.625rem] w-24 rounded-pill",
  METER: "h-2 w-full rounded-pill",
  LEG_ROW: "h-10 w-full rounded-pill",
  SLOT_ROW: "h-16 w-full rounded-pill",
  PORT_BLOCK: "h-40 w-full rounded-tile",
  TITLE: "h-7 w-40 rounded-inline",
  /** A description that holds one line at every width. */
  LINE: "h-5 w-56 rounded-inline",
  /**
   * The second line of a description that wraps on a phone. Mirroring a
   * two-line description with one `LINE` under-draws the header by ~20px, and
   * a skeleton that is shorter than its content is a layout shift at handoff.
   */
  LINE_WRAP: "h-5 w-40 rounded-inline",
} as const;

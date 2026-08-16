import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Cellular settings — shared geometry and tone contract
// =============================================================================
// Single source of truth for this surface family's shapes. Every consumer
// imports from here, INCLUDING the skeletons — a skeleton that restates a
// number has left the contract (The Skeleton-Mirror Rule).
//
// SCOPE. This began as the contract for Cellular Basic Settings alone. It now
// governs five routes under `/cellular/settings/`: the basic settings page,
// APN Management, Network Priority, IMEI Settings and Blocked Networks. The
// four latecomers were each carrying their own hand-rolled geometry (legacy
// `rounded-xl`, `text-muted-foreground`, `bg-muted/30` washes) — adopting this
// file is what makes them one surface rather than four that merely sit under
// one nav group. Anything genuinely shared belongs here; anything true of ONE
// page stays in that page's own module.
//
// This file exists because the surface it replaces had the defect in miniature:
// the loading branch of `cellular-settings-card.tsx` hand-restated `h-4 w-36`
// and `h-9 w-full` per field, and its skeleton `CardTitle` read "Cellular Basic
// Settings" while the loaded card read "Modem Radio Settings" — a visible title
// swap on every load, invisible in review because the two strings sat 46 lines
// apart. Naming both from one place is what stops that recurring.
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING FROM THE APPROVED COMP
// -----------------------------------------------------------------------------
// The comp is drawn in raw pixels; this surface ships the role scale. The map is
// by SHAPE ROLE, not by nearest number:
//
//   comp 32px  card shell        -> `rounded-card`  (36px)
//   comp 26px  row group         -> `rounded-tile`  (28px)
//   comp 22px  promoted row      -> `rounded-field` (20px)
//   comp 999px chips, segments   -> `rounded-pill`
//
// A promoted row is deliberately a step TIGHTER than the group that contains it.
// Radius-Follows-Size means the inner thing is rounder-per-pixel but smaller in
// absolute radius; matching the group's 28px would make the promoted row read as
// a sibling of its own container.
//
// -----------------------------------------------------------------------------
// THE TONE RULE ON THIS SURFACE
// -----------------------------------------------------------------------------
// Rows are neutral at rest and PROMOTE to `primary-container` when dirty. That
// promotion is the brand acting — a pending edit is an action awaiting commit,
// which is precisely what `primary` means here. It is NOT a status; a dirty row
// is not "good" or "warning". No functional role may be used for pendingness.
//
// No row carries a border. Separation between rows is a hairline DIVIDER inside
// the group (`bg-surface-container-high`), and a promoted row drops the divider
// by covering it — never by drawing an outline (The No-Hairline-On-Fill Rule).
// =============================================================================

// -----------------------------------------------------------------------------
// Page + card shells
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-6 p-2";

/**
 * The two-column body. The comp runs 1.35fr / 1fr; expressed here as a
 * container query so it responds to the content column rather than the window
 * (the sidebar expanding must not restack the page).
 *
 * NO `items-start`. CSS grid's default `align-items: stretch` is what we want
 * here (DESIGN.md's Equal Heights rule) — the right column (AMBR + modem
 * reports) should rise to match the settings card's height rather than
 * leaving it visibly taller. `CARD_CELL` below is what actually carries that
 * stretch down into each `Card`.
 */
export const PAGE_GRID =
  "grid grid-cols-1 gap-4 @4xl/main:grid-cols-[1.35fr_1fr]";

/**
 * Wraps a grid cell so the stretched row height reaches the `Card` inside it.
 * A grid cell stretches by default, but a block child does not inherit that
 * as its own height unless told to — see DESIGN.md > Layout > "Equal heights
 * are explicit".
 */
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

/** A card on this surface. Peer role — no hero anchor here. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 28px, matching the sibling `/cellular/` surfaces. */
export const CARD_PAD = "px-7";

/**
 * A peer card's title: the Title step (18px), plus the truncation pair.
 *
 * `CardTitle` ships only `leading-none font-semibold` and takes its size from
 * the call site, so an unsized one inherits 16px — which is what these cards
 * shipped, leaving them the same size as the hero anchor above them and
 * flattening the surface's whole type ramp.
 *
 * `min-w-0` is the other half. These two cards are peers in a grid and are
 * height-locked to each other by `CARD_CELL`; without it a long title in one
 * locale (Italian is the one that trips it) pushes its own header box wider
 * than the grid track instead of wrapping inside it. It WRAPS rather than
 * truncating — a card title that silently loses its last word is worse than a
 * two-line one — which is why `leading-none` has to go with it.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

// -----------------------------------------------------------------------------
// The read-only hero (modem reports + AMBR), basic settings page
// -----------------------------------------------------------------------------

/**
 * The page's anchor card. `rounded-hero` (40px) — one per surface, under the
 * Consistent-Layout Rule's "a genuine glance surface may earn a hero card"
 * exception (same ruling as `band-locking/shapes.ts`). The merged reports +
 * rate-limits readout is exactly that glance surface: it answers "what is the
 * modem doing right now and what will the network let it do" before the user
 * touches a setting.
 *
 * `py-7` (28px) rather than the peer card's `py-6` — the hero carries more
 * content and the extra vertical padding is what lets it read as the anchor.
 */
export const HERO_SHELL =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface py-7 shadow-[var(--shadow-whisper)]";

/** Hero card padding: 28px horizontal, matching CARD_PAD. */
export const HERO_PAD = "px-7";

// -----------------------------------------------------------------------------
// The hero — Band 1: the identity rail
// -----------------------------------------------------------------------------

/**
 * The hero's anchor statement: a HORIZONTAL rail, not a centred big-figure
 * stack. Glyph disc → serving technology → carrier → freshness chip, on one
 * baseline.
 *
 * WHY A RAIL AND NOT A HERO METRIC. The obvious shape here is the hero-metric
 * template — one large figure over a small label with supporting stats beneath.
 * It is refused on two grounds. First, the value is a CATEGORY ("5G NSA"), not
 * a magnitude, and setting a four-character category at display size buys
 * emphasis it cannot spend. Second, the template's small-label-above-big-value
 * arrangement is an eyebrow, and an eyebrow over a heading is banned outright
 * on this product. The rail states the technology at the Headline+1 step with
 * the carrier as its own supporting line and no label above either.
 *
 * THE FILL IS IDENTITY, NEVER HEALTH (The Identity-Chip Rule). NR takes the
 * brand blue, LTE the identity violet, and an UNIDENTIFIED technology takes the
 * NEUTRAL pair — an unknown radio must never claim the 5G blue. The freshness
 * chip riding at the rail's end is a status Badge with its own container pair,
 * so quality is reported chromatically only inside that chip and never by the
 * rail's own fill.
 *
 * HEIGHT IS THE TILE FLOOR, NOT A DERIVATION. DESIGN.md defines a tile as "a
 * 28px-radius block, 92px minimum height, holding a 52px full-round glyph disc
 * beside a text column" — which is exactly this rail, down to the disc size and
 * the inverted pairing. An earlier draft derived 84px from `52 + py-4 x2` and
 * shipped the product's most prominent instance of the pattern as the one that
 * is short. 92 -> 5.75rem, which gives the 52px disc 20px of air either side
 * (`py-4` still applies; the floor is what wins). The text column measures
 * tech 29 + gap 4 + carrier 18 = 51 and clears it either way.
 *
 * HEIGHT carries the RADIUS as well as the height. A skeleton that mirrors the
 * height from the contract and then hand-writes `rounded-tile` beside it has
 * kept half the contract (The Skeleton-Mirror Rule).
 */
export const HERO_RAIL = {
  ROOT: "flex min-h-[5.75rem] items-center gap-4 rounded-tile px-5 py-4",
  /** Mirrors ROOT's resolved height AND radius, for the skeleton. */
  HEIGHT: "h-[5.75rem] rounded-tile",
  /** The 52px glyph disc. Tone INVERTS the rail's pairing at the call site. */
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The glyph inside the disc. Exported so retuning DISC cannot desync it. */
  GLYPH: 28,
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  /**
   * The serving technology. One step above the tile Headline (`text-xl`)
   * because this is the page's single dominant statement and the tiles it
   * replaces no longer exist to compete with it. `truncate` is mandatory:
   * "5G NSA" is short in English and is not short in every locale.
   */
  TECH: "truncate text-2xl font-semibold leading-[1.05] tracking-[-0.01em]",
  /**
   * The carrier. Human-authored, so `font-sans` (The Machine-Voice Rule) — an
   * operator name is not a machine string even though the modem reports it.
   * `opacity-90`, not 85: this line carries a FACT, not decoration, and 90 is
   * the step the family already uses for on-fill body text
   * (`SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL`, `CHOICE_ROW.CAPTION`).
   */
  CARRIER: "truncate text-[0.8125rem] font-medium opacity-90",
  /**
   * The rail's statement when the read FAILED — a sentence, not a category,
   * so it takes the Title step instead of `TECH`'s 24px (a sentence at 24px
   * truncates on its first word in a rail that also holds a 52px disc).
   *
   * The rail keeps its geometry in this state rather than collapsing to a
   * skeleton: a skeleton is a promise that data is on its way, and holding one
   * indefinitely over a dead poller is the same class of misstatement as the
   * whole-card "Live" chip this hero was rebuilt to remove.
   */
  NOTICE: "truncate text-lg font-semibold",
  META: "flex flex-none items-center gap-2",
} as const;

/**
 * Rail tone pairs. A rail is a FILL pair and its disc is the matching
 * CONTAINER pair — the inversion `radio/summary-tiles.tsx` makes, so the glyph
 * pops off its own surface and survives grayscale.
 */
export const HERO_RAIL_TONE = {
  NR: "bg-primary text-primary-foreground",
  NR_DISC: "bg-primary-container text-on-primary-container",
  LTE: "bg-lte text-lte-foreground",
  LTE_DISC: "bg-lte-container text-on-lte-container",
  NEUTRAL: "bg-surface-container text-on-surface",
  NEUTRAL_DISC: "bg-surface-container-high text-on-surface-variant",
} as const;

// -----------------------------------------------------------------------------
// The hero — Band 2: the three-column body
// -----------------------------------------------------------------------------

/**
 * Rates, rates, parameters — the column order the surface was designed to.
 *
 * The third column is WIDER (1.15fr) because it holds identifiers: an APN can
 * run 21 characters and a carrier-aggregation breakdown is two facts on one
 * line, while a rate column holds a heading and two 8-character chips. Equal
 * thirds would truncate the only column whose contents a technician opened the
 * page to read (the `READOUT_ROW.GRID` argument, one level up).
 *
 * KEYED OFF `@container/hero`, NEVER `/main`. The hero's own width decides
 * whether three columns fit; the sidebar expanding must not restack the page.
 * Every step is written out literally — a template-interpolated step compiles
 * to no rule at all (see `SEGMENTED_BREAKPOINTS`).
 *
 * THE THREE-COLUMN STEP IS `@5xl` (64rem), NOT `@4xl`. It was measured, not
 * chosen: at a 56rem hero the first rate column resolves to 258px and its
 * content box to 222px, which is narrower than a 20px heading plus the
 * governing chip beside it (~235px) — so the heading wrapped under the chip at
 * every width in the 896-1024px band. At 64rem the column is 298px / 262px
 * inner and the header sits on one line. Below the step the two-column layout
 * gives each block ~301px, which also clears it.
 */
export const HERO_BODY =
  "grid grid-cols-1 gap-3.5 @2xl/hero:grid-cols-2 @5xl/hero:grid-cols-[1fr_1fr_1.15fr]";

/**
 * The parameters cell. At the two-column step it spans the full width UNDER
 * the rate pair, which is the only arrangement that keeps the two rate blocks
 * as visual peers — putting one rate block beside the parameters would imply a
 * pairing between them that does not exist.
 */
export const HERO_BODY_PARAMS_CELL = "@2xl/hero:col-span-2 @5xl/hero:col-span-1";

/**
 * One cell of `HERO_BODY`. Carries the row's stretch down to the block inside.
 *
 * THIS IS `CARD_CELL`'S LESSON ONE LEVEL DOWN, and it shipped broken: a grid
 * item stretches to the row height by default, but a BLOCK CHILD of that item
 * does not inherit the height unless told to (DESIGN.md > Layout > "Equal
 * heights are explicit"). Each cell here is a `motion.div` wrapper, so the
 * wrapper was full height while the `<section>` inside it stayed content-sized.
 *
 * Caught on screen, not in review, and only at the THREE-column step: the
 * parameters column runs four rows plus a heading (~180px) while a rate block
 * with one bearer is ~118px, so the two rate blocks floated with ~70px of dead
 * space beneath them and the row ended on three different bottom edges. At the
 * two-column step the parameters column sits on its own full-width row and the
 * two rate blocks are natural peers, which is why every narrower width looked
 * correct and the defect was invisible below 64rem.
 *
 * `*:h-full` rather than a class on each block: the cell has exactly one child
 * in every branch (block, empty block, unavailable block, or skeleton), and
 * naming it here means a new branch cannot forget it.
 */
export const HERO_BODY_CELL = "h-full *:h-full";

/**
 * The provenance line under all three columns.
 *
 * It exists because the hero has TWO CLOCKS and one of them does not tick. The
 * freshness chip on the rail is honest about the poller and says nothing about
 * the rate columns, which are fetched on mount and re-fetched only around a
 * save. A single "Live" chip over a card whose visual majority can be
 * arbitrarily old is a straightforward misstatement, and this line is the fix.
 * It also names what an AMBR figure IS — a ceiling the network grants, not a
 * speed the modem is achieving — which nothing else on this page does.
 */
export const HERO_FOOTNOTE =
  "text-on-surface-variant text-[0.75rem] leading-relaxed text-pretty";

/**
 * Column 3: the active parameters block.
 *
 * A NEUTRAL block beside two identity-filled ones, deliberately. These facts
 * belong to no radio, and giving them a hue would invent a fourth identity.
 *
 * ROW STEPS UP ONE TONE. `READOUT_ROW.ROOT` is `bg-surface-container`, which
 * is this block's own fill — nesting them would make the rows invisible. The
 * rows take `surface-container-high`, one step up, which is what Tonal
 * Elevation means by depth. The row geometry is otherwise identical to
 * `READOUT_ROW.ROOT`, so `READOUT_ROW.HEIGHT` remains its skeleton mirror.
 *
 * `min-h-[9rem]` matches `AMBR_BLOCK.COL_MIN` so the three columns share a
 * floor and an empty rate column never reads as a layout bug.
 *
 * HEADING IS THE TITLE STEP (18px), NOT `text-sm`. It shipped at 14px, which is
 * the same size as the `CardDescription` two nodes above it and one pixel off
 * the 13px rows below it — the hero's whole type ladder collapsed into 24 -> 16
 * -> 14 -> 14 -> 13 with the 18 and 20 steps unused. It is a peer of the two
 * rate-block headings and carries the same class, so retuning one retunes all
 * three (see `AMBR_BLOCK.TITLE`).
 */
export const HERO_PARAMS = {
  ROOT: "flex min-h-[9rem] flex-col gap-1.5 rounded-tile bg-surface-container p-3",
  HEADING: "px-1 pb-0.5 text-lg font-semibold",
  ROW: "flex items-center gap-3 rounded-pill bg-surface-container-high px-4 py-2.5",
} as const;

// -----------------------------------------------------------------------------
// The governing-block marker
// -----------------------------------------------------------------------------

/**
 * Which rate block governs the bearer the modem is actually using.
 *
 * WHY THIS EXISTS. LTE AMBR governs `LTE` and `5G-NSA` (NSA's NR leg is a
 * secondary carrier on the LTE-anchored PDN, with no AMBR of its own); NR5G
 * AMBR governs `5G-SA` only. The old hero encoded that by rendering exactly
 * one block. Rendering both is a better read — the user can see what each
 * radio would grant — but it drops the fact that only one of them is in force,
 * and that fact has to come back somewhere.
 *
 * IT MUST NOT COME BACK AS A HUE. `AMBR_BLOCK`'s own comment names the
 * constraint it is now cashing: the violet fill is doing identity work alone
 * and is safe there ONLY because the block reports no quality — "if a health
 * state is ever added to this block it needs a non-chromatic channel." This is
 * that state and this is that channel: a GLYPH plus a WORD, in two shapes
 * (filled chip vs plain inline text). Both survive grayscale and deuteranopia,
 * and the fill of each block stays exactly what it was.
 *
 * THE CHIP WEARS ITS OWN BLOCK'S FILL PAIR, not a status role. `info` renders
 * `primary-container`, which is invisible on the 5G block; `success` would
 * claim health, and governance is not health. The block's container inverted
 * to its own fill is the pairing the tile discipline already uses, it declares
 * both halves so consumers set no ink, and it reads as "this block, emphasised"
 * rather than as a verdict.
 *
 * ABSENCE IS NOT THE SIGNAL. The non-governing block states its state in
 * words too. A marker that only ever appears once would leave the other block
 * ambiguous between "not in use" and "we didn't check".
 */
export const GOVERNING_MARK = {
  CHIP: "inline-flex h-[1.375rem] flex-none items-center gap-1.5 rounded-pill px-2.5 text-[0.6875rem] font-semibold",
  ON_LTE: "bg-lte text-lte-foreground",
  ON_NR: "bg-primary text-primary-foreground",
  /** The non-governing state: no chip, no fill, the block's own ink dimmed. */
  IDLE: "inline-flex flex-none items-center gap-1.5 text-[0.6875rem] font-semibold opacity-90",
  GLYPH: 13,
} as const;

/** Glyphs. Both already in the font subset — this change adds no glyph. */
export const GOVERNING_GLYPH = {
  governing: "check_circle",
  idle: "do_not_disturb_on",
} as const satisfies Record<string, MaterialSymbolName>;

// -----------------------------------------------------------------------------
// The per-slot SIM chip (dual-slot readout)
// -----------------------------------------------------------------------------

/**
 * One physical SIM slot in the hero's parameters column: which slot, and the
 * tail of the card sitting in it.
 *
 * THIS IS `GOVERNING_MARK` ONE ROW DOWN, and it is deliberately built to the
 * same rule rather than to a status role. "The modem is switched to this slot"
 * is not a health claim — a standby SIM is not degraded, and an empty second
 * slot is a configuration, not a fault — so `success` / `muted` are both wrong
 * answers here (The Functional-Color Promise). The operative peer is marked
 * exactly as the governing AMBR block is: a FILLED CHIP with its own glyph,
 * against PLAIN INLINE TEXT with a different glyph. Shape, glyph and fill all
 * move together, so the pair survives grayscale and deuteranopia.
 *
 * `bg-primary`, not a container: this chip sits on `HERO_PARAMS.ROW`
 * (`surface-container-high`), and a container fill on a container row is the
 * step-collision `HERO_PARAMS`'s own comment documents. The fill pair also
 * declares its ink, so consumers set none.
 *
 * ABSENCE IS NOT THE SIGNAL — both slots always render. A readout that showed
 * only the active slot would leave the other ambiguous between "empty" and "not
 * read", which is the whole reason this row exists.
 */
export const SLOT_CHIP = {
  /** The slot the modem is switched to. */
  ACTIVE:
    "inline-flex h-[1.375rem] flex-none items-center gap-1.5 rounded-pill bg-primary px-2.5 text-[0.6875rem] font-semibold text-primary-foreground",
  /** Every other slot: no chip, no fill, the column's quieter ink. */
  IDLE: "text-on-surface-variant inline-flex flex-none items-center gap-1.5 text-[0.6875rem] font-semibold",
  /**
   * The masked ICCID tail. A raw device-emitted identifier, so `font-mono`
   * (The Machine-Voice Rule) — and `tabular-nums` because it sits beside a
   * second slot's tail and the two should align.
   */
  ICCID: "font-mono tabular-nums",
  GLYPH: 13,
} as const;

/**
 * Glyphs for a slot chip. Presence and activity are ONE glyph slot, not two: a
 * 13px chip has room for a single mark, and the tail text beside it already
 * states occupancy in words when a slot is empty.
 *
 * All three are in the font subset — this change adds no glyph.
 */
export const SLOT_GLYPH = {
  /** Switched to, card present. */
  active: "check_circle",
  /** Card present, standing by. */
  present: "sim_card",
  /** No ICCID reported for this slot. */
  empty: "sim_card_alert",
} as const satisfies Record<string, MaterialSymbolName>;

/** The Display triple every migrated page `h1` carries. */
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";

/** The page description directly under it. */
export const PAGE_DESCRIPTION = "text-on-surface-variant";

/** The page-header action pill. Restated, not imported — see custom-profiles. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

// -----------------------------------------------------------------------------
// The settings row group (the Pixel Settings pattern)
// -----------------------------------------------------------------------------

/**
 * One tonal group holding hairline-separated setting rows.
 *
 * `p-1.5` (6px) matches the comp's group padding and is what lets a promoted row
 * inset visibly rather than reaching the group's edge. Without it the promotion
 * fill is flush and reads as the group changing color, not the row.
 */
export const ROW_GROUP = {
  ROOT: "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5",
  /**
   * The hairline between two rows. Inset from the group edge so it reads as a
   * separator rather than a full-bleed rule. Hidden adjacent to a promoted row.
   */
  DIVIDER: "mx-4 h-px bg-surface-container-high",
} as const;

/**
 * One setting row.
 *
 * HEIGHT is the skeleton's mirror. It is a `min-h` floor on ROOT rather than a
 * fixed height because the consequence line wraps to two lines on narrow
 * containers — a fixed height would clip it. The floor is derived, not guessed:
 * label 20 + gap 3 + consequence 18 = 41, plus `py-4` x2 = 73 -> 4.5625rem,
 * rounded to the 4.75rem the control's own 42px pill height dominates anyway.
 */
export const SETTING_ROW = {
  ROOT: "flex min-h-[4.75rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** Mirrors ROOT's resolved floor, for the skeleton. */
  HEIGHT: "h-[4.75rem]",
  /**
   * The label + consequence column.
   *
   * `flex-1` is load-bearing, not cosmetic. With `min-w-0` alone this column
   * will shrink to zero against a `flex-none` control, and the consequence
   * sentence then wraps to ONE WORD PER LINE — a ~500px tall row. Caught on
   * screen, not in review: it only appears when the control happens to be wide
   * (an untranslated label, a long locale, four segments), so the layout looks
   * fine right up until it doesn't. `flex-1` makes the text claim its share
   * first; `min-w-0` still lets it wrap rather than overflow.
   */
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.75",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The one-line consequence. This is the sentence that makes a settings row a
   * decision rather than a field — it is required on every row, not optional.
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/**
 * The line a write card shows INSTEAD of its rows when the modem was never
 * read — one quiet sentence occupying exactly one row's slot inside the group.
 *
 * WHY IT EXISTS. The card's loading branch is `isLoading || !draft || !settings`,
 * and on a failed read `isLoading` goes false while `settings` stays `null`. So
 * both write cards held their skeleton FOREVER, shimmering with no explanation —
 * a skeleton is a promise that data is on its way, and this is where that promise
 * is broken. Same defect the hero fixed with its `unavailable` branches
 * (`HERO_RAIL.NOTICE`), arriving one card over.
 *
 * IT IS DELIBERATELY QUIET, NOT A SECOND ALARM. The route shell already renders a
 * `destructive` `TonalBanner` with the retry action when `error` is set; the page
 * says "Couldn't read the modem" once, and a card repeating it in a functional
 * role would say it three times on a page with two cards. This states only why
 * THIS card has nothing to show — no glyph, no chip, no role colour.
 *
 * A LATER failure does not use this branch. The hook leaves the previous
 * snapshot in place on a failed re-read, so the card keeps rendering real values
 * and the banner is what says they may be stale. Only the never-read case has
 * nothing to draw.
 *
 * GEOMETRY IS COMPOSED, NEVER RESTATED. It wears `SETTING_ROW.ROOT`'s own box
 * (radius, padding, the 4.75rem floor) and `SETTING_ROW.CONSEQUENCE`'s ink and
 * size, so the card holds its height and the notice cannot drift from the rows
 * it replaces.
 */
export const CARD_NOTICE = `${SETTING_ROW.ROOT} ${SETTING_ROW.CONSEQUENCE}`;

/**
 * A row promoted because it holds an unsaved edit.
 *
 * The ink flips to `on-primary-container` for the whole row, so the consequence
 * line must NOT keep `text-on-surface-variant` — that is a cross-pair, one
 * role's ink on another role's container, and it is the most common way this
 * pattern goes wrong. Consumers apply CONSEQUENCE_ON_FILL instead.
 */
export const SETTING_ROW_DIRTY = {
  ROOT: "bg-primary-container text-on-primary-container",
  /** The consequence line when the row is promoted. */
  CONSEQUENCE_ON_FILL: "text-[0.78125rem] leading-relaxed text-pretty opacity-90",
  /**
   * The "before -> after" chip. Machine-voice: these are literal setting values,
   * so `font-mono` is correct here and nowhere else in the row.
   */
  DELTA_CHIP:
    "inline-flex h-[1.375rem] flex-none items-center rounded-pill bg-primary px-2.5 font-mono text-[0.6875rem] font-semibold text-primary-foreground",
} as const;

// -----------------------------------------------------------------------------
// The segmented control
// -----------------------------------------------------------------------------

/**
 * Track + segment geometry for the pill group that replaces a Select on binary
 * and three-way choices.
 *
 * The active fill is a TRAVELLING `motion.span` carrying an instance-scoped
 * `layoutId` (see `signal-history.tsx:302-315`). Two rules ride on that:
 *   1. Nothing animates `width` — motion tweens the box between positions.
 *      Segments have unequal label widths, so a cross-fade would visibly jump.
 *   2. The `layoutId` MUST be scoped per instance. This surface renders THREE
 *      segmented controls at once; sharing an id makes their thumbs fly across
 *      each other on first paint.
 *
 * SEGMENT neutralises the ToggleGroupItem's own `data-[state=on]` fill so the
 * travelling span is the only thing that paints.
 */
export const SEGMENTED = {
  TRACK: "flex rounded-pill bg-surface-container-high p-1",
  /**
   * The same track on a PROMOTED row, which drops its fill entirely.
   *
   * An earlier draft wrote `bg-primary/25` here. That is an alpha wash — the
   * exact thing this file's Tone Rule forbids — and it was reached for because
   * the brand ramp has no `--tone-primary-*` steps to step up into. The absence
   * is the canon telling you the answer is different, not that you should
   * invent one with opacity: on a promoted row the ROW is already the tonal
   * container, so a second fill behind the segments is redundant. Only the
   * travelling thumb paints, and it reads correctly against the container.
   */
  TRACK_ON_FILL: "flex rounded-pill p-1",
  SEGMENT:
    "relative h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium text-on-surface-variant hover:bg-transparent hover:text-on-surface data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary-foreground",
  /**
   * The same segment on a PROMOTED row.
   *
   * The inactive ink MUST change with the container. `SEGMENT` carries
   * `text-on-surface-variant`, which is the ink for a NEUTRAL surface; leaving
   * it on a `primary-container` row puts one role's ink on another role's
   * container — the exact cross-pair this file's Tone Rule names, and one this
   * file shipped anyway until it was seen on screen. Inactive segments take
   * `on-primary-container`; the active one keeps `primary-foreground`, since
   * its own `bg-primary` thumb is what it sits on.
   */
  SEGMENT_ON_FILL:
    "relative h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium text-on-primary-container hover:bg-transparent hover:text-on-primary-container data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary-foreground",
  /** The travelling fill. */
  THUMB: "absolute inset-0 rounded-pill bg-primary",
  /** Label sits above the thumb. */
  LABEL: "relative",
  /** Glyph size inside an active segment. */
  GLYPH: 16,
} as const;

/**
 * Below this container width the segmented control is replaced by a Select.
 *
 * Four segments ("Automatic" / "LTE + 5G" / "5G NR only" / "LTE only") do not
 * fit one row on a phone, and shrinking them below a 44px touch target is not
 * an option on a surface field techs use on a tablet. The Select is the honest
 * fallback and is bound to the same state.
 */
/**
 * The pill-group / Select switch, parameterised by the card step it keys off.
 *
 * WHY A FACTORY. The basic settings page used to hold all six rows in one wide
 * card; it now holds three rows in each of two narrower peers, and the family's
 * default `@2xl/card` step (42rem) would push a half-width card onto the Select
 * fallback at desktop widths where the old single card showed the pill group —
 * a silent control change on exactly the widths a desktop review looks at.
 *
 * THE CLASSES MUST BE LITERAL. Tailwind's scanner only compiles class names it
 * finds verbatim in source, so the map below is written out in full — a
 * template string like `` @${step}/card:flex `` produces NO rule, which once
 * shipped as exactly that: the pill group silently vanished at every width and
 * every SegmentedField rendered only its Select. If a step is added, the four
 * strings for it must be spelled out, never interpolated.
 *
 * The ROW keeps its own `@2xl/card` step: between the two breakpoints a row is
 * stacked (text above control) and the pill group renders full-width under it,
 * which is the same arrangement a phone already shows.
 */
const SEGMENTED_BREAKPOINTS = {
  lg: {
    GROUP: "hidden @lg/card:flex",
    SELECT: "flex w-full @lg/card:hidden",
    /** The wrapper: full width in stacked-row mode, natural width side by side. */
    WRAP: "flex w-full @lg/card:w-auto",
  },
  xl: {
    GROUP: "hidden @xl/card:flex",
    SELECT: "flex w-full @xl/card:hidden",
    WRAP: "flex w-full @xl/card:w-auto",
  },
  "2xl": {
    GROUP: "hidden @2xl/card:flex",
    SELECT: "flex w-full @2xl/card:hidden",
    WRAP: "flex w-full @2xl/card:w-auto",
  },
} as const;

/** Literal strings only — see the header comment. Never interpolate. */
export const segmentedBreakpoint = (step: "lg" | "xl" | "2xl" = "2xl") =>
  SEGMENTED_BREAKPOINTS[step];

/** The dropdown trigger for rows that stay a Select at every width. */
export const SELECT_TRIGGER =
  "h-[2.625rem] w-full rounded-pill border-0 bg-surface-container-high px-4 text-[0.84375rem] font-medium @2xl/card:w-auto";

/**
 * A free-text field on this surface, as a RAW `<input>` rather than
 * `components/ui/input.tsx`.
 *
 * WHY THE PRIMITIVE IS NOT USED. `input.tsx` ships `dark:bg-input/30` and
 * `md:text-sm`. `tailwind-merge` groups by class type *including the modifier*,
 * so an unprefixed `bg-surface-container-high` from `SELECT_TRIGGER` does not
 * displace a `dark:`-scoped fill and an unprefixed text size does not displace
 * an `md:`-scoped one — tailwind-merge keeps BOTH and the last one wins at the
 * breakpoint. The field therefore reverts to the primitive's fill in dark mode
 * and to its type size above 768px, silently, on exactly the two axes a
 * desktop light-mode review never looks at. Overriding them at the call site
 * means restating `SELECT_TRIGGER`'s own numbers as `dark:` and `md:` variants,
 * which is the drift this file exists to prevent.
 *
 * Two independent builders hit this on two different pages in the same change
 * and each wrote their own local constant; this is that constant, promoted once
 * so the third page cannot write a fourth version of it.
 *
 * MONO IS CORRECT HERE and is not a costume: every consumer holds an identifier
 * the device emits verbatim (an IMEI, a TAC, an APN). The letter-spacing is
 * what makes fifteen undifferentiated digits scannable. The placeholder
 * deliberately drops back to the interface voice — a placeholder is
 * human-authored instruction, not machine output, and mono'd prompt text reads
 * as though the field were already filled.
 */
export const FIELD_INPUT = [
  "font-mono tracking-[0.06em] tabular-nums",
  "placeholder:font-sans placeholder:tracking-normal placeholder:text-on-surface-variant",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  "aria-invalid:ring-[3px] aria-invalid:ring-destructive/40",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

/**
 * The same trigger on a PROMOTED row.
 *
 * Same cross-pair trap as `SEGMENTED.SEGMENT_ON_FILL`, one level down and
 * easier to miss: it only appears BELOW the segmented breakpoint, so on a
 * desktop review the Select is never on screen at the moment a row is dirty.
 * A neutral `surface-container-high` fill on a `primary-container` row reads as
 * a dead grey hole punched in the brand fill. `bg-primary` with its own
 * `primary-foreground` ink is the pair that belongs there.
 */
export const SELECT_TRIGGER_ON_FILL =
  "h-[2.625rem] w-full rounded-pill border-0 bg-primary px-4 text-[0.84375rem] font-medium text-primary-foreground @2xl/card:w-auto";

/**
 * A complete text field, at rest and promoted. Compose with a width and nothing
 * else.
 *
 * THESE EXIST AS A PAIR BECAUSE THE FIELD IS WHAT MAKES THE ROW DIRTY. Every
 * other control on this surface got an `_ON_FILL` variant the moment it could
 * land on a promoted row, and a free-text field is the one control where that
 * is guaranteed rather than possible: the user typing in it is precisely what
 * flips the row to `primary-container`. A field that keeps the neutral
 * `surface-container-high` fill there is a dead grey hole punched in the brand
 * fill — the same failure `SELECT_TRIGGER_ON_FILL` above documents, except that
 * one only surfaces below the segmented breakpoint while this one is visible at
 * every width, on the primary interaction of the card.
 *
 * The placeholder ink has to move too, and it must be appended LAST: it lands
 * in the same tailwind-merge group as `FIELD_INPUT`'s own placeholder colour,
 * so order decides the winner.
 */
export const FIELD_SHELL = `${SELECT_TRIGGER} ${FIELD_INPUT}`;

export const FIELD_SHELL_ON_FILL = `${SELECT_TRIGGER_ON_FILL} ${FIELD_INPUT} placeholder:text-primary-foreground/70`;

/**
 * Inline validation copy on a plain card.
 *
 * `--destructive` is the STRONG FILL and belongs only under
 * `--destructive-foreground`. Tinted error text sitting directly on a card is
 * the `--{role}-on-surface` slot — picking the wrong one of the five is the
 * failure DESIGN.md calls "the most common contrast failure in this system",
 * and it bites hardest in dark mode where `--destructive` is a LIGHT fill.
 *
 * `shadcn`'s `FieldError` hardcodes `text-destructive`, so this is passed as a
 * `className` override at the call site rather than being fixed in the
 * primitive — `field.tsx` is route-agnostic and shared with unconverted
 * surfaces that still want the legacy token.
 */
export const INLINE_ERROR = "text-destructive-on-surface";

/** A hairline rule between sections INSIDE a card, not between rows. */
export const SECTION_DIVIDER = "h-px bg-surface-container-high";

// -----------------------------------------------------------------------------
// The pending-changes save bar
// -----------------------------------------------------------------------------

/**
 * The bar only exists while something is pending — it is not a permanently
 * mounted footer that greys out.
 *
 * ON THE EXIT ANIMATION. DESIGN.md bans exit animations on BANNERS, scoped to
 * "conditions and navigation": a banner leaving means the condition cleared and
 * that should feel immediate. A save bar is not a condition — its disappearance
 * is the terminal frame of a commit the user initiated, and cutting it dead
 * reads as the app dropping the interaction. So it exits, but on the QUICK
 * clock, transform + opacity only (the Modal-Exit Rule's reasoning by analogy:
 * the exit clock is how long the user waits to see the result).
 *
 * `SaveButton` must never be wrapped in `AnimatePresence` — unmounting one of
 * its stacked layers removes that layer's width contribution and breaks its
 * width lock.
 */
export const SAVE_BAR = {
  ROOT: "flex flex-col gap-3 rounded-tile bg-surface-container px-5 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4",
  /**
   * The wrapper a save bar needs when it is NOT rendered inside a card.
   *
   * `ROOT` and `ACTIONS` key off `@2xl/card`, which is correct for the three
   * call sites that live inside a `CARD_SHELL` (`@container/card` is declared
   * there). The basic-settings shell renders `PendingSaveBar` under the card
   * grid instead, where the only container ancestor is `@container/main` — so
   * the query matched NOTHING at any width and the bar shipped as a
   * left-aligned stacked column on full desktop, count above note above
   * buttons.
   *
   * The fix is to give the bar the container it is written against rather than
   * to re-key it: re-keying would need `@2xl/main` spelled beside every
   * `@2xl/card` utility, and a bar sitting in a HALF-WIDTH card on a wide page
   * would then go side-by-side at a width where it does not fit.
   *
   * `empty:hidden` is load-bearing. The bar only exists while something is
   * pending, so this wrapper is an empty flex item the rest of the time — and
   * an empty flex item still claims its parent's `gap-4`, leaving 16px of dead
   * air above the re-read footer.
   */
  HOST: "@container/card empty:hidden",
  TEXT: "flex min-w-0 flex-col gap-0.5",
  COUNT: "text-sm font-semibold tabular-nums",
  NOTE: "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  ACTIONS: "flex flex-none items-center gap-2 @2xl/card:ml-auto",
} as const;

/**
 * The step ledger the bar becomes while applying.
 *
 * A slot change holds the modem for ~35s (radio cycle, then up to ten
 * verification read-backs, then an 8s client recovery wait). A button that
 * simply spins for that long reads as a hang, so the bar names the phase it is
 * in. Progress is DOTS plus a spinner, never a fill bar — fills are reserved
 * for data visualisation (The Loader-and-Dots Rule).
 */
export const APPLY_LEDGER = {
  ROOT: "flex flex-col gap-2.5",
  STEP: "flex items-center gap-2.5 text-[0.8125rem]",
  DOT: "size-1.5 flex-none rounded-pill",
  DOT_PENDING: "bg-outline",
  DOT_ACTIVE: "bg-primary",
  DOT_DONE: "bg-success",
} as const;

// -----------------------------------------------------------------------------
// The read-only "What the modem reports now" card
// -----------------------------------------------------------------------------

/**
 * A fact row. Label left, value right.
 *
 * NO DOT SEPARATORS. The comp joined facts with a `·` ("SIM 2 · ready",
 * "talkntext · 51502"); DESIGN.md's No-Dot-Separator Rule forbids it — a meta
 * line joining short facts uses spacing, never a glue character. VALUE_GROUP
 * gives the facts a real gap instead.
 */
export const READOUT_ROW = {
  LIST: "flex flex-col gap-1.5",
  ROOT: "flex items-center gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  LABEL: "text-on-surface-variant flex-none text-[0.8125rem]",
  /** Multiple facts in one value cell, spaced rather than punctuated. */
  VALUE_GROUP: "ml-auto flex min-w-0 items-center gap-2.5",
  /** Machine strings: identifiers, MCCMNC, slot names. */
  VALUE_MONO:
    "font-mono text-[0.8125rem] font-semibold tabular-nums truncate",
  /**
   * Human-authored labels never take mono (The Machine-Voice Rule) — but this
   * slot also carries CHANGING FIGURES that are not identifiers: a slot number
   * and a carrier-aggregation breakdown, both of which the poller re-writes
   * under the reader. `tabular-nums` is the Numeric step's defining property
   * and belongs on any figure that ticks, mono or not.
   */
  VALUE_TEXT: "text-[0.8125rem] font-semibold tabular-nums truncate",
  /** Mirrors ROOT's resolved height AND radius for the skeleton. */
  HEIGHT: "h-[2.5625rem] rounded-pill",
  /**
   * Two-up readout rows, for a strip reporting more facts than a single column
   * can hold at a comfortable measure.
   *
   * WHY THIS IS NOT A TILE GRID. The APN comp drew "what the network granted"
   * as `repeat(5, 1fr)` stat tiles. Two of those five cells hold a full APN
   * (`internet.talkntext.ph`, 21 chars) and a full IPv6 (up to 39 chars after
   * RFC 5952 compression) — at 1fr of a card column each, both truncate to
   * noise, and the two that truncate are the two a technician actually opened
   * the page to read. A label-left/value-right row gives the value the whole
   * remaining width and degrades by truncating the LONG tail of one value
   * rather than all five at once. Tiles are for figures that are short by
   * construction (a count, a bandwidth, a signal reading); these are
   * identifiers, and identifiers get rows.
   */
  GRID: "grid grid-cols-1 gap-1.5 @2xl/card:grid-cols-2 @2xl/card:gap-x-2.5",
} as const;

// -----------------------------------------------------------------------------
// Network Priority — the reorderable rank list
// -----------------------------------------------------------------------------

/**
 * One draggable priority row.
 *
 * Geometry follows SETTING_ROW rather than inventing a second row shape, but
 * it is deliberately SHORTER: a priority row carries no control, so the 4.75rem
 * floor that exists to clear a 42px pill would leave a visibly hollow row.
 *
 * DRAGGING IS NOT THE ONLY WAY IN. `dnd-kit`'s KeyboardSensor is already wired,
 * and the handle is a real focusable button with an `sr-only` label — a rank
 * list that can only be reordered by pointer is unusable to exactly the
 * technician most likely to be on a tablet with a keyboard case.
 */
export const REORDER_ROW = {
  ROOT: "flex items-center gap-3.5 rounded-field px-3 py-3.5",
  /** Mirrors ROOT's resolved height for the skeleton. */
  HEIGHT: "h-[4.25rem]",
  /**
   * The grab handle.
   *
   * `size-8` is the visual size; the coarse-pointer bump to 44px is NOT
   * optional and lives here rather than at the call site. This is the one
   * control on the surface whose whole job is being dragged, and 32px is under
   * the touch floor — on the tablet where someone is actually reordering RATs
   * in a van, a 32px target next to a scrolling list is a miss. `touch-none` is
   * set by the consumer alongside dnd-kit's activator ref, not here, because it
   * is a gesture-routing concern rather than a shape one.
   */
  HANDLE:
    "flex size-8 flex-none cursor-grab items-center justify-center rounded-pill text-on-surface-variant hover:bg-surface-container-high active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [@media(pointer:coarse)]:size-11",
  HANDLE_GLYPH: 20,
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.75",
  LABEL: "text-[0.9375rem] font-semibold",
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The trailing chip cluster ("Serving now"). */
  META: "flex flex-none items-center gap-2",
  /**
   * Lifted while dragging.
   *
   * `bg-surface` is load-bearing, not decoration. A resting row paints no fill
   * of its own — it reads as a row because the GROUP under it is
   * `surface-container`. Lift that row without giving it a fill and the shadow
   * ends up drawn around a transparent box, so the "raised" row shows the group
   * straight through itself: a shadow with nothing casting it. Promoting it to
   * `surface` is also the honest tonal statement — the row has left the group's
   * step and risen to the card plane, which is exactly what Tonal-Elevation
   * says depth is.
   *
   * The shadow is then the ONE place on this surface a shadow is load-bearing.
   * Everywhere else a tone step carries elevation; here the row has to read as
   * off the stack entirely while it is under the pointer, and there is no
   * higher step to promote it to.
   */
  DRAGGING:
    "relative z-10 bg-surface opacity-80 shadow-[0_12px_28px_-8px_oklch(0.19_0.032_258/0.35)]",
} as const;

/**
 * The rank numeral.
 *
 * THE NUMERAL WEARS THE RADIO FAMILY'S HUE. This is the comp's "identity hues
 * per radio family, rank stated as a numeral" read literally, and it replaces
 * a real defect: the shipped `RAT_COLORS` map painted LTE `bg-success` and
 * WCDMA `bg-destructive`, so a perfectly healthy 4G row rendered green-for-good
 * and a perfectly functional 3G fallback rendered red-for-broken. Those are the
 * functional roles being spent on identity, which is precisely what
 * The Functional-Color Promise forbids — a user who learns red means failure on
 * the dashboard found it meaning "3G" here.
 *
 * WCDMA gets a NEUTRAL, not a third identity hue. The palette ships exactly
 * three identity hues (primary/NR, lte/violet, uplink/cyan) and cyan is spoken
 * for; inventing a fourth by eye is what The Source-Color Rule exists to stop.
 * A neutral rank pill is also honest — WCDMA is the fallback of last resort,
 * and it is the one leg with no brand identity in this product.
 *
 * Each entry is a complete FILL pair, so it stays correct sitting on a neutral
 * row or on a promoted `primary-container` one (same reasoning as RATE_CHIP).
 *
 * `tabular-nums` in font-sans, NOT mono: the rank changes while the user drags
 * it, which is the Machine-Voice Rule's tell for the interface voice.
 */
export const RANK_PILL = {
  ROOT: "grid size-[1.875rem] flex-none place-items-center rounded-pill text-[0.8125rem] font-semibold tabular-nums",
  NR5G: "bg-primary text-primary-foreground",
  LTE: "bg-lte text-lte-foreground",
  NEUTRAL: "bg-surface-container-high text-on-surface-variant",
} as const;

/** Radio-family tone for a rank pill, keyed by the modem's own RAT token. */
export const RAT_RANK_TONE: Record<string, string> = {
  NR5G: RANK_PILL.NR5G,
  LTE: RANK_PILL.LTE,
  WCDMA: RANK_PILL.NEUTRAL,
};

// -----------------------------------------------------------------------------
// The single-select choice list (Carrier Profile / MBN)
// -----------------------------------------------------------------------------

/**
 * A list of mutually-exclusive options where the SELECTED one is promoted.
 *
 * WHY NOT RADIO CIRCLES. The comp drew Material's `radio_button_checked` /
 * `radio_button_unchecked` pair. Neither glyph is in the font subset, and
 * adding them means a Google Fonts round-trip plus a committed binary — for an
 * affordance this system already expresses better. Selection here is the same
 * promotion the settings rows use for pendingness' sibling state: the chosen
 * row IS a `primary-container` block. That reads at a glance across the card,
 * where an 18px circle does not, and it survives grayscale.
 *
 * SCROLL_CAP is not cosmetic. Some carrier firmware ships twenty-plus MBN
 * bundles; an uncapped list runs off the card and takes the save action with
 * it. The cap is in rem so it scales with the user's text size rather than
 * clipping the fifth row at 200% zoom.
 */
export const CHOICE_ROW = {
  SCROLL_CAP: "max-h-[17rem] overflow-y-auto",
  ROOT: "flex w-full items-center gap-3 rounded-field px-4 py-3 text-left transition-[background-color,color] duration-[--duration-standard] ease-[--ease-standard] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  REST: "hover:bg-surface-container-high",
  SELECTED: "bg-primary-container text-on-primary-container",
  /** Mirrors ROOT's resolved height for the skeleton. */
  HEIGHT: "h-[3.25rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  /** Bundle names are machine strings read back from firmware. */
  NAME: "font-mono text-[0.84375rem] font-semibold truncate",
  /**
   * The caption reports the LIVE state ("running since last boot"), which is a
   * different question from which row the user has currently drafted — so it
   * can land on a promoted row or a neutral one depending on whether the draft
   * agrees with the modem.
   *
   * It therefore sets no ink of its own and dims whatever the row already
   * carries. That is what makes it correct on both: `on-primary-container` when
   * promoted, `on-surface` when not. An earlier version of this comment claimed
   * only the selected row could carry a caption and so no on-fill variant was
   * needed — that was wrong the moment a user picked a bundle the modem is not
   * yet running, which is the entire point of the control.
   */
  CAPTION: "text-[0.71875rem] opacity-90",
  GLYPH: 18,
} as const;

// -----------------------------------------------------------------------------
// Data Rate Limits (AMBR)
// -----------------------------------------------------------------------------

/**
 * The LTE rates block.
 *
 * VIOLET IS THE LANGUAGE. The comp put an `lte_mobiledata_badge` glyph and an
 * "LTE" label chip on this block; both are gone by product decision, because the
 * card title already says LTE and the container fill already IS the LTE
 * identity. Keeping all three would be saying the same thing three times.
 *
 * The cost of that decision is real and is paid below: with the chip gone, the
 * violet fill is doing identity work alone, and `lte-container` must never be
 * read as "healthy" (The Identity-Chip Rule). It is safe here ONLY because this
 * block reports no quality — it reports two numbers and an APN. If a health
 * state is ever added to this block it needs a non-chromatic channel.
 */
export const AMBR_BLOCK = {
  LTE: "flex flex-col gap-3 rounded-tile bg-lte-container px-4.5 py-4 text-on-lte-container",
  NR: "flex flex-col gap-3 rounded-tile bg-primary-container px-4.5 py-4 text-on-primary-container",
  /**
   * The block heading, at the Title step (18px).
   *
   * It shipped at `text-sm` — 14px, identical to the `CardDescription` above it
   * — so the three column headings had no more weight than the card's own
   * subtitle. `HERO_PARAMS.HEADING` is its peer and carries the same class.
   */
  TITLE: "text-lg font-semibold",
  /** The bearer/DNN name. Machine string. */
  APN: "font-mono text-[0.84375rem] font-medium truncate",
  /**
   * One entry: the bearer name on its own line, its two rate chips under it.
   *
   * IT WAS A ROW AND THE ROW DID NOT FIT. `flex items-center` with an
   * `ml-auto flex-none` chip pair overflowed its own block at the gridded
   * step: a rate chip measures ~115px (`px-3` 24 + glyph 15 + `gap-1.5` 6 +
   * nine mono digits at 13px ~70), so the pair plus its gap is ~238px against
   * a 222-262px content box — and because the pair is `flex-none`, the
   * overflow was paid entirely by `APN`, truncating the one identifier a
   * technician opened the page to read down to nothing. This is the
   * `READOUT_ROW.GRID` argument arriving one level in: identifiers get their
   * own line rather than competing with figures for a shared one.
   *
   * RATES therefore drops `ml-auto` and `flex-none` and takes `flex-wrap`, so
   * on a phone-width hero the second chip wraps instead of overflowing.
   */
  ROW: "flex flex-col gap-2",
  RATES: "flex flex-wrap gap-2",
  HEIGHT: "h-[6.5rem]",
  /**
   * Heading + governing marker on one baseline. `items-start` so a wrapped
   * heading does not drag the chip down with it.
   */
  HEADER: "flex items-start justify-between gap-2",
  /** The NSA gloss, and any other one-line explanation on the fill. */
  NOTE: "text-[0.71875rem] leading-relaxed text-pretty opacity-90",
  /** The entry list. `gap-2.5` because a multi-PDN device shows two rows. */
  LIST: "flex flex-col gap-2.5",
  /**
   * The three-column floor. Derived: heading 26 + gap 12 + one stacked entry
   * (name 20 + gap 8 + chips 30 = 58) + py-4 either side 32 = 128 -> 8rem;
   * rounded up to 9rem so a two-entry block and a one-entry block sit closer
   * in height and an EMPTY_BLOCK column is not visibly shorter than its
   * populated neighbour. `HEIGHT` (6.5rem) stays the SKELETON mirror for the
   * stacked case; this is the floor for the gridded case.
   */
  COL_MIN: "min-h-[9rem]",
  /** Mirrors COL_MIN's height AND the block's radius, for the skeleton. */
  COL_HEIGHT: "h-[9rem] rounded-tile",
} as const;

/**
 * A single down/up rate chip.
 *
 * DIRECTION IS THE COLOUR, NOT THE RADIO. An earlier draft coloured both
 * chips after the block's radio identity (`bg-lte` inside the LTE block,
 * `bg-primary` inside the 5G block) — which is why an LTE download chip and
 * an LTE upload chip were the same purple, distinguished only by their arrow
 * glyph. A figure's DIRECTION now reads the same colour regardless of which
 * radio block it sits in — the radio identity still lives in the block's own
 * container fill (`AMBR_BLOCK.LTE` / `AMBR_BLOCK.NR`), one layer out from the
 * chip — and the two hues carrying that direction belong to neither radio.
 *
 * WHY ROSE AND CYAN, AND NOT BLUE AND VIOLET. An earlier pass used `primary`
 * (download) and `lte` (upload), reasoning that cyan read as a discordant third
 * accent sitting inside the violet LTE block. That observation was true and the
 * conclusion was still wrong: it fixed a local adjacency by spending the two
 * RADIO identity hues on a fact that is not about radios. Inside the LTE block
 * an upload chip then rendered in the LTE hue for reasons having nothing to do
 * with LTE, and blue meant 5G NR, the brand, "in progress" AND download
 * depending on which page you were reading.
 *
 * Direction now has its own axis: Downlink Rose (hue 341) and Uplink Cyan (hue
 * 200), neither of which can be confused for a radio. The chips sit ON the
 * block's radio container rather than borrowing from it, which is what makes a
 * rose download chip inside the violet LTE block legible as two independent
 * facts instead of one muddled one. Hue 341 is not a taste pick — sweeping the
 * full circle against every taken hue leaves exactly one window clearing the
 * 40-degree floor.
 *
 * The arrow glyph stays as the direction's SECOND channel (never the only
 * one — PRODUCT.md requires a paired readout to survive colour-blindness),
 * so the pairing degrades gracefully rather than depending on hue alone. That
 * matters more than it looks: at container lightness in dark mode this
 * system's tonal pairs collapse under deuteranopia and protanopia simulation,
 * so on a dark block the arrow is the information and the hue is reinforcement.
 *
 * ON THE FILL CHOICE. An earlier draft wrote `bg-lte/25` and `bg-primary/25`.
 * Both are alpha washes and both are wrong for the same reason as
 * `SEGMENTED.TRACK_ON_FILL` above. The correct move for a chip that must lift
 * off a CONTAINER is the role's own FILL pair — `bg-downlink` carries
 * `text-downlink-foreground`, `bg-uplink` carries `text-uplink-foreground`. That is
 * a real pair in both themes, where an alpha is a different perceived
 * lightness in each. Note the pairs are declared here, so consumers must NOT
 * also set an ink class on the chip.
 */
export const RATE_CHIP = {
  ROOT: "inline-flex h-[1.875rem] items-center gap-1.5 rounded-pill px-3 font-mono text-[0.8125rem] font-semibold tabular-nums",
  ON_DOWNLOAD: "bg-downlink text-downlink-foreground",
  ON_UPLOAD: "bg-uplink text-uplink-foreground",
  GLYPH: 15,
} as const;

/**
 * The honest empty state for a radio with no reported rates.
 *
 * The comp's copy asserted "It has been LTE only on this site since 06:41" —
 * a claim this page has no data source for, and one that would be fabricated on
 * any device where the serving-technology parse failed. Removed by product
 * decision; the remaining sentence states only what is verifiable.
 */
export const EMPTY_BLOCK = {
  ROOT: "flex flex-col items-center gap-1.5 rounded-tile bg-surface-container px-4 py-5 text-center",
  GLYPH: 26,
  TITLE: "text-sm font-semibold",
  BODY: "text-on-surface-variant max-w-[19rem] text-[0.78125rem] leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

/**
 * SIM presence, as published by the poller's `.sim.status`.
 *
 * Every state carries its OWN glyph — `success-container` and `warning-container`
 * measure 1.03:1 apart and are identical under deuteranopia, so the glyph is the
 * only thing separating a ready SIM from one asking for a PIN. `not_inserted` is
 * `muted`, not `destructive`: an empty slot is a deliberate configuration, not a
 * fault. `error` is the fault.
 *
 * Keyed onto `BadgeVariant`, never onto a class string, so a new state without a
 * matching role fails the build.
 */
export const SIM_STATUS_BADGE: Record<
  string,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  ready: { variant: "success", glyph: "check_circle" },
  pin_required: { variant: "warning", glyph: "sim_card_alert" },
  puk_required: { variant: "warning", glyph: "lock" },
  not_inserted: { variant: "muted", glyph: "sim_card" },
  error: { variant: "destructive", glyph: "error" },
  unknown: { variant: "muted", glyph: "help" },
};

/** Glyph size inside a dense chip. */
export const BADGE_GLYPH_SIZE = 12;

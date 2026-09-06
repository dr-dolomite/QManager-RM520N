// =============================================================================
// System Settings — shared geometry and tone contract
// =============================================================================
// The `/system-settings` family's first shapes module, and the eighteenth in
// the product. Every consumer on this surface imports from here, INCLUDING the
// skeletons — a skeleton that restates a number has left the contract (The
// Skeleton-Mirror Rule).
//
// It exists because this was the last feature route still entirely on the
// pre-canon language: a grep across its five active component files for
// `on-surface`, `surface-container` and the shape radii returned zero matches,
// and the retired muted-foreground ink returned fifteen.
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box, and four
// `/local-network/` modules hold it again. This file imports none of them. A
// sibling family's module is not a shared library — what is shared is the
// SYSTEM's numbers, not a module. The values below are those numbers, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING
// -----------------------------------------------------------------------------
// The role scale, mapped by SHAPE ROLE rather than by nearest number:
//
//   36px  card shell        -> `rounded-card` — every card here is a PEER
//   28px  tile, row group   -> `rounded-tile`
//   20px  row, SIM row      -> `rounded-field`
//   12px  skeleton slivers  -> `rounded-inline`
//   999px fields, day pills -> `rounded-pill`
//
// `rounded-hero` is "the ONE card that anchors a surface". The anchor here is
// the status band, so the four cards below it are peers. It survives on the
// condition screen only, which is the primitive's own radius.
// =============================================================================

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page header. It replaces an inline `text-3xl font-bold` heading that is
 * missing the tracking the Display step specifies, so the title rendered
 * fractionally wider than every migrated surface. The spacing lives on the flex
 * gap rather than a trailing margin, so the header composes instead of pushing.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/** The 42px action pill. Restated per family, never imported across one. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The lucide glyph inside an action pill. */
export const PILL_GLYPH = "size-4";

/**
 * The card grid. `items-stretch` plus the child height lock is what lets a card
 * absorb its row-mate's slack — and it is why `CARD_BODY` and
 * `CONDITION_PANEL.SCREEN` exist: a stretched cell holding a content-height
 * state screen is a symmetric void.
 */
export const CARD_GRID =
  "grid grid-cols-1 items-stretch gap-5 *:h-full *:*:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/**
 * One grid cell. Each card cascades on its own 120ms step, so it needs a motion
 * wrapper — and the wrapper is what `CARD_GRID`'s height lock reaches through.
 */
export const CARD_CELL = "flex min-w-0 flex-col";

// -----------------------------------------------------------------------------
// Band A — the status band
// -----------------------------------------------------------------------------

/**
 * The band header: label left, the state chip pushed right by `mr-auto`.
 *
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears — the same reserve-don't-animate trade `DELTA` makes.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px. A `min-h-` would be a FLOOR, and a floor cannot be
 * a mirror — the tile would resolve to whatever its content needed and the
 * skeleton-to-content handoff would jump by the difference. Nothing clips at
 * the pin, because the eyebrow, value and caption all truncate.
 *
 * The skeleton wears `ROOT` itself rather than a separate mirror, so the two
 * cannot drift; `HEIGHT` is the pin alone, for anything that needs it bare.
 *
 * The grid reflows by its own minimum rather than by a breakpoint ladder, so
 * the band is correct at every sidebar state without a query.
 */
export const TILE = {
  // 15rem, not the 190px it was: at 190 the text column resolves to 107px in a
  // single-column page and the clock's own figure truncates to `PHT +08…`.
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  BODY: "bg-surface-container text-on-surface",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  /** The text column inside ROOT. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/**
 * Disc fills, and the ONLY colour on this band — every body is `TILE.BODY`.
 *
 * Each is a FILL pair, never a container pair: the disc is the one element
 * small enough to want a strong fill, and pale containers separate in 2 of 10
 * pairs under deuteranopia where fills separate in 10 of 10.
 */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  // `primary` says a facility is configured and running — never that it is
  // healthy, which is what `success` is for.
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for a disc that changes at runtime. Scoped to two named
 * properties rather than to everything, and every custom property takes
 * `var()` — the naked spelling compiles to a declaration carrying the property
 * NAME, which the browser discards, so it ships as no transition at all while
 * tsc, eslint and the build all stay green.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/**
 * The eyebrow above a tile's figure. ONE spelling.
 *
 * `uppercase` lives HERE and never in the locale leaf: casing in content does
 * not translate — it makes one pack shout while CJK silently normalises it.
 */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/**
 * The figure. `tabular-nums` in the UI face and never `font-mono`: a clock, a
 * schedule and a count are readings, not identifiers (The Machine-Voice Rule).
 *
 * `min-w-0` rather than `truncate` — this is a flex box, so the truncation has
 * to happen on the text child.
 */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";

/** The truncating text child of a `VALUE` box. */
export const VALUE_TEXT = "truncate";

/** The caption under a figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/**
 * The placeholder for a figure that has no reading. An em dash is
 * typographically identical in all five locales and needs no translator, and it
 * reads as an absence rather than as an abbreviation.
 */
export const VALUE_NONE = "—";

// -----------------------------------------------------------------------------
// The cards
// -----------------------------------------------------------------------------

/**
 * The card shell. A PEER: `rounded-card` and the whisper shadow, the only card
 * lift in the vocabulary. `border-0` is explicit — a tonal surface never also
 * carries a hairline.
 *
 * THE WHISPER IS IMPORTANT-MARKED BECAUSE `twMerge` READS AN ARBITRARY SHADOW
 * VALUE AS A COLOUR, so it cannot dedupe this against `card.tsx`'s own
 * `shadow-sm` and both survive into the class list; the winner is then
 * Tailwind's name sort, which the primitive wins.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/**
 * The content box that fills a height-locked cell. `CARD_GRID` stretches every
 * cell, so a content-height body buys its symmetry with a void underneath.
 */
export const CARD_BODY = "flex min-h-0 flex-1 flex-col";

/**
 * The card's title. `CardTitle` takes its size from the call site, so an unsized
 * one inherits 16px and flattens the type ramp. It WRAPS rather than truncating,
 * which is why `leading-tight` travels with the size.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink, so the ink is written here. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/**
 * The in-card notice: a container and its own ink, as a PAIR — a bare
 * `text-warning` is a fill role's ink with nothing under it.
 *
 * `BOX` carries no fill: the tone is the caller's, because the same box says
 * "this read is stale" in `warning` on three cards and "this write failed" in
 * `destructive` on SSH Access. Written here because the four cards had each
 * kept a private copy of `text-[0.8125rem] leading-relaxed text-pretty`, a size
 * this module already speaks.
 */
/**
 * Dim ink on a tonal fill: inherit the container's `on-` ink, then step it back.
 * A role token here would be a fill role's ink with nothing under it.
 */
export const META_INK_ON_TONAL = "opacity-90";

export const NOTICE = {
  BOX: "flex items-start gap-2.5 rounded-field px-4 py-3",
  STALE: "bg-warning-container text-on-warning-container",
  FAILED: "bg-destructive-container text-on-destructive-container",
  /** The leading glyph, nudged onto the first line's optical baseline. */
  GLYPH: "mt-0.5 size-4 flex-none",
  TEXT: "text-[0.8125rem] leading-relaxed text-pretty",
  /** A two-line notice: the sentence, then the machine text under it. */
  STACK: "flex min-w-0 flex-col gap-1",
  /** Backend text quoted inside a notice — machine voice, ink stepped back. */
  DETAIL: `font-mono text-xs leading-relaxed break-words ${META_INK_ON_TONAL}`,
} as const;

/** The timezone-apply warning, hanging under the row that caused it. */
export const TZ_NOTICE =
  "flex flex-col items-start gap-2 rounded-field px-4 pb-4";

/**
 * One tonal group holding a card's setting rows.
 *
 * The group is `surface-container`, one step above the card's `surface`, and
 * every field inside is `surface-container-high`, one step above the group.
 * That ladder is what makes a borderless field legible.
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/** A card's slack absorber: the page grid locks the cell, the group grows. */
export const GROUP_FILL = "min-h-0 flex-1";

/**
 * One setting row.
 *
 * A `min-h` FLOOR here, not a pin, and the distinction is the opposite of the
 * tile's: a tile has a skeleton mirroring it, so it must be a pin; a row's
 * consequence sentence wraps to two lines on a narrow container where a fixed
 * height would clip it.
 *
 * `TEXT` carries `flex-1` and not merely `min-w-0`. With `min-w-0` alone the
 * column shrinks to zero against a `flex-none` control and the consequence
 * wraps to one word per line — a several-hundred-pixel-tall row that only
 * appears once the control happens to be wide.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /**
   * A row whose control is a RAIL, not a field: it never flips beside its
   * label, so the rail always spans a definite width. See `DAY_PILL.RAIL` —
   * an auto-fit track list inside the `flex-none` `CONTROL` collapses to one
   * column. `ROOT` minus its four flip utilities, restated rather than
   * overridden so no `twMerge` ordering decides the layout.
   */
  RAIL_ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence. REQUIRED on a row that makes a decision — it is
   * what makes a settings row a decision rather than a field, and on this
   * surface it is the sentence that says the device you are talking to is about
   * to reboot.
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only side by side. */
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/** A row's label and its unsaved marker, paired tighter than the row's gap. */
export const LABEL_LINE = "flex items-center gap-2";

/**
 * The 42px control height, IMPORTANT-MARKED and written exactly once so the
 * field and its skeleton placeholder cannot drift.
 *
 * `select.tsx` ships a default-size `h-9` behind a data-attribute selector,
 * which Tailwind v4 compiles at (0,2,0) against a bare arbitrary height's
 * (0,1,0); `tailwind-merge` keeps both and the primitive wins. Measured on the
 * sibling surface at 36px, against a call site asking for 42.
 */
const FIELD_HEIGHT = "h-[2.625rem]!";

/**
 * The field's resting width above the row flip. `SKELETON.*.FIELD` bakes it in,
 * because `ROW.CONTROL` is `flex-none` and a bare `w-full` placeholder there
 * resolves to zero.
 */
/**
 * A control that spans its row until the card is wide enough to sit it beside the
 * label. `ROW.CONTROL` is `flex-none`, so the fill has to be asked for.
 */
export const CONTROL_FILL = "w-full @2xl/card:w-auto";

/** The receipt strip under a card's rows, and its skeleton. */
export const RECEIPT_ROW = "flex justify-end px-1";

export const FIELD_WIDTH = "@2xl/card:w-auto @2xl/card:min-w-[13.5rem]";

/**
 * The family's ONE focus ring — 3px of FULL-STRENGTH `--ring` over a 2px
 * page-coloured gap, the canon's spelling. The alpha is a measured floor, not
 * a taste call: at half strength the ring composited to 1.968:1 against its
 * worst ground, under SC 1.4.11's 3:1. The gap is what makes it visible on a
 * `bg-primary` control, where `--ring` is the same colour as the fill.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Focus ring and disabled. Rides whatever is the box. */
const FIELD_STATE = `${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`;

/**
 * The 44px coarse-pointer target, as a pseudo-element overlay rather than a
 * layout box, so the control keeps its painted size and its row keeps its
 * baseline. Same technique as `SWITCH_TARGET` in tower-locking's module.
 *
 * `Switch` paints 32x18 and the password eye toggle paints 32x32; both are
 * under the floor and neither can grow without breaking the row it rides in.
 */
export const COARSE_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/**
 * The family's ONE control shape — every select, time input and text field on
 * this surface.
 *
 * THE DARK HALF IS EXPLICIT AND IMPORTANT-MARKED. The field primitives ship
 * their own dark fill at (0,2,0), so an unprefixed call-site fill loses in dark
 * mode outright; once both rules are prefixed they TIE, and a tie is decided by
 * Tailwind's name sort, where `bg-input` precedes `bg-surface-container-high`
 * only because *i* precedes *s*. The marker makes the call site win by
 * construction instead of by alphabet.
 *
 * The fill is one step above THIS host: the field sits inside a `ROW`, inside
 * `ROW_GROUP`, which is `bg-surface-container` — so `surface-container-high` is
 * exactly host + 1 and the Field-Step Rule is satisfied by the composition.
 */
export const FIELD = `${FIELD_HEIGHT} w-full rounded-pill border-0 px-4 text-[0.84375rem] font-medium bg-surface-container-high dark:bg-surface-container-high! ${FIELD_WIDTH} ${FIELD_STATE}`;

/** The glyph riding inside a field or trigger. */
export const FIELD_GLYPH = "size-3.5";

/**
 * The day-of-week rail on Scheduled Reboot.
 *
 * FILL CARRIES SELECTION, replacing an outline toggle whose only "on" marker
 * was a tinted 8px dot. `OFF` is `surface-container-high` because the rail's
 * host is a `ROW` inside `ROW_GROUP` — the same host the fields answer to, and
 * `-high` is the top rung.
 *
 * The coarse-pointer bump is what reaches the 44px target floor.
 *
 * THE RAIL IS AN AUTO-FIT GRID, NOT A WRAPPING FLEX ROW. `flex-wrap` plus
 * `flex-1` divides the FULL width among only the pills that wrapped, so at a
 * 250px rail the week rendered as five 57px pills over two 134px ones —
 * measured on the two-up card at 820px, where Fri and Sat were 2.4x their
 * peers and the selected Fri read as the loudest control on the card. A track
 * list fixes every column at the same width in every row, so a wrap is uniform.
 * Same idiom as `TILE.GRID` one section up.
 *
 * THE TRACK LIST IS WHY THE RAIL MUST RIDE `ROW.RAIL_ROOT`. `auto-fit` needs a
 * definite available width to count repetitions against; given an indefinite
 * one it resolves to a SINGLE track, and seven pills become seven rows. The
 * `@2xl/card` flip hands `ROW.CONTROL` exactly that: `flex-none` is
 * shrink-to-fit, so the week rendered as a vertical column on every card past
 * 672px — measured at an 832px card, `grid-template-columns: 50.77px`.
 * `w-full` lives here rather than at the call site so the constant carries its
 * own definiteness.
 */
const DAY_PILL_HEIGHT = "h-9 pointer-coarse:h-11";

export const DAY_PILL = {
  RAIL: "grid w-full items-center gap-1.5 grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))]",
  HEIGHT: DAY_PILL_HEIGHT,
  ROOT: `${DAY_PILL_HEIGHT} min-w-0 rounded-pill px-3 text-[0.8125rem] font-semibold transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]`,
  ON: "bg-primary text-primary-foreground",
  OFF: "bg-surface-container-high text-on-surface-variant",
} as const;

/**
 * The unsaved marker beside a row's label.
 *
 * It RESERVES its box: a clean row still renders the marker under `CLEAN`, so
 * promoting a row from clean to dirty moves nothing on the page. `invisible`
 * rather than an opacity, because an invisible element also leaves the
 * accessibility tree — a screen reader should not announce "Unsaved" on a row
 * that is saved.
 */
export const DELTA = {
  ROOT: "text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-primary",
  CLEAN: "invisible",
} as const;

/**
 * One layer of the autosave receipt. The three share a grid cell, so the strip
 * is max(idle, saving, saved) wide per locale and a save reflows nothing.
 */
export const SAVE_LAYER =
  "col-start-1 row-start-1 flex items-center justify-end gap-1.5 text-on-surface-variant text-xs font-medium transition-opacity duration-[var(--duration-quick)] ease-out";

/**
 * One row in Tracked SIMs.
 *
 * `ACTIVE` is Highlight-by-Container: the active SIM's row becomes a
 * `primary-container` with its own ink. It replaces a hairline over an alpha
 * wash, which was both a stroke on a fill and a request to whatever happened to
 * be behind it rather than to the token.
 *
 * A resting row has NO fill — it sits on `ROW_GROUP` — so promotion is the only
 * colour on the list.
 */
/**
 * A status chip riding a PROMOTED row. `Badge variant="info"` resolves to
 * `bg-primary-container` — byte-identical to `SIM_ROW.ACTIVE` — so a stock chip
 * dissolves into the row it sits on. Re-grounded on the row's own ink at the
 * alpha that measures 1.41:1 fill-vs-ground, matching how that chip reads on a
 * plain card (1.39:1). Same technique as `CONDITION_TONE.action`.
 */
export const CHIP_ON_TONAL = "bg-on-primary-container/20";

/**
 * The registry list's own box. The scroll cap stops a long registry from
 * stretching this card's row-mate in a symmetric grid row; short lists never
 * reach it. It lives here rather than at the call site because it is geometry,
 * and this module is where the family's geometry is.
 */
export const SIM_LIST = "max-h-96 min-h-0 flex-1 overflow-y-auto";

export const SIM_ROW = {
  ROOT: "flex min-h-[4.5rem] flex-col gap-1.5 rounded-field px-4 py-3.5 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4",
  ACTIVE: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  /** ICCID and MSISDN: identifiers the device emits verbatim, so mono. */
  ID: "truncate font-mono text-[0.8125rem] tabular-nums",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/**
 * What lets a `ConditionScreen` fill a height-locked card: `SCREEN` on the
 * screen's own `className`, alongside `CARD_BODY` on the `CardContent`.
 * `min-h-0` is what lets the flex child absorb rather than overflow.
 */
export const CONDITION_PANEL = {
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

/**
 * The state block's GEOMETRY. Restated here rather than imported from
 * `components/cellular/condition-screen.tsx`, which renders a Material glyph —
 * and `/system-settings` is a lucide route (the Icon-Boundary Rule).
 *
 * Geometry only: the colour comes from that module's exported `CONDITION_TONE`,
 * keyed onto `ConditionTone`, so a tone without a role fails the build.
 */
export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3.5 rounded-hero px-8 py-10 text-center",
  DISC: "grid size-14 flex-none place-items-center rounded-pill",
  /** The lucide glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  TITLE: "text-xl font-semibold tracking-[-0.01em]",
  /** Title and body pair tighter than the block's own gap. */
  TEXT: "flex flex-col gap-1.5",
  /**
   * No ink wash. An alpha on an `on-*-container` ink softens a token that is
   * already measured against the container it sits on. The ink is the ink.
   */
  BODY: "max-w-[44ch] text-sm leading-relaxed text-pretty",
  /** The retry affordance's geometry; its fill is the tone's `action`. */
  ACTION: "mt-2 h-[2.625rem] gap-2 rounded-pill px-6 text-sm font-semibold",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Line boxes — a rendered line's HEIGHT, never its font size. A line of
 * 15px/normal occupies 22px, and 22px is what stands in for it.
 */
const LINE = {
  /** `CARD_TITLE` (18px/tight) and `ROW.LABEL` (15px/normal) both land here. */
  LABEL: "h-[1.375rem] rounded-inline",
  /** `ROW.CONSEQUENCE` at 12.5px/relaxed. */
  CONSEQUENCE: "h-[1.25rem] rounded-inline",
  /** `EYEBROW` at 11px. */
  EYEBROW: "h-[1.0625rem] rounded-inline",
  /** `VALUE` at 22px with 1.1 leading. */
  VALUE: "h-[1.5rem] rounded-inline",
  /** `CAPTION` at 12px. */
  CAPTION: "h-[1.125rem] rounded-inline",
} as const;

/**
 * Every placeholder reads its geometry from the loaded view's own constant, so
 * a height can never drift out from under its skeleton.
 *
 * A row skeleton wears the real `ROW_GROUP` and `ROW.ROOT` at the call site and
 * fills them with these slivers, so its height RESOLVES to the real row's
 * instead of being asserted against a floor. The band does the same with
 * `TILE.ROOT`, which is why there is no separate box mirror here.
 *
 * RESOLVING ONLY WORKS IF THE PLACEHOLDER'S LINE COUNT MATCHES THE CONTENT'S.
 * A one-line stand-in for a consequence that wraps to two under-states the row
 * by ~21px, and a missing action row under-states the card by its full height
 * plus the gap. Both are why `CONSEQUENCE_2` and the action slivers exist.
 *
 * SSH Access has no GET, so it has no skeleton.
 */
export const SKELETON = {
  /** The status band: three tiles, worn inside the real `TILE.ROOT`. */
  TILE: {
    DISC: "size-[3.25rem] flex-none rounded-pill",
    EYEBROW: LINE.EYEBROW,
    VALUE: LINE.VALUE,
    CAPTION: LINE.CAPTION,
  },
  /** Time & Units: three rows, each a label, a consequence and a field. */
  TIME: {
    LABEL: LINE.LABEL,
    CONSEQUENCE: LINE.CONSEQUENCE,
    /** The second line the timezone consequence wraps to at real widths. */
    CONSEQUENCE_2: LINE.CONSEQUENCE,
    FIELD: `${FIELD_HEIGHT} w-full rounded-pill ${FIELD_WIDTH}`,
    /** The Save row. Absent from the skeleton, the card jumps by 42px + gap. */
    ACTION: `${FIELD_HEIGHT} w-36 rounded-pill`,
  },
  /** Scheduled Reboot: three rows, plus the seven-pill day rail. */
  REBOOT: {
    LABEL: LINE.LABEL,
    CONSEQUENCE: LINE.CONSEQUENCE,
    /** Row 1's consequence wraps to two lines at real card widths. */
    CONSEQUENCE_2: LINE.CONSEQUENCE,
    /** The `Switch` in row 1's control box — 24px tall, not a field. */
    SWITCH: "h-6 w-10 rounded-pill",
    /** The autosave receipt strip: a 16px line, shorter than a consequence. */
    RECEIPT: "h-4 w-32 rounded-inline",
    FIELD: `${FIELD_HEIGHT} w-full rounded-pill ${FIELD_WIDTH}`,
    /** Wears a `DAY_PILL.RAIL` cell, so it tracks the grid, not a flex basis. */
    DAY: `${DAY_PILL_HEIGHT} min-w-0 rounded-pill`,
  },
  /** Tracked SIMs: a list wearing `SIM_ROW.ROOT`. */
  SIMS: {
    LABEL: LINE.LABEL,
    ID: LINE.CONSEQUENCE,
    CHIP: "h-[1.375rem] w-20 rounded-pill",
  },
} as const;

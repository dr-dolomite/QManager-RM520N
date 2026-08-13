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
export const SEGMENTED_BREAKPOINT = {
  GROUP: "hidden @2xl/card:flex",
  SELECT: "flex w-full @2xl/card:hidden",
} as const;

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
  /** Human-authored labels never take mono (The Machine-Voice Rule). */
  VALUE_TEXT: "text-[0.8125rem] font-semibold truncate",
  /** Mirrors ROOT's resolved height for the skeleton. */
  HEIGHT: "h-[2.5625rem]",
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
  TITLE: "text-sm font-semibold",
  /** The bearer/DNN name. Machine string. */
  APN: "font-mono text-[0.84375rem] font-medium truncate",
  ROW: "flex items-center gap-3.5",
  RATES: "ml-auto flex flex-none gap-2",
  HEIGHT: "h-[6.5rem]",
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
 * chip — but the two hues carrying that direction are `primary` (download)
 * and `lte` (upload), not `primary` and `uplink`.
 *
 * WHY `lte` (VIOLET) AND NOT `uplink` (CYAN). A first pass reused Uplink Cyan
 * here because DESIGN.md names it as the hue that owns "the upload leg of
 * any paired readout," and `device-metrics.tsx` does exactly that. But this
 * card lives beside — and inside — the LTE/5G identity blocks, which are
 * themselves blue and violet; a cyan third accent read as an outlier next to
 * that pair rather than as part of the same family, and read especially
 * discordant sitting inside the violet LTE block. `speedtest-dialog.tsx`
 * already settled the same question the other way: its three-way
 * ping/download/upload contract assigns `upload -> lte`, `ping -> uplink`,
 * precisely because a third measurement needed a third hue and violet fit the
 * pair better than cyan did. This card only has two directions, so it takes
 * that same `primary`/`lte` pair rather than reaching for cyan — one blue
 * shade, one violet shade, both already load-bearing hues in this product's
 * palette instead of a new accent introduced for this one card. (Cyan is not
 * wrong on `device-metrics.tsx` — a lone tile on a neutral dashboard card
 * has no adjacent purple to clash with. It just doesn't fit a card whose own
 * container fill is the LTE violet.)
 *
 * The arrow glyph stays as the direction's SECOND channel (never the only
 * one — PRODUCT.md requires a paired readout to survive colour-blindness),
 * so the pairing degrades gracefully rather than depending on hue alone even
 * where it lands inside the LTE block and one chip shares its family.
 *
 * ON THE FILL CHOICE. An earlier draft wrote `bg-lte/25` and `bg-primary/25`.
 * Both are alpha washes and both are wrong for the same reason as
 * `SEGMENTED.TRACK_ON_FILL` above. The correct move for a chip that must lift
 * off a CONTAINER is the role's own FILL pair — `bg-primary` carries
 * `text-primary-foreground`, `bg-lte` carries `text-lte-foreground`. That is
 * a real pair in both themes, where an alpha is a different perceived
 * lightness in each. Note the pairs are declared here, so consumers must NOT
 * also set an ink class on the chip.
 */
export const RATE_CHIP = {
  ROOT: "inline-flex h-[1.875rem] items-center gap-1.5 rounded-pill px-3 font-mono text-[0.8125rem] font-semibold tabular-nums",
  ON_DOWNLOAD: "bg-primary text-primary-foreground",
  ON_UPLOAD: "bg-lte text-lte-foreground",
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

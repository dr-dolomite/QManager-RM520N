// =============================================================================
// Ethernet Status — shared geometry and tone contract
// =============================================================================
// The `/local-network/ethernet` family's FIRST shapes module, and the reason it
// exists is finding 10 of the approved proposal: one caption role was spelled
// three ways (`CAPTION`, `CAPTION_CLASS`, plus a third literal at the call
// sites) because there was nowhere for it to live. Every consumer imports from
// here, INCLUDING the skeletons — a skeleton that restates a number has left
// the contract (The Skeleton-Mirror Rule).
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box, and this
// file deliberately does NOT import it. `/local-network/` is a separate route
// family and must not reach into `components/cellular/`; the sibling families
// under `/cellular/settings/` restate their geometry from each other for the
// same reason. What is shared is the SYSTEM's numbers, not a module.
//
// The values below are the system's, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// The retired module got two of those wrong. It carried `min-h-[5.75rem]` on
// the tile root and `h-[5.75rem]` on the skeleton — the pre-correction 92px
// number, which is both the wrong MECHANISM (a floor cannot be a mirror; only a
// pin can) and 12px shorter than every other strip in the product.
//
// -----------------------------------------------------------------------------
// THE TONE RULE ON THIS SURFACE
// -----------------------------------------------------------------------------
// Every tile body is `TILE.BODY`, and there is no `tone` prop to override it.
// The disc is the only coloured element, and only ONE disc changes tone at
// runtime — the link tile's, because the link is the only thing here with a
// functional state.
//
// Three of the four bodies used to be large tinted containers
// (`success-container`, `downlink-container`, `primary-container`), which is
// the composition `radio/summary-tiles.tsx` reached through five generations
// and deleted at Gen 5: its Gen 2 note measured that shape at 623x212 =
// 132,033px^2 carrying 7.2% ink and called it "a large empty purple slab". The
// four `opacity-85` ink washes went with the tints — they existed only to soften
// an `on-*-container` ink that no longer has a container to sit on, and once the
// body is neutral they resolve to a real `on-surface-variant`.
//
// The rate tile is the one worth naming. Its retired comment justified
// `downlink-container` as "Downlink Rose's second meaning", a rule DESIGN.md
// retired on 2026-08-16 ("the previous system gave rose a second meaning ('and
// capacity')... which made the axis untrue"). A negotiated Ethernet link rate is
// bidirectional and has no honest hue, so it is neutral — The Neutral-Default
// Rule, and the whole point of the system is that a plain-looking block is not
// a reason to mint a meaning for an existing colour.
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING FROM THE APPROVED COMP
// -----------------------------------------------------------------------------
// The comp is drawn in raw pixels; this surface ships the role scale, mapped by
// SHAPE ROLE rather than by nearest number:
//
//   comp 36px  card shell   -> `rounded-card` (36px)  — a PEER card, not a hero
//   comp 28px  tile, group  -> `rounded-tile` (28px)
//   comp 20px  row          -> `rounded-field` (20px)
//   comp 999px chips, discs -> `rounded-pill`
//
// `rounded-hero` is "the ONE card that anchors a surface". Both cards on this
// page wore it, alongside a `shadow-sm` that is outside the shadow vocabulary
// entirely. The anchor here is the strip; the cards are peers.
// =============================================================================

// -----------------------------------------------------------------------------
// Band A — the live link strip
// -----------------------------------------------------------------------------

/**
 * The band header: label left, the unresponsive chip pushed right by `mr-auto`.
 *
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears — the same reserve-don't-animate trade `SETTING_ROW` makes for
 * its delta chip.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  /** "Link state" — the thing the chip is a property OF. */
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px rather than floored. Measured on the sibling strip
 * before that correction: a two-leg tile resolved to 118px, a single-carrier one
 * to 98, a degraded one to 95 — all against a skeleton mirroring a 92px floor,
 * a 26px jump at the handoff. Nothing clips at the pin, because the eyebrow,
 * value and caption all truncate.
 *
 * `BODY` is the ONLY body fill, with no `tone` prop anywhere to override it.
 * Making the wrong thing unreachable is cheaper than a comment asking nobody to
 * do it.
 */
export const TILE = {
  /** Grid wrapper. Container queries, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  BODY: "bg-surface-container text-on-surface",
  /** The text column inside ROOT. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  /** The lucide glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
} as const;

/**
 * Disc fills, and the ONLY colour on this strip.
 *
 * Each is a FILL pair (`bg-X` + `text-X-foreground`), never a container pair —
 * the disc is the one element small enough to want a strong fill, and the pair
 * is never crossed (The Three-Layer Rule). This is also the layer that survives
 * simulation: pale identity containers separate in 2 of 10 pairs under
 * deuteranopia, fills in 10 of 10.
 *
 * Only the LINK tile picks between these at runtime. Rate, duplex and
 * negotiation are always `DISC_NEUTRAL`: none of the three is a functional
 * state, and a colour that never changes encodes nothing.
 */
export const DISC_UP = "bg-success text-success-foreground";
export const DISC_DOWN = "bg-destructive text-destructive-foreground";
export const DISC_NEUTRAL = "bg-surface-container-high text-on-surface-variant";

/**
 * The tone transition for the ONE disc that changes at runtime.
 *
 * Scoped to two properties, never `transition-all`, and every arbitrary custom
 * property takes `var()`. That last part is load-bearing rather than stylistic.
 *
 * Tailwind v4 dropped the BARE-VAR arbitrary shorthand — writing the custom
 * property inside the brackets without wrapping it in `var()`. That spelling
 * compiles to a declaration whose value is the property NAME rather than its
 * value. That declaration parses, so nothing warns, and the browser discards it, so it ships as no
 * transition at all rather than as an off-scale one. The class is still
 * generated, so grepping the class name finds it and tsc / eslint / next build
 * all pass; only the emitted value tells. The two sites this file replaces were
 * the last two such spellings in the tree.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/** The eyebrow above a tile's figure. ONE spelling — see the header note. */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]";

/**
 * The figure.
 *
 * `tabular-nums` in the UI face and NEVER `font-mono`. Every value on this strip
 * is a live measurement or a category — a negotiated rate, a duplex mode, an
 * autonegotiation state — and none of them is an identifier the device emits
 * verbatim, which is the only thing the Machine-Voice Rule sends to mono.
 *
 * `min-w-0` rather than `truncate`: this is a flex box, so the truncation has to
 * happen on the text child (`VALUE_TEXT`).
 */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";

/** The truncating text child of a `VALUE` box. */
export const VALUE_TEXT = "truncate";

/** The caption under a figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/**
 * The placeholder for a figure that has no reading.
 *
 * A rate and a duplex mode mean nothing while the link is down, and the tile
 * says so in its caption ("Needs an active link"). The old copy printed the
 * string "N/A" through a translated key in each tile; an em dash is
 * typographically identical in all five locales, needs no translator, and reads
 * as an absence rather than as an abbreviation. Same constant the APN and
 * alignment surfaces already use.
 */
export const VALUE_NONE = "—";

/**
 * A FAILED read, or a device with no controller. The band keeps the family box
 * and goes neutral rather than shimmering: a skeleton is a promise that data is
 * on its way, and holding one over a dead poll is the misstatement this
 * re-authoring exists to remove.
 *
 * It SPANS the grid. Four identical "couldn't read" tiles would be one message
 * repeated four times, and a bespoke centred error card — which is what this
 * replaces — is a second vocabulary for the same event.
 */
export const NOTICE_SPAN = "@xl/main:col-span-2 @5xl/main:col-span-4";
export const NOTICE_TITLE = "truncate text-lg font-semibold";

// -----------------------------------------------------------------------------
// Band B — the write card
// -----------------------------------------------------------------------------

/**
 * The card. A PEER, not the anchor: `rounded-card` (36px) and the whisper
 * shadow, which is the only card lift in the vocabulary and is never
 * load-bearing. `border-0` is explicit — a tonal surface never also carries a
 * hairline (The No-Hairline-On-Fill Rule).
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx:10` ships
 * `shadow-sm`, and `cn()` does NOT dedupe it against this one: `tailwind-merge`
 * cannot tell whether an arbitrary `shadow-` value is a box-shadow or a shadow
 * COLOUR, so an unresolvable `var()` lands in the colour group and both classes survive
 * the merge. Tailwind then compiles both to `--tw-shadow` and the winner is
 * emission order, which is its deterministic name sort — `shadow-[` sorts
 * before `shadow-s`, so the primitive's default is emitted LAST and wins.
 *
 * Measured, not reasoned: `getComputedStyle(card).boxShadow` returned Tailwind's
 * two-layer `rgba(0,0,0,.1) 0 1px 3px, rgba(0,0,0,.1) 0 1px 2px -1px` — i.e.
 * `shadow-sm` — against a call site asking for the whisper. Same family as the
 * `twMerge` custom-radius trap `lib/utils.ts` documents, and the same shape as
 * the `dark:` fill collision below: a tie the tooling cannot see, decided by
 * spelling. The marker makes it win by construction.
 *
 * The product-wide fix is teaching `cn()` that an arbitrary shadow value is a
 * box-shadow — which would also flip every `/cellular/settings` card, currently
 * on `shadow-sm` for this exact reason. That is a sweep, deliberately not done
 * here.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/**
 * The card's title. `CardTitle` ships only `leading-none font-semibold` and
 * takes its size from the call site, so an unsized one inherits 16px and
 * flattens the surface's type ramp. It WRAPS rather than truncating — a card
 * title that silently loses its last word is worse than a two-line one — which
 * is why `leading-none` has to go with it.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** One tonal group holding the card's setting rows. */
export const ROW_GROUP = "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row.
 *
 * A `min-h` FLOOR here, not a pin, and the distinction is the opposite of the
 * tile's: a tile has a skeleton mirroring it, so it must be a pin; a row has
 * none, and its consequence sentence wraps to two lines on a narrow container
 * where a fixed height would clip it.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /**
   * The label + consequence column.
   *
   * `flex-1` is load-bearing rather than cosmetic. With `min-w-0` alone this
   * column shrinks to zero against a `flex-none` control and the consequence
   * wraps to one word per line — a ~500px tall row that only appears once the
   * control happens to be wide, so the layout looks fine right up until it does
   * not.
   */
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence. REQUIRED on every row, not optional — it is what
   * makes a settings row a decision rather than a field, and on this surface it
   * is the sentence that says the link will drop and that you are on it
   * (Product Principle 6: make the dangerous obvious).
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/**
 * The speed-limit Select's trigger.
 *
 * -----------------------------------------------------------------------------
 * THE FILL IS ONE STEP ABOVE **THIS** HOST, WHICH IS NOT THE HOST IT WAS COPIED
 * FROM
 * -----------------------------------------------------------------------------
 * The retired constant was a byte-copy of `cellular/settings/shapes.ts`'s
 * `SELECT_TRIGGER`, which is authored for a `surface-container` host. There the
 * control sat directly on `bg-surface` inside `CardContent`, so it painted two
 * steps above its host and read as a floating chip rather than as a field.
 *
 * Here the control lives inside a `ROW`, inside `ROW_GROUP`, which is
 * `bg-surface-container` — so `surface-container-high` is exactly host + 1, and
 * the Field-Step Rule is satisfied by the composition rather than in spite of
 * it. The fill IS the whole affordance on a borderless field; get the step
 * wrong and the control renders at 1.00:1 against its own background, with no
 * edge at all.
 *
 * -----------------------------------------------------------------------------
 * THE DARK HALF IS EXPLICIT, AND IMPORTANT-MARKED
 * -----------------------------------------------------------------------------
 * `select.tsx` ships its own `dark:bg-input/30`. Tailwind v4 compiles `dark` to
 * `&:is(.dark *)` — specificity (0,2,0) against a bare call-site fill's (0,1,0)
 * — so a light-only override simply LOSES in dark mode, and `tailwind-merge`
 * cannot dedupe the two because they sit in different modifier groups. It then
 * looks approximately right in dark mode, which is exactly why it survives
 * review.
 *
 * Writing the `dark:` half is necessary and not sufficient. Once both rules are
 * `dark:`-prefixed they TIE at (0,2,0), and a tie is decided by emission order —
 * Tailwind's deterministic candidate sort, i.e. by name. `bg-input…` sorts
 * before `bg-surface-…` only because *i* precedes *s*. That is an observed
 * outcome, not a constructed one, so the dark half carries the important
 * modifier and wins by construction instead of by alphabet.
 *
 * The primitives' `rounded-md` / `h-9` / `dark:bg-input/30` remain an OPEN
 * product-wide Migration Delta. This fixes them at this one call site and does
 * not sweep them.
 */
/**
 * The 42px pill box and the type it speaks in. Module-private — the API is `FIELD`.
 *
 * THE HEIGHT IS IMPORTANT-MARKED FOR THE SAME REASON THE DARK FILL IS, on a
 * different axis. `select.tsx:40` ends with `data-[size=default]:h-9`, and
 * Tailwind v4 compiles that attribute modifier to specificity **(0,2,0)** against
 * a bare `h-[2.625rem]`'s **(0,1,0)**. `tailwind-merge` keeps both — they sit in
 * different modifier groups — and the primitive simply wins.
 *
 * Measured, not reasoned: `getBoundingClientRect().height` on the rendered
 * trigger returned **36**, against a call site asking for 42. It looks
 * approximately right, which is exactly why it survives review — the same
 * sentence `cellular/settings/shapes.ts` writes about the fill.
 *
 * `select.tsx`'s `rounded-md` / `h-9` / `dark:bg-input/30` are an OPEN
 * product-wide Migration Delta. This corrects them at this one call site and
 * does not sweep them; migrating the primitive retires the marker with it.
 */
const FIELD_BOX =
  "h-[2.625rem]! w-full rounded-pill border-0 px-4 text-[0.84375rem] font-medium @2xl/card:w-auto @2xl/card:min-w-[13.5rem]";

/** Focus ring and disabled. Rides whatever is the box. */
const FIELD_STATE =
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD = `${FIELD_BOX} bg-surface-container-high dark:bg-surface-container-high! ${FIELD_STATE}`;

/** The glyph riding inside the trigger during the applying / saved flash. */
export const FIELD_GLYPH = "size-3.5";

/**
 * The provenance line under the card.
 *
 * It names the file the value is read back FROM, which is the one thing a
 * settings card cannot otherwise tell you: the Select shows what you asked for,
 * and this says where the answer comes from.
 *
 * This constant is the LINE's ink and size only. The path's `font-mono` is
 * written at the call site, beside the literal path — the machine voice belongs
 * to that one string, and hoisting a single voice token into a shared module
 * would separate it from the only thing it is ever true of.
 */
export const PROVENANCE = "text-on-surface-variant px-1 text-xs";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/** The page-header action pill. Restated per family, never imported across one. */
export const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

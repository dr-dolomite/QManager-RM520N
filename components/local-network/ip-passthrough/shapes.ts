// =============================================================================
// IP Passthrough — shared geometry and tone contract
// =============================================================================
// The `/local-network/ip-passthrough` family's first shapes module, and the
// THIRD under `/local-network/` — `ethernet/shapes.ts` (2511953) and
// `traffic-engine/shapes.ts` (0fdfc65) landed first, so the convention here is
// inherited rather than invented.
//
// What this module prevents, on this route specifically: the retired card
// restated its own page grid, its own header type, five bare `SelectTrigger`s
// and a nine-`Skeleton` loading state that mirrored nothing. Not one number in
// it was the system's.
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box, and the two
// sibling `/local-network/` modules hold it again. This file deliberately
// imports none of them. `/local-network/` must not reach into
// `components/cellular/`, and a sibling family's module is not a shared library
// — what is shared is the SYSTEM's numbers, not a module. The values below are
// those numbers, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// -----------------------------------------------------------------------------
// THE BAND ON THIS PAGE REPORTS CONFIGURATION, NOT A MEASUREMENT
// -----------------------------------------------------------------------------
// This is the one place this family departs from its two siblings, and it is a
// COPY rule rather than a geometry rule, recorded here because it is the thing
// most likely to be quietly broken by a later edit.
//
// `ip_passthrough.sh` (GET) reads `/etc/qmanager/ippt_config.json` first — a
// file written by our own POST — and falls back to poller fields
// (`device.ippt_*`) captured once at boot. No AT command is issued on GET. So
// Band A reports WHAT QMANAGER LAST APPLIED, not what the modem is doing right
// now, and every string on it is written in the language of configuration:
// "Set to…", "Pinned by…", "Saved as…". Never "currently", "live", "on the
// wire", "verified". The band's own label is "Last applied" for the same
// reason. A band that reads as a measurement while sourcing a config file is
// the State-Honesty Rule broken in the one direction a user cannot detect.
//
// -----------------------------------------------------------------------------
// COLOUR: NEUTRAL BODIES, AND ONLY THE MODE DISC MOVES
// -----------------------------------------------------------------------------
// Every tile body is `TILE.BODY` and there is no `tone` prop to override it.
// Colour lives on the 52px disc, and only the MODE disc picks a tone at
// runtime, because passthrough-vs-router is the only thing on this strip with a
// functional state. NAT and DNS proxy are saved settings, and the target MAC is
// an identifier; none of the three has a healthy or degraded reading to report,
// so all three take `DISC_TONE.neutral` under The Neutral-Default Rule. A
// colour that never changes encodes nothing.
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING
// -----------------------------------------------------------------------------
// The role scale, mapped by SHAPE ROLE rather than by nearest number:
//
//   36px  card shell    -> `rounded-card` — a PEER card; the band is the anchor
//   28px  tile, group   -> `rounded-tile`
//   20px  row           -> `rounded-field`
//   999px chips, fields -> `rounded-pill`
//
// `rounded-hero` is "the ONE card that anchors a surface". The anchor here is
// Band A, so the single write card is a peer.
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page header.
 *
 * The retired shell wrote `text-3xl font-bold mb-2`, which is missing the
 * `tracking-[-0.02em]` the Display step specifies, so the title rendered
 * fractionally wider than every migrated surface. The spacing moves to the flex
 * `gap` rather than a trailing margin, so the header composes instead of
 * pushing.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/**
 * The 42px action pill — the header's Refresh, the card's Apply and Discard.
 *
 * Restated per family, never imported across one; the two sibling modules carry
 * the identical string for the identical reason.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

// -----------------------------------------------------------------------------
// Band A — what was last applied
// -----------------------------------------------------------------------------

/**
 * The band header: label left, the state chip pushed right by `mr-auto`.
 *
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears on the first successful read — the same reserve-don't-animate
 * trade `DELTA` makes for its delta chip.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  /** "Last applied" — see the header note on why it is not "In force". */
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px rather than floored, and `HEIGHT` is what the
 * skeleton imports so it mirrors the pin BY REFERENCE rather than by a restated
 * number (The Skeleton-Mirror Rule). A floor cannot be a mirror: the tile
 * resolves to whatever its content needs and the skeleton→content handoff jumps
 * by the difference. Nothing clips at the pin, because the eyebrow, value and
 * caption all truncate.
 *
 * `BODY` is the ONLY body fill and there is no `tone` prop anywhere to override
 * it. Making the wrong thing unreachable is cheaper than a comment asking
 * nobody to do it.
 */
export const TILE = {
  /** Container queries, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  BODY: "bg-surface-container text-on-surface",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The lucide glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /**
   * The figure. `tabular-nums` in the UI face; the ONE value on this band that
   * takes `font-mono` is the target MAC, and that voice is written at its call
   * site beside the only string it is ever true of (The Machine-Voice Rule).
   */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  VALUE_TEXT: "truncate",
  /** The MAC's machine voice, and a step down so 17 characters still fit. */
  VALUE_MONO: "truncate font-mono text-[1.0625rem] tracking-[-0.01em]",
  CAPTION: "text-on-surface-variant truncate text-xs",
  /** A figure with no reading. An em dash reads as an absence in all five locales. */
  NONE: "—",
} as const;

/**
 * Disc fills, and the ONLY colour on this band.
 *
 * Each is a FILL pair (`bg-X` + `text-X-foreground`), never a container pair —
 * the disc is the one element small enough to want a strong fill, and the pair
 * is never crossed (The Three-Layer Rule). This is also the layer that survives
 * simulation: pale identity containers separate in 2 of 10 pairs under
 * deuteranopia, fills in 10 of 10.
 *
 * Keyed by TONE rather than by mode, so the map does not have to be rewritten
 * when a fourth passthrough mode appears.
 */
export const DISC_TONE = {
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  neutral: "bg-surface-container-high text-on-surface-variant",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for the ONE disc that changes at runtime.
 *
 * Scoped to two properties, never `transition-all` — a bare `transition-all`
 * silently inherits Tailwind's 150ms, which is off the scale and will not
 * retune with it. Every arbitrary custom property takes `var()`: Tailwind v4
 * dropped the bare-var bracket shorthand — the custom property written
 * directly in the brackets with no `var()` wrapper — and that spelling
 * now compiles to a declaration whose value is the property NAME rather than
 * its value — invalid CSS, which the browser discards, so it ships as NO
 * transition rather than an off-scale one. The class is still generated, so
 * grepping the class name finds it and tsc / eslint / next build all pass; only
 * the emitted value tells.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/**
 * The band's failure state: ONE tile spanning the grid, never four shimmering
 * ones.
 *
 * Four identical "couldn't read" tiles would be one message repeated four
 * times, and a skeleton is a promise that data is on its way — holding one over
 * a dead poll is the misstatement this re-authoring exists to remove. The band
 * keeps the family box and goes neutral, and it carries the retry, because a
 * failed read with no way out is a permanent shimmer.
 */
export const NOTICE_SPAN = "@xl/main:col-span-2 @5xl/main:col-span-4";
export const NOTICE_TITLE = "truncate text-lg font-semibold";
export const NOTICE_ACTION =
  "h-9 flex-none gap-2 rounded-pill px-4 text-[0.8125rem] font-semibold";

/**
 * Status-chip tones for the band header, keyed onto the exported `BadgeVariant`
 * type rather than onto a class string.
 *
 * That is the whole point of the annotation: a new band state without a
 * matching role fails the BUILD, where a `Record<string, string>` would render
 * an untinted chip and ship. `muted` is the correct role for Router mode — it
 * is a deliberate choice, not a failure — and `info` resolves to the brand ramp
 * per The Info-Is-Brand Rule.
 *
 * The two states take DIFFERENT glyphs at the call site, and must keep doing
 * so: `success-container` and `warning-container` measure 1.03:1 apart and are
 * identical under deuteranopia, so on a chip the glyph is the channel that
 * actually carries the state.
 */
export type IpptBandState = "router" | "passthrough";

export const STATE_BADGE: Record<IpptBandState, BadgeVariant> = {
  router: "muted",
  passthrough: "info",
};

// -----------------------------------------------------------------------------
// Band B — the write card
// -----------------------------------------------------------------------------

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

/**
 * The card. A PEER, not the anchor: `rounded-card` (36px) and the whisper
 * shadow, which is the only card lift in the vocabulary and is never
 * load-bearing. `border-0` is explicit — a tonal surface never also carries a
 * hairline (The No-Hairline-On-Fill Rule).
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx` ships
 * `shadow-sm`, and `cn()` does NOT dedupe it against this one: `tailwind-merge`
 * cannot tell whether an arbitrary `shadow-` value is a box-shadow or a shadow
 * COLOUR, so an unresolvable `var()` lands in the colour group and both classes
 * survive the merge. Tailwind then compiles both to `--tw-shadow` and the
 * winner is emission order, which is its deterministic name sort — `shadow-[`
 * sorts before `shadow-s`, so the primitive's default is emitted LAST and wins.
 * Measured on the sibling surface as Tailwind's two-layer `shadow-sm` against a
 * call site asking for the whisper. The marker makes it win by construction.
 */
export const CARD_SHELL = "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** One tonal group holding the card's setting rows. Host + 1 above the card. */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row.
 *
 * A `min-h` FLOOR here, not a pin, and the distinction is the opposite of the
 * tile's: a tile has a skeleton mirroring it, so it must be a pin; a row's
 * consequence sentence wraps to two or three lines on a narrow container, where
 * a fixed height would clip it. `HEIGHT` is the floor's resolved value and is
 * what the card's skeleton mirrors — the skeleton is a stack of five boxes at
 * the row's own resting height, not a guess.
 */
export const ROW = {
  ROOT: "flex min-h-[5.5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** Mirrors ROOT's resolved floor, for the skeleton. */
  HEIGHT: "h-[5.5rem]",
  /**
   * A row whose control cannot currently do anything — the target-device row
   * while the mode is Disabled. Dimmed rather than hidden: a row that vanishes
   * takes its consequence sentence with it, and the sentence is the thing that
   * says why it is unavailable.
   */
  DIMMED: "opacity-55",
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
  /** The label's own line, carrying the delta chip beside it. */
  LABEL_ROW: "flex min-h-[1.375rem] min-w-0 items-center gap-2",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence. REQUIRED on every row, not optional — it is what
   * makes a settings row a decision rather than a field. On this surface it is
   * also where the riskiest sentence in the product now lives: applying a
   * passthrough mode stops the modem answering at its LAN gateway, and the app
   * the user is reading runs ON that modem. That sentence used to be visible
   * only inside the confirm dialog, i.e. after Apply had been pressed (Product
   * Principle 6: make the dangerous obvious, before the decision).
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex w-full flex-none flex-col gap-2 @2xl/card:ml-auto @2xl/card:w-auto",
  /** The inline validation message under a field that will not be accepted. */
  ERROR: "text-destructive text-[0.75rem] leading-snug",
} as const;

/**
 * The "before → after" chip, and the line it rides.
 *
 * THE LINE IS RESERVED. `CLEAN` keeps the element mounted and drops it to
 * `invisible`, so promoting a row moves NOTHING — no reflow of the group, no
 * jump of the five rows below it. `LABEL_ROW`'s own `min-h` matches the chip's
 * height for the same reason.
 *
 * Machine voice: the chip's two halves are literal setting values the device
 * round-trips, so `font-mono` is correct here and nowhere else in the row.
 * `flex-none` so the chip is never the thing that shrinks — a half-width
 * "Disabled → Ether…" states the wrong pending value.
 */
export const DELTA = {
  CHIP: "inline-flex h-[1.375rem] w-fit flex-none items-center gap-1 rounded-pill bg-primary px-2.5 font-mono text-[0.6875rem] font-semibold text-primary-foreground",
  CLEAN: "invisible",
} as const;

/**
 * The 42px pill box and the type it speaks in. Module-private — the API is
 * `FIELD`.
 *
 * -----------------------------------------------------------------------------
 * THE HEIGHT IS IMPORTANT-MARKED, AND WITHOUT IT ALL FIVE SELECTS RENDER 36px
 * -----------------------------------------------------------------------------
 * `select.tsx:40` ends with `data-[size=default]:h-9`, and Tailwind v4 compiles
 * that attribute modifier to specificity **(0,2,0)** against a bare
 * `h-[2.625rem]`'s **(0,1,0)**. `tailwind-merge` keeps both — they sit in
 * different modifier groups — and the primitive simply wins. Measured on the
 * sibling surface: `getBoundingClientRect().height` returned **36** against a
 * call site asking for 42. It looks approximately right, which is exactly why
 * it survives review.
 *
 * -----------------------------------------------------------------------------
 * THE DARK FILL IS EXPLICIT **AND** IMPORTANT-MARKED
 * -----------------------------------------------------------------------------
 * `select.tsx` ships its own `dark:bg-input/30`. Writing an unprefixed fill
 * loses in dark mode outright (that rule is (0,2,0) too). Writing the `dark:`
 * half is necessary and still not sufficient: once BOTH rules are
 * `dark:`-prefixed they TIE, and a tie is decided by emission order — Tailwind's
 * deterministic name sort, where `bg-input…` precedes `bg-surface-…` only
 * because *i* precedes *s*. That is an observed outcome, not a constructed one,
 * so the dark half carries the important modifier and wins by construction
 * instead of by alphabet.
 *
 * The primitives' `rounded-md` / `h-9` / `dark:bg-input/30` remain an OPEN
 * product-wide Migration Delta. This corrects them at these call sites and does
 * not sweep them; migrating the primitive retires both markers with it.
 *
 * THE FILL IS ONE STEP ABOVE **THIS** HOST. The control sits inside a `ROW`,
 * inside `ROW_GROUP`, which is `bg-surface-container` — so
 * `surface-container-high` is exactly host + 1. On a borderless field the fill
 * IS the whole affordance; get the step wrong and the control renders at
 * 1.00:1 against its own background, with no edge at all.
 */
const FIELD_BOX = "h-[2.625rem]! w-full rounded-pill border-0 px-4 text-[0.84375rem] font-medium @2xl/card:w-auto @2xl/card:min-w-[15rem]";

/** Focus ring and disabled. Rides whatever is the box. */
const FIELD_STATE =
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD = `${FIELD_BOX} bg-surface-container-high dark:bg-surface-container-high! ${FIELD_STATE}`;

/**
 * The manual MAC entry, handed to a RAW `<input>` rather than to the `Input`
 * primitive.
 *
 * `Input`'s base string carries `dark:bg-input/30` and `md:text-sm`, and `cn()`
 * cannot let an unprefixed class displace a variant-prefixed one — so the fill
 * silently reverts in dark mode and the size reverts at a 768px VIEWPORT, which
 * is a viewport breakpoint leaking into a container-query surface. Both were
 * live in the retired card.
 *
 * A MAC address is an identifier the device matches byte-for-byte, so it is one
 * of the places the Machine-Voice Rule genuinely sends text to `font-mono`. The
 * placeholder is a FORMAT hint rather than a value, so it drops back out of the
 * uppercase transform.
 */
export const MAC_FIELD = `${FIELD} font-mono uppercase placeholder:normal-case placeholder:font-sans placeholder:text-on-surface-variant`;

/** The glyph riding inside a trigger or an action pill. */
export const FIELD_GLYPH = "size-3.5";

/**
 * The card's footer: the two actions, then the provenance line.
 *
 * The provenance wraps to its own line below `@2xl/card` rather than competing
 * with the buttons for width — a truncated file path is worse than no path.
 */
export const FOOTER = {
  ROOT: "flex flex-col gap-3 @2xl/card:flex-row @2xl/card:items-center",
  ACTIONS: "flex flex-wrap items-center gap-2.5",
} as const;

/**
 * The provenance line under the card.
 *
 * It names the file the values are read back FROM, which is the one thing this
 * card cannot otherwise tell you: the Selects show what was asked for, and this
 * says where the answer comes from — a config file QManager wrote, not a live
 * read of the modem. When the draft is dirty the same slot reports the unsaved
 * count instead, because in that state the more useful fact is that the file
 * and the form disagree.
 *
 * This constant is the LINE's ink and size only. The path's `font-mono` is
 * written at the call site beside the literal path — the machine voice belongs
 * to that one string, and hoisting a single voice token into a shared module
 * would separate it from the only thing it is ever true of.
 */
export const PROVENANCE = "text-on-surface-variant text-xs @2xl/card:ml-auto";

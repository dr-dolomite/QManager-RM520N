// =============================================================================
// TTL & MTU — shared geometry and tone contract
// =============================================================================
// The `/local-network/ttl-mtu-settings` family's FIRST shapes module, and the
// THIRD under `/local-network/` — `ethernet/shapes.ts` landed at 2511953 and
// `traffic-engine/shapes.ts` at 0fdfc65, so the convention here is inherited
// rather than invented.
//
// The finding this module exists to close is number 13 of the approved
// proposal: there was no shapes module on this route at all. Geometry was
// restated inline, which is how the page ended up with a skeleton promising
// `h-8 w-48` plus two `h-10` boxes against a loaded form of a switch row, two
// 42px fields and a 42px button — a handoff that jumps by whatever the form
// happens to resolve to that render (The Skeleton-Mirror Rule).
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box, and the two
// sibling modules under `/local-network/` hold most of the rest of this file
// almost verbatim. Nothing here imports any of them. `/local-network/` must not
// reach into `components/cellular/`, and sibling families restate from each
// other rather than sharing, because what is shared is the SYSTEM's numbers, not
// a module — a shared module makes one family's next correction silently
// everybody's (DESIGN.md > Layout).
//
// The values below are the system's, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// -----------------------------------------------------------------------------
// COLOUR: NEUTRAL BODIES, COLOUR ONLY ON THE DISC
// -----------------------------------------------------------------------------
// Every tile body is `TILE.BODY` and there is deliberately no `tone` prop for a
// caller to override it with. A disc changes tone only when the thing it stands
// for has a real functional state, which on this band means "is an override
// actually in force". A TTL that is not being rewritten is not a fault and not a
// warning — it is the carrier's own value, which is the normal, correct resting
// state of a modem — so it takes the neutral disc (The Neutral-Default Rule).
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING
// -----------------------------------------------------------------------------
// The role scale, mapped by SHAPE ROLE rather than by nearest number:
//
//   36px  card shell        -> `rounded-card` — both cards are PEERS
//   28px  tile, row group   -> `rounded-tile`
//   20px  row               -> `rounded-field`
//   999px fields, chips     -> `rounded-pill`
//
// `rounded-hero` is "the ONE card that anchors a surface". The anchor here is
// the band, so neither write card wears it. The retired cards wore the raw
// `card.tsx` primitive instead — `rounded-xl border shadow-sm`, i.e. a 12px
// radius, a hairline over a fill, and a shadow outside the vocabulary entirely.
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/**
 * The route wrapper. Container queries key off `@container/main`, which every
 * `@xl/main:` and `@3xl/main:` variant in this file resolves against.
 *
 * The sibling traffic-engine module deliberately splits the container
 * declaration out to its shell; ethernet bundles it. This family follows
 * ethernet, because there is exactly one route root and keeping the name beside
 * the layout means a reader answering "what is `main` here" finds it in the
 * same string as the variants that use it.
 */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page header.
 *
 * The retired shell wrote `text-3xl font-bold mb-2`, which appears in 26 files
 * and is missing the `tracking-[-0.02em]` the Display step specifies — so every
 * one of those pages renders its title fractionally wider than the migrated
 * surfaces do. The spacing moves onto the flex `gap` rather than a trailing
 * margin, so the header composes instead of pushing.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/**
 * The page-header action pill (Refresh).
 *
 * Restated per family, never imported across one — the same 42px pill the two
 * sibling headers use, and the same reason it is not shared.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

// -----------------------------------------------------------------------------
// Band A — "In force on rmnet"
// -----------------------------------------------------------------------------

/**
 * The band header: label left, one status chip pushed right by `mr-auto`.
 *
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears — the same reserve-don't-animate trade `DELTA` makes for the
 * delta chip. This page carried NO status indicator of any kind before (finding
 * 15): nothing on it said whether a custom TTL or MTU was actually in force, and
 * the only hint was a pre-filled input, which is a control reporting itself.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  /** "In force on rmnet" — the thing the chip is a property OF. */
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px rather than floored, and `HEIGHT` is what the
 * skeleton imports so it mirrors the pin BY REFERENCE rather than by a restated
 * number. A floor cannot be a mirror: a floored tile resolves to whatever its
 * content needs, and the skeleton->content handoff then jumps by the difference.
 * Nothing clips at the pin because the eyebrow, value and caption all truncate.
 *
 * `BODY` is the ONLY body fill, with no `tone` prop anywhere to override it.
 * Making the wrong thing unreachable is cheaper than a comment asking nobody to
 * do it.
 *
 * THREE columns, not four. The band had a fourth tile in the approved comp
 * ("ON REBOOT -> Reapplied / Nothing set", reading `autostart`) and it was cut
 * by user decision on 2026-08-31: `ttl.sh:48-51` derives that field from
 * `svc_is_enabled`, which is `[ -L "$_WANTS_DIR/$unit" ]`, and the installer
 * creates that symlink on every install and every OTA. The field is `true` on
 * every device forever, so the tile would have read "Reapplied" on a device with
 * nothing set — a constant rendered as if it were a reading.
 */
export const TILE = {
  /** Container queries, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-3",
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
   * `tabular-nums` in the UI face and NEVER `font-mono`. A TTL, a hop limit and
   * an MTU are quantities the interface is currently applying, not identifiers
   * the device emits verbatim — and the Machine-Voice Rule sends only the latter
   * to mono. The one mono string on this surface is the config path in the
   * provenance line, written at its call site.
   */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  VALUE_TEXT: "truncate",
  CAPTION: "text-on-surface-variant truncate text-xs",
} as const;

/**
 * The placeholder for a figure that has no reading — a TTL that is not being
 * rewritten, an MTU that was never read, the "before" half of a delta chip on a
 * field that was empty.
 *
 * An em dash reads as an ABSENCE in all five locales and needs no translator,
 * where the retired "N/A" reads as a value and needed a key per site. Module
 * level rather than inside `TILE` because the write cards use it too, and a card
 * reaching into the tile's geometry object for a dash would be importing the
 * band's shape to get a string.
 */
export const VALUE_NONE = "—";

/**
 * Disc fills, and the ONLY colour on this band.
 *
 * Each is a FILL pair (`bg-X` + `text-X-foreground`), never a container pair —
 * the disc is the one element small enough to want a strong fill, and the pair
 * is never crossed (The Three-Layer Rule). It is also the layer that survives
 * simulation: pale containers separate in 2 of 10 pairs under deuteranopia,
 * fills in 10 of 10.
 *
 * Keyed by TONE rather than by a domain state, because three tiles read from it
 * and they do not share a state machine — TTL and hop limit map an integer, MTU
 * maps a boolean.
 *
 * `warning` and `destructive` are carried for the type's completeness and are
 * not currently selected by any tile: nothing on this band is a fault. A modem
 * that is not rewriting hop counts is a modem behaving normally.
 */
export const DISC_TONE = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  primary: "bg-primary text-primary-foreground",
  neutral: "bg-surface-container-high text-on-surface-variant",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for the discs that change at runtime.
 *
 * Scoped to two properties, never `transition-all` — a bare `transition-all`
 * silently inherits Tailwind's 150ms, which is off the scale and will not retune
 * with it.
 *
 * Every arbitrary custom property takes `var()`, and that is load-bearing rather
 * than stylistic. Tailwind v4 dropped the BARE-VAR bracket shorthand, so
 * writing the custom property directly in the brackets with no `var()` wrapper
 * now compiles to a declaration whose value is
 * the property NAME rather than its value — invalid CSS, which the browser
 * discards, so it ships as no transition at all rather than as an off-scale one.
 * The class is still generated, so grepping the class name finds it and tsc /
 * eslint / next build all pass; only the emitted value tells.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/**
 * The band's non-tile states: one tile SPANNING the grid.
 *
 * Three identical "couldn't read" tiles would be one message repeated three
 * times, and a shimmer over a dead poll is worse than either — a skeleton is a
 * promise that data is on its way, and holding one over a failed read is the
 * misstatement this re-authoring exists to remove. The notice keeps the family
 * box (same `TILE.ROOT` + `TILE.BODY`, same neutral disc) so it reads as the
 * band saying something, not as a second vocabulary for the same event.
 */
export const NOTICE_SPAN = "@xl/main:col-span-3";
export const NOTICE_TITLE = "truncate text-lg font-semibold";
/** The Retry pill inside a notice tile. 36px, one step under `PILL_ACTION`. */
export const NOTICE_ACTION =
  "h-9 flex-none gap-2 rounded-pill px-4 text-[0.8125rem] font-semibold";

/**
 * Status-chip tones for the band, keyed onto the exported `BadgeVariant` type
 * rather than onto a class string.
 *
 * That annotation is the whole point: a new state without a matching chip role
 * fails the BUILD, where a `Record<string, string>` would render an untinted
 * chip and ship (CLAUDE.md > Status Chip Pattern).
 *
 * `muted` is the correct role for a deliberately inactive state and is used here
 * on purpose — running on the carrier's own TTL and MTU is not a failure, it is
 * the shipping default. `destructive` would say something is broken.
 */
export type TtlMtuState = "custom" | "default";

export const STATE_BADGE: Record<TtlMtuState, BadgeVariant> = {
  custom: "success",
  default: "muted",
};

/**
 * The glyph inside a status chip. 12px, matching the chip's own text step.
 *
 * Every chip on this surface carries one, and the two states never share it:
 * `success-container` and `surface-container-high` are close enough in light
 * mode that the glyph is what actually separates "custom values live" from
 * "carrier defaults".
 */
export const CHIP_GLYPH = "size-3";

// -----------------------------------------------------------------------------
// Band B — the two write cards
// -----------------------------------------------------------------------------

/**
 * The card shell. A PEER, not the anchor: `rounded-card` (36px) and the whisper
 * shadow, which is the only card lift in the vocabulary and is never
 * load-bearing. `border-0` is explicit — a tonal surface never also carries a
 * hairline (The No-Hairline-On-Fill Rule).
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx:10` ships
 * `shadow-sm`, and `cn()` does NOT dedupe it against this one: `tailwind-merge`
 * cannot tell whether an arbitrary `shadow-` value is a box-shadow or a shadow
 * COLOUR, so an unresolvable `var()` lands in the colour group and BOTH classes survive
 * the merge. Tailwind then compiles both to `--tw-shadow` and the winner is
 * emission order, which is its deterministic name sort — `shadow-[` sorts before
 * `shadow-s`, so the primitive's default is emitted LAST and wins. Measured on
 * the sibling surface, not reasoned: `getComputedStyle(card).boxShadow` returned
 * Tailwind's two-layer `shadow-sm` against a call site asking for the whisper.
 * The marker makes the whisper win by construction instead of by alphabet.
 *
 * The harness reads the WHOLE declaration (from `export const CARD_SHELL` to
 * the closing `;`), not just its first line, so this wraps naturally like the
 * reference (`ethernet/shapes.ts:231`) instead of being pinned to one physical
 * line.
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
 * is why an explicit `leading-tight` travels with the size.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight font-semibold";

/** The card body under the header. */
export const CARD_BODY = "flex flex-col gap-3";

/**
 * One tonal group holding a card's setting rows.
 *
 * The fill is exactly ONE step above the card (`surface` -> `surface-container`)
 * and the control inside a row is one step above the group again
 * (`surface-container-high`). On a borderless system the fill IS the affordance;
 * skip a step and the field renders at 1.00:1 against its own background, with
 * no edge at all.
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row.
 *
 * A `min-h` FLOOR here, and the distinction from the tile's pin is deliberate: a
 * tile has a skeleton mirroring it, so it must be a pin; a row has none, and its
 * consequence sentence wraps to two lines on a narrow container where a fixed
 * height would clip it.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /**
   * The label + consequence column.
   *
   * `flex-1` is load-bearing rather than cosmetic. With `min-w-0` alone this
   * column shrinks to zero against a `flex-none` control and the consequence
   * wraps to one word per line — a very tall row that only appears once the
   * control happens to be wide, so the layout looks fine right up until it does
   * not.
   */
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  /** Label and its delta chip share one line; the chip reserves its slot. */
  LABEL_LINE: "flex min-w-0 flex-wrap items-center gap-2",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence. REQUIRED on every row, not optional — it is what
   * makes a settings row a decision rather than a field. On this surface it is
   * the sentence that says a carrier may be counting hops to detect tethering,
   * and the one that says an MTU under ~1400 breaks path-MTU discovery on hosts
   * that drop ICMP: both are the reason someone opened this page, and neither
   * was anywhere on it before.
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
  /**
   * What a row's skeleton stands in for.
   *
   * `ROOT` is a FLOOR, so this mirrors the floor rather than a pin — and that is
   * as close as a mirror can get here without clipping a consequence sentence
   * that legitimately wraps. It is still a REFERENCE rather than a restated
   * number, which is the half of the Skeleton-Mirror Rule that actually rots:
   * the retired card guessed `h-8 w-48` plus two `h-10` boxes against a form of
   * a switch row, two 42px fields and a 42px button, and nothing tied the two
   * together.
   */
  HEIGHT: "h-[5rem]",
  /**
   * The dim for a row whose control is held by a condition elsewhere — the value
   * rows while the rewrite switch is off, or the whole card while a SIM profile
   * owns it. Dimming rather than hiding: the value is still the truth about the
   * device, and a row that vanishes takes its explanation with it.
   *
   * IT GOES ON `TEXT`, NOT ON `ROOT`, and that is a correction rather than a
   * preference. Every disabled control in the system already carries
   * `disabled:opacity-50`, and `opacity` COMPOUNDS through the tree — a 0.6 row
   * wrapping a 0.5 control renders the control at 0.30, which is under the
   * legibility floor for a field the user is meant to read the current value
   * out of. Scoping the dim to the text column leaves the control on the one
   * disabled treatment the whole product shares.
   */
  HELD: "opacity-60",
} as const;

/**
 * The 42px pill box and the type it speaks in. Module-private — the API is
 * `FIELD`.
 *
 * THE HEIGHT IS IMPORTANT-MARKED, and both markers here are the family's
 * contract rather than decoration at this one call site. `select.tsx:40` ends
 * with `data-[size=default]:h-9`, and Tailwind v4 compiles that attribute
 * modifier to specificity **(0,2,0)** against a bare `h-[2.625rem]`'s
 * **(0,1,0)**; `tailwind-merge` keeps both, because they sit in different
 * modifier groups, and the primitive simply wins. Measured on the sibling
 * surface: `getBoundingClientRect().height` returned **36** against a call site
 * asking for 42. It looks approximately right, which is exactly why it survives
 * review.
 *
 * The dark fill is written explicitly AND important-marked for the same reason
 * on a different axis. A light-only override loses outright in dark mode against
 * `input.tsx`'s `dark:bg-input/30`; and once both rules are `dark:`-prefixed
 * they TIE at (0,2,0), where the winner is Tailwind's deterministic name sort —
 * `bg-input…` before `bg-surface-…` only because *i* precedes *s*. That is an
 * observed outcome, not a constructed one, so the marker makes it constructed.
 *
 * The fields on this surface are handed to a raw `<input>` rather than to the
 * `Input` primitive, which is the same call `traffic-engine/shapes.ts` made:
 * `Input`'s base string carries `dark:bg-input/30` and `md:text-sm`, and `cn()`
 * cannot let an unprefixed class displace a variant-prefixed one — so the fill
 * silently reverts in dark mode and the type step reverts at a 768px VIEWPORT,
 * which is a viewport breakpoint leaking into a container-query surface. The
 * markers stay anyway: they are what keeps this constant correct if it is ever
 * handed to a primitive, and the whole point of a shapes module is that the next
 * consumer does not have to rediscover the collision.
 */
const FIELD_BOX =
  "h-[2.625rem]! w-full min-w-0 rounded-pill border-0 px-4.5 text-[0.875rem] font-medium tabular-nums @2xl/card:w-[9.5rem]";

/** Ink, focus ring and disabled. Rides whatever is the box. */
const FIELD_STATE =
  "text-on-surface placeholder:text-on-surface-variant focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD = `${FIELD_BOX} bg-surface-container-high dark:bg-surface-container-high! ${FIELD_STATE}`;

/**
 * The invalid state, as an INSET ring rather than a border.
 *
 * A border would change the field's box and shift every neighbour by 2px the
 * moment a digit goes out of range — a layout that moves while you are typing
 * into it. An inset shadow paints inside the existing box, so the error appears
 * without anything else moving, and it does not violate the
 * No-Hairline-On-Fill Rule because it is not a stroke around the fill, it is
 * part of it. The token is requested by name, never as an alpha of it: an alpha
 * is a request to whatever happens to be behind the field rather than to the
 * role, so it renders a different colour on a card than on a popover.
 */
export const FIELD_INVALID =
  "shadow-[inset_0_0_0_2px_var(--destructive)] focus-visible:ring-destructive/30";

/**
 * The pending-change chip in a row's label, e.g. `64 → 65`.
 *
 * THE CHIP'S LINE IS RESERVED. It is rendered `invisible` when the row is clean
 * rather than removed, so a row being promoted from clean to dirty moves nothing
 * — the same reserve-don't-animate trade `BAND.HEAD` makes for its status chip.
 * A settings form that reflows the instant you touch a field is a form that
 * punishes you for exploring it.
 *
 * `tabular-nums` in the UI face: these are quantities being compared digit
 * against digit, and the equal advance is the entire reason the comparison reads
 * at a glance.
 */
export const DELTA = {
  ROOT: "text-on-surface-variant inline-flex items-center gap-1 rounded-pill bg-surface-container-high px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
  /** Applied when `from === to`. Reserves the slot without drawing it. */
  CLEAN: "invisible",
  ARROW: "opacity-70",
} as const;

/**
 * The provenance line under a card.
 *
 * It names where the value on screen came FROM, which is the one thing a
 * settings card cannot otherwise tell you: the field shows what you asked for,
 * and this says who answered. The path's `font-mono` is written at the call
 * site, beside the literal path — the machine voice belongs to that one string,
 * and hoisting a single voice token into a shared module would separate it from
 * the only thing it is ever true of.
 *
 * The same slot carries the blocking reason when Apply is disabled, in
 * `PROVENANCE_BLOCKED`. That is deliberate re-use rather than a second line: the
 * question "why can't I press this" and the question "where did this number come
 * from" are asked in the same glance, at the same place, and a card that grows a
 * row when a value goes out of range moves the button out from under the cursor.
 *
 * `destructive-on-surface` is INK on a neutral card ground — the system's
 * primary mechanism for colour — never a fill and never an alpha wash. It
 * replaces `border-destructive/50 bg-destructive/10 text-destructive`, which was
 * both an alpha on a role colour and a hairline on a fill.
 */
export const PROVENANCE = "text-on-surface-variant px-1 text-xs";
export const PROVENANCE_BLOCKED = "text-destructive-on-surface px-1 text-xs";

/** The card footer: the save action, an optional discard, then provenance. */
export const CARD_FOOT = {
  ROOT: "flex flex-col gap-3",
  ACTIONS: "flex flex-wrap items-center gap-2.5",
  /**
   * The 42px control height, on its own so the footer's SKELETON can mirror the
   * action by reference instead of restating the number a third time.
   */
  ACTION_HEIGHT: "h-[2.625rem]",
  /** The ghost discard. Same 42px pill, no fill until hovered. */
  DISCARD:
    "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold hover:bg-surface-container",
  GLYPH: "size-4",
} as const;

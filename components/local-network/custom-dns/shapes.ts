import type { BadgeVariant } from "@/components/ui/badge";

// =============================================================================
// Custom DNS — shared geometry and tone contract
// =============================================================================
// The `/local-network/custom-dns` family's shapes module, and the THIRD under
// `/local-network/`. `components/local-network/ethernet/shapes.ts` landed first
// and the DPI surface's landed second, so the convention here is inherited
// rather than invented.
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box and this file
// deliberately does NOT import it, and neither does it import either sibling
// module under `/local-network/`. Geometry is restated across sibling families;
// anything genuinely family-wide is promoted one level up instead. What is
// shared is the SYSTEM's numbers, not a module.
//
// The values below are the system's, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE REPLACES
// -----------------------------------------------------------------------------
// The retired `custom-dns-card.tsx` had no shapes module at all, and the five
// defects that follow from that are all visible only across files:
//
//   * the card was the raw primitive — `card.tsx` ships `rounded-xl border
//     shadow-sm`, so a 12px radius, a hairline and a shadow outside the
//     vocabulary shipped on a system whose card role is 36px / border-0 /
//     `--shadow-whisper`.
//   * the loading skeleton promised `h-[68px]` and four `h-9` boxes. Not one of
//     those is a height this system ships, and none of them mirrored the loaded
//     form (a switch row, N 42px fields, a 42px button).
//   * the error band was `border-destructive/50 bg-destructive/10` — an alpha
//     wash on a role colour AND a hairline on a fill, both retired. An alpha is
//     a request to whatever happens to be behind it rather than to the token, so
//     it renders a different colour on a card than it does on a popover.
//   * the surface ran a private motion scale, `REVEAL_DURATION = 0.2` with an
//     out-quart curve. 200ms is on neither the 360/600/800 duration scale nor
//     either shipped ease, so a retune of the token layer could never reach it.
//   * nine sites reached for `text-muted-foreground`, which is not this system's
//     ink; `on-surface-variant` is.
//
// -----------------------------------------------------------------------------
// THE CARD IS COMPOSED FROM `Card` / `CardHeader` / `CardTitle` /
// `CardDescription` / `CardContent`
// -----------------------------------------------------------------------------
// `Card` takes `CARD_SHELL`; `CardHeader` and `CardContent` each take
// `CARD_PAD`; `CardTitle` takes `CARD_TITLE`; `CardDescription` takes no
// className. This is the reference convention (speed-limit-card.tsx:134-139)
// and CLAUDE.md's stated rule: plain `CardTitle` + `CardDescription`, never an
// icon inside either.
//
// -----------------------------------------------------------------------------
// COLOUR: NEUTRAL BODIES, AND ONLY TWO DISCS MOVE
// -----------------------------------------------------------------------------
// Every tile body is `TILE.BODY` and there is no `tone` prop to override it.
// Colour lives on the 52px disc. Two discs pick a tone at runtime and they are
// the only two things on this strip with a functional state:
//
//   CARRIER FALLBACK  warning when the fallback is OFF. That is a real
//                     behavioural difference — a lookup fails outright instead
//                     of leaking to the carrier — and it is the one setting on
//                     this page whose "on" is quieter than its "off".
//   UPSTREAM 1 / 2    destructive when the sentinel block is malformed, because
//                     in that state the list being printed is not reliably what
//                     dnsmasq is resolving against.
//
// SOURCE is permanently neutral. "Custom" versus "Carrier" is a CATEGORY, not a
// verdict — neither is healthier than the other — and minting a hue for it is
// the failure the colour system exists to prevent (The Neutral-Default Rule).
// =============================================================================

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page title.
 *
 * It moves here out of `app/local-network/custom-dns/page.tsx`, which was a
 * SERVER component holding inline `text-3xl font-bold mb-2` markup — a spelling
 * that appears in 26 files and is missing the `tracking-[-0.02em]` the Display
 * step specifies, so every one of those pages renders its title fractionally
 * wider than the migrated surfaces do. A server component also cannot own the
 * motion cascade, which is the structural reason `custom-dns.tsx` exists at all.
 *
 * The spacing lives on the flex `gap` rather than a trailing margin, so the
 * header composes instead of pushing.
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
 * Restated per family, never imported across one — the same 42px pill the
 * sibling headers use, and the same reason it is not shared.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

// -----------------------------------------------------------------------------
// Band A — the live upstream strip
// -----------------------------------------------------------------------------

/**
 * The band header: label left, the state chip pushed right by `mr-auto`.
 *
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears or changes role — the same reserve-don't-animate trade `DELTA`
 * makes for its own line.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  /** "Currently forwarding" — the thing the chip is a property OF. */
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px rather than floored, and `HEIGHT` is what the
 * skeleton imports so it mirrors the pin BY REFERENCE rather than by a restated
 * number (The Skeleton-Mirror Rule). The retired card's loading state guessed
 * `h-[68px]` for the readout it was standing in for, which is not a height that
 * readout ever resolved to.
 *
 * A `min-h-` here would be a FLOOR, and a floor cannot be a mirror: the tile
 * would resolve to whatever its content needed and the skeleton-to-content
 * handoff would jump by the difference. There is deliberately no `min-h-` in
 * this block. Nothing clips at the pin, because the eyebrow, value and caption
 * all truncate.
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
 * simulation: pale containers separate in 2 of 10 pairs under deuteranopia,
 * strong fills in 10 of 10.
 *
 * Keyed as a typed map rather than as three loose strings so a caller cannot
 * invent a fourth tone by writing a class.
 */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for the discs that change at runtime.
 *
 * Scoped to two properties, never `transition-all` — a bare `transition-all`
 * silently inherits Tailwind's 150ms, which is off the scale and will not
 * retune with it.
 *
 * Every arbitrary custom property takes `var()`, and that part is load-bearing
 * rather than stylistic. Tailwind v4 dropped the BARE-VAR arbitrary shorthand,
 * so writing `duration-[--duration-standard]` compiles to a declaration whose
 * value is the property NAME rather than its value. That is invalid CSS, the
 * browser discards it, and it ships as no transition at all rather than as an
 * off-scale one. The class is still generated, so grepping the class name finds
 * it and tsc / eslint / next build all pass; only the emitted value tells.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/** The eyebrow above a tile's figure. ONE spelling. */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]";

/**
 * The figure.
 *
 * `min-w-0` rather than `truncate`: this is a flex box, so the truncation has to
 * happen on the text child (`VALUE_TEXT`).
 *
 * The face is decided PER TILE, not here. A resolver address is an identifier
 * the device emits verbatim, so it takes `VALUE_MONO`; "Custom", "Carrier",
 * "On" and "Off" are words and stay in the UI face (The Machine-Voice Rule).
 */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em]";

/** The truncating text child of a `VALUE` box, for a word. */
export const VALUE_TEXT = "truncate";

/**
 * The truncating text child of a `VALUE` box, for a MACHINE STRING.
 *
 * A resolver address is an identifier read back off the device, which is exactly
 * what the Machine-Voice Rule sends to mono. The size steps down because
 * JetBrains Mono runs wider than Rethink Sans at the same nominal size and a
 * full IPv6 literal has to survive a 4-up grid on a tablet.
 */
export const VALUE_MONO =
  "truncate font-mono text-[1.125rem] font-semibold tracking-[-0.01em] tabular-nums";

/** The caption under a figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/**
 * The placeholder for a figure that has no reading.
 *
 * The tile's caption already says WHY there is nothing there, so the figure
 * itself only has to read as an absence. An em dash is typographically identical
 * in all five locales and needs no translator, where the retired "N/A" was a
 * translated abbreviation that reads as a value.
 */
export const VALUE_NONE = "—";

/**
 * A FAILED read, or a device where dnsmasq is not in the path at all. The band
 * keeps the family box and goes neutral rather than shimmering: a skeleton is a
 * promise that data is on its way, and holding one over a dead poll is a
 * misstatement.
 *
 * It SPANS the grid. Four identical "couldn't read" tiles would be one message
 * repeated four times, and a bespoke centred error card is a second vocabulary
 * for the same event.
 */
export const NOTICE_SPAN = "@xl/main:col-span-2 @5xl/main:col-span-4";
export const NOTICE_TITLE = "truncate text-lg font-semibold";

/**
 * The band's state chip, keyed onto the exported `BadgeVariant` type rather than
 * onto a class string, so a new state without a matching chip role fails the
 * build rather than rendering an unstyled chip.
 *
 * The retired card had three of these hand-written at the call site and no
 * `corrupt` state at all — `blockCorrupt` crossed the wire, was typed, and died
 * at the component boundary, so a malformed dnsmasq block rendered IDENTICALLY
 * to a healthy one.
 *
 * `muted` for `carrier` is deliberate and is not a downgrade: carrier-assigned
 * DNS is the device's resting state, not a fault. `destructive` is reserved for
 * `corrupt`, which is the only member here that reports something being wrong.
 *
 * Every chip that keys off this map carries its own glyph, and no two states
 * share one: `success-container` and `warning-container` measure 1.03:1 apart —
 * the same surface to the eye, and identical under deuteranopia — so the glyph
 * is the only thing separating the healthy state from the degraded one.
 */
export type DnsState = "custom" | "carrier" | "corrupt" | "unavailable";

export const STATE_BADGE: Record<DnsState, BadgeVariant> = {
  custom: "success",
  carrier: "muted",
  corrupt: "destructive",
  unavailable: "warning",
};

// -----------------------------------------------------------------------------
// Band B — the write card
// -----------------------------------------------------------------------------

/**
 * The card shell. A PEER, not the anchor: `rounded-card` (36px) and the whisper
 * shadow, which is the only card lift in the vocabulary and is never
 * load-bearing. `border-0` is explicit — a tonal surface never also carries a
 * hairline (The No-Hairline-On-Fill Rule).
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx` ships
 * `shadow-sm`, and `cn()` does NOT dedupe it against this one: `tailwind-merge`
 * cannot tell whether `shadow-[<arbitrary>]` is a box-shadow or a shadow COLOUR,
 * so an unresolvable `var()` lands in the colour group and both classes survive
 * the merge. Tailwind then compiles both to `--tw-shadow` and the winner is
 * emission order, which is its deterministic name sort — `shadow-[` sorts before
 * `shadow-s`, so the primitive's default is emitted LAST and wins. Measured on
 * the sibling surface, not reasoned: `getComputedStyle(card).boxShadow` returned
 * Tailwind's two-layer `shadow-sm` against a call site asking for the whisper.
 * The marker makes the whisper win by construction instead of by alphabet.
 *
 * Kept on ONE line on purpose: the design-language harness reads this
 * declaration with a line-anchored grep, and a wrapped value hides three quarters
 * of itself from the check that exists to keep it honest.
 */
export const CARD_SHELL = "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/**
 * The card's title. `CardTitle` ships only `leading-none font-semibold` and
 * takes its size from the call site, so an unsized one inherits 16px and
 * flattens the surface's type ramp. It WRAPS rather than truncating — a card
 * title that silently loses its last word is worse than a two-line one — which
 * is why `leading-tight` travels with the size.
 */
export const CARD_TITLE = "min-w-0 text-lg font-semibold leading-tight";

/**
 * One tonal group holding the card's setting rows.
 *
 * The group is `surface-container`, one step above the card's `surface`, and the
 * controls inside are `surface-container-high`, one step above the group. That
 * ladder is what makes a borderless field legible: on a control with no hairline
 * the FILL is the whole affordance, and a control that shares its host's value
 * renders at 1.00:1 against its own background, with no edge at all.
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row.
 *
 * A `min-h` FLOOR here, not a pin, and the distinction is the opposite of the
 * tile's: a tile has a skeleton mirroring it, so it must be a pin; a row has
 * none, and its consequence sentence wraps to two lines on a narrow container
 * where a fixed height would clip it.
 *
 * `TEXT` carries `flex-1` and not merely `min-w-0`. With `min-w-0` alone the
 * column shrinks to zero against a `flex-none` control and the consequence wraps
 * to one word per line — a several-hundred-pixel-tall row that only appears once
 * the control happens to be wide, so the layout looks fine right up until it
 * does not.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence. REQUIRED on a row that makes a decision, not
   * optional — it is what makes a settings row a decision rather than a field.
   * On this surface the two switches carry the sentences that matter: turning
   * custom resolvers off hands DNS back to whatever the carrier sent on the last
   * attach, and turning the fallback off makes a lookup FAIL rather than leak.
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex flex-none items-center gap-2 @2xl/card:ml-auto",
  /**
   * A row that is present but cannot be acted on — the resolver rows while
   * custom DNS is off. It DIMS rather than disappearing: the rows are the
   * answer to "what would turning this on give me", and hiding them makes the
   * switch a leap.
   *
   * IT GOES ON `TEXT`, NEVER ON `ROOT`. Every disabled control in this system
   * already carries `disabled:opacity-50` — the switch primitive, and `FIELD`
   * above. CSS `opacity` composites per element and COMPOUNDS down the tree, so
   * a row root at 0.55 wrapping a field at 0.50 renders that field at 0.275 —
   * and on these rows the held field is the one still showing the resolver the
   * device is configured with, which is the exact string the row exists to
   * report. It looks approximately right in a screenshot, which is why the wrong
   * placement survives review.
   */
  DIM: "opacity-55",
  /** The row's error sentence, in place of its consequence. */
  ERROR: "text-destructive text-[0.78125rem] leading-relaxed text-pretty",
} as const;

/**
 * The 42px pill field a resolver address is typed into.
 *
 * -----------------------------------------------------------------------------
 * IT IS A RAW `<input>`, NOT THE `Input` PRIMITIVE
 * -----------------------------------------------------------------------------
 * `input.tsx` ships `dark:bg-input/30` and `md:text-sm`, and NEITHER is
 * displaced by an unprefixed override passed through `cn()`: `tailwind-merge`
 * keeps classes in different modifier groups, and Tailwind v4 compiles `dark:`
 * to `&:is(.dark *)` — specificity (0,2,0) against a bare fill's (0,1,0). The
 * result is a field that looks right in light mode at every width the author
 * tested and quietly reverts in dark mode and at 768px and up.
 *
 * -----------------------------------------------------------------------------
 * THE HEIGHT AND THE DARK FILL BOTH CARRY THE IMPORTANT MARKER
 * -----------------------------------------------------------------------------
 * Kept even on a raw input, because this constant is the family's ONE control
 * shape and the next control on this surface may well be a `Select` — whose
 * primitive ends with `data-[size=default]:h-9` at (0,2,0), beating a bare
 * `h-[2.625rem]` at (0,1,0) and rendering 36px on a 42px system. That was
 * measured on the sibling surface at `getBoundingClientRect().height === 36`,
 * against a call site asking for 42.
 *
 * The dark fill needs it for a subtler reason: once BOTH rules are
 * `dark:`-prefixed they TIE at (0,2,0), and a tie is decided by emission order,
 * i.e. Tailwind's deterministic name sort. `bg-input…` sorts before
 * `bg-surface-…` only because *i* precedes *s*. That is an observed outcome, not
 * a constructed one, so the marker makes it win by construction.
 *
 * The fill is one step above its host: the field sits inside a `ROW`, inside
 * `ROW_GROUP`, which is `bg-surface-container` — so `surface-container-high` is
 * exactly host + 1 and the Field-Step Rule is satisfied by the composition.
 *
 * Kept on ONE line for the same reason `CARD_SHELL` is.
 */
export const FIELD = "h-[2.625rem]! w-full min-w-0 rounded-pill border-0 bg-surface-container-high dark:bg-surface-container-high! px-4.5 font-mono text-sm text-on-surface tabular-nums placeholder:font-mono placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** The ghost remove button beside a resolver field. 42px, so it matches. */
export const FIELD_REMOVE =
  "size-[2.625rem] flex-none rounded-pill text-on-surface-variant";

/**
 * The unsaved-change marker beside a row's label.
 *
 * It RESERVES its box: when the row is clean the marker still renders and takes
 * `DELTA.CLEAN`, so promoting a row from clean to dirty moves nothing on the
 * page. The alternative — mounting the marker on change — reflows the label row
 * at the exact moment the user is typing into the field beside it, and on a
 * four-row resolver list that is four separate jumps.
 *
 * `invisible` rather than `opacity-0` because an invisible element is also
 * removed from the accessibility tree, and a screen reader should not announce
 * "Unsaved" on a row that is saved.
 */
export const DELTA = {
  ROOT: "text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-primary",
  CLEAN: "invisible",
} as const;

/**
 * The card's error region: a solid tonal container, never a wash.
 *
 * This replaces `border-destructive/50 bg-destructive/10 … text-destructive`,
 * which was an alpha over a role colour AND a hairline on a fill. An alpha is a
 * request to whatever happens to be behind it rather than to the token, so the
 * retired band rendered a different colour on a card than it did anywhere else,
 * and collapsed in dark mode. The container/ink pair is one stable colour in
 * both themes.
 */
export const ERROR_BOX =
  "flex flex-col gap-1 rounded-field bg-destructive-container px-4 py-3 text-on-destructive-container";
export const ERROR_TEXT = "text-[0.8125rem] leading-relaxed text-pretty";

/**
 * The provenance line under the card.
 *
 * It names the file the value is read back FROM, which is the one thing a
 * settings card cannot otherwise tell you: the fields show what you asked for,
 * and this says where the answer comes from.
 *
 * This constant is the LINE's ink and size only. The path's `font-mono` is
 * written at the call site, beside the literal path — the machine voice belongs
 * to that one string, and hoisting a single voice token into a shared module
 * would separate it from the only thing it is ever true of.
 */
export const PROVENANCE = "text-on-surface-variant flex flex-wrap items-center gap-x-1 px-1 text-xs";

/** The card's footer: the save action, the add pill, then provenance below. */
export const CARD_FOOT = {
  ROOT: "flex flex-col gap-3",
  ACTIONS: "flex flex-wrap items-center gap-2.5",
} as const;

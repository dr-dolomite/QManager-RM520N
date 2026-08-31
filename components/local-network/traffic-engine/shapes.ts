// =============================================================================
// Traffic Engine — shared geometry and tone contract
// =============================================================================
// The `/local-network/traffic-engine` family's shapes module, and the SECOND
// under `/local-network/` — `components/local-network/ethernet/shapes.ts` landed
// one commit earlier, so the convention here is inherited rather than invented.
// (The approved proposal called this "the first shapes module outside
// components/cellular/". That was wrong, and it is corrected here rather than
// quietly: the decision is unaffected, only its novelty claim was.)
//
// Findings 03, 04, 07 and 08 of the proposal are all the failure this module
// prevents, and none of them is visible in any single file:
//
//   03  `MUTED_BADGE = "bg-muted/50 text-muted-foreground border-muted-foreground/30"`
//       hand-reimplemented `Badge variant="muted"` — while the sibling file in
//       the same folder used the variant correctly. One folder, two answers.
//   04  ...and that identical string was restated INLINE in a second file
//       rather than importing the constant, so the drift had already begun.
//   07  Four pseudo-tiles at `rounded-tile bg-surface-container p-4`, repeated
//       four times, with two different `gap` values and NO height pin.
//   08  The page skeleton restated `h-40` / `h-9` / `h-[22rem]` against a loaded
//       layout it had never measured, and the status card's own skeleton was
//       four bare `h-16` blocks against tiles that resolve far taller.
//
// -----------------------------------------------------------------------------
// WHY THE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box and this file
// deliberately does NOT import it. `/local-network/` is a separate route family
// and must not reach into `components/cellular/`; the sibling families under
// `/cellular/settings/` restate their geometry from each other for the same
// reason. What is shared is the SYSTEM's numbers, not a module.
//
// The values below are the system's, verbatim:
//
//   104px pinned tile   28px radius   52px disc   42px control   36px card
//
// -----------------------------------------------------------------------------
// THERE IS NO `min-h-` IN THIS FILE, AND THAT IS DELIBERATE
// -----------------------------------------------------------------------------
// The tile is PINNED because a skeleton mirrors it, and a floor cannot be a
// mirror — a floored tile resolves to whatever its content needs and the
// skeleton->content handoff jumps by the difference. Every other box here sizes
// to its content through padding instead, so nothing in the family is floored:
// a mode hint and an idle explanation both wrap to two lines on a narrow
// container, where a fixed height would clip them and a floor would only look
// like a pin until it did not.
//
// -----------------------------------------------------------------------------
// COLOUR: NEUTRAL BODIES, AND ONLY TWO DISCS MOVE
// -----------------------------------------------------------------------------
// Every tile body is `TILE.BODY` and there is no `tone` prop to override it.
// Colour lives on the disc, and only the ENGINE and REDIRECT-RULE discs pick a
// tone at runtime, because they are the only two things on the strip with a
// functional state.
//
// PROCESSED AND SCOPE ARE NEUTRAL, WHICH DEPARTS FROM THE APPROVED COMP. The
// comp drew them on `downlink` and `spatial`. Both would mint a second meaning
// for an existing axis, which is the exact failure `globals.css` records having
// already removed once: "the previous system gave rose a second meaning ('and
// capacity') and cyan a second ('and counts'), which made the axis untrue — a
// carrier count wore upload cyan while reporting nothing about upload. A count
// is neutral." A packet counter is a count, and a domain count is a count.
// Spatial means "a figure naming both radios at once", which a hostlist size is
// not. So both take `DISC_NEUTRAL` under The Neutral-Default Rule, the same call
// the ethernet strip made for its negotiated rate one commit earlier. A colour
// that never changes encodes nothing anyway.
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING FROM THE APPROVED COMP
// -----------------------------------------------------------------------------
// The comp is drawn in raw pixels; this surface ships the role scale, mapped by
// SHAPE ROLE rather than by nearest number:
//
//   comp 36px  card shell        -> `rounded-card` (36px) — PEER cards
//   comp 40px  condition screen  -> `rounded-hero` (40px) — the anchor
//   comp 28px  tile              -> `rounded-tile` (28px)
//   comp 20px  field, banner     -> `rounded-field` (20px)
//   comp 999px rows, chips, disc -> `rounded-pill`
//
// The strip is the anchor on the installed page, so the cards below it are
// peers. On the NOT-INSTALLED page there is no strip, and the condition screen
// is the anchor — which is why it, and only it, wears `rounded-hero`.
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";
import type { DpiEngineStatus } from "@/types/traffic-engine";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/**
 * The route wrapper's LAYOUT, and deliberately not its container declaration.
 *
 * `@container/main` is written at the route root in `traffic-engine.tsx`
 * instead. The container NAME is this route's contract with every `@xl/main:`
 * and `@5xl/main:` variant underneath it — including the ones in `TILE.GRID`
 * and `PAGE_HEAD` in this very file — so it belongs where a reader looks for it
 * when asking "what is `main` here", not folded into an imported string that
 * has to be opened to find out. The sibling ethernet module bundles the two;
 * this is the deliberate difference, and it is why geometry is restated per
 * family rather than shared.
 */
export const PAGE_ROOT = "mx-auto flex flex-col gap-5 p-2";

/**
 * The page-header action pill (Uninstall engine).
 *
 * Restated per family, never imported across one — same 42px pill the ethernet
 * header uses, and the same reason it is not shared.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/**
 * The page title, ON the Display step.
 *
 * Finding 10: `text-3xl font-bold mb-2` appears in 26 files and is missing the
 * `tracking-[-0.02em]` the Display step specifies, so every one of those pages
 * renders its title fractionally wider than the migrated surfaces do. The
 * spacing moves to the flex `gap` rather than a trailing margin, so the header
 * composes instead of pushing.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

// -----------------------------------------------------------------------------
// The live strip
// -----------------------------------------------------------------------------

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px rather than floored, and `HEIGHT` is what the
 * skeleton imports so it mirrors the pin BY REFERENCE rather than by a restated
 * number (The Skeleton-Mirror Rule). The retired strip had no height at all —
 * four `p-4` blocks whose skeleton guessed `h-16` — so the handoff jumped by
 * whatever the tallest tile happened to resolve to that render.
 *
 * `BODY` is the ONLY body fill, with no `tone` prop anywhere to override it.
 * Making the wrong thing unreachable is cheaper than a comment asking nobody to
 * do it.
 */
export const TILE = {
  /** Container queries, never viewport breakpoints (finding 14). */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  BODY: "bg-surface-container text-on-surface",
  DISC: "relative grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The lucide glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /**
   * `tabular-nums` in the UI face and NEVER `font-mono`. A packet count and an
   * uptime are live measurements, not identifiers the device emits verbatim,
   * which is the only thing the Machine-Voice Rule sends to mono.
   */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  VALUE_TEXT: "truncate",
  CAPTION: "text-on-surface-variant truncate text-xs",
  /** A figure with no reading. An em dash reads as an absence in all five locales. */
  NONE: "—",
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
 * Keyed by TONE rather than by engine status, because two different tiles read
 * from it and they do not share a state machine: the engine tile maps a
 * `DpiEngineStatus`, the rule tile maps a boolean.
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
 * The tone transition for the two discs that change at runtime.
 *
 * Scoped to two properties, never `transition-all` — a bare `transition-all`
 * silently inherits Tailwind's 150ms, which is off the scale and will not
 * retune with it. The duration and easing are read from the custom properties
 * through the PARENTHESIS arbitrary form, not the bracket one: Tailwind v4
 * dropped the bare-var bracket shorthand, and that spelling
 * now compiles to a declaration whose value is the property NAME rather than
 * its value — a declaration that parses, so nothing warns, and that the browser discards, so it ships as no
 * transition at all. The class is still generated, so grepping the class name
 * finds it and tsc / eslint / next build all pass; only the emitted value tells.
 */
export const DISC_TRANSITION =
  "transition-colors duration-(--duration-standard) ease-standard";

/**
 * The ONE ambient loop on this surface (The One-Loop Rule).
 *
 * A ring that expands past the engine disc and fades, gated on the engine
 * genuinely running — not on the page having loaded, and not on a mode being
 * configured. `animate-live-ping` is the canon timing from `globals.css`
 * (`--duration-ambient` / `--ease-ambient`, no `alternate`, because a radar
 * sweep only travels outward) and it carries its own reduced-motion guard
 * there. `currentColor` inherits the disc's own foreground, so the ring is the
 * disc's colour by construction rather than by a second token that could drift
 * away from it.
 */
export const DISC_RING =
  "animate-live-ping pointer-events-none absolute inset-0 rounded-pill border-2 border-current";

/**
 * Status-chip tones for the engine, keyed onto the exported `BadgeVariant` type
 * rather than onto a class string.
 *
 * That is the whole point of the annotation: a new `DpiEngineStatus` without a
 * matching role fails the BUILD, where a `Record<string, string>` would render
 * an untinted chip and ship. This replaces `ENGINE_TONE`, whose `stopped` entry
 * paired `variant="outline"` with a hand-written wash — an outline badge doing
 * status work, which is finding 05, and a reimplementation of `variant="muted"`,
 * which is finding 03.
 *
 * `muted` is the correct role for a deliberately inactive state and is used
 * here on purpose: Stopped is a choice the user made, not a failure.
 */
export const ENGINE_BADGE: Record<DpiEngineStatus, BadgeVariant> = {
  running: "success",
  restarting: "warning",
  error: "destructive",
  stopped: "muted",
};

/**
 * The glyph inside a status chip. 12px, matching the chip's own text step.
 *
 * Every chip on this surface carries one, and no two states in the same slot
 * share a glyph: `success-container` and `warning-container` measure 1.03:1
 * apart — the same surface to the eye, and identical under deuteranopia — so
 * the glyph is the only thing separating a healthy state from a degraded one.
 */
export const CHIP_GLYPH = "size-3";

// -----------------------------------------------------------------------------
// The mode selector
// -----------------------------------------------------------------------------

/**
 * One row of the three-way mode choice.
 *
 * This is Call A of the approved proposal. The two modes are backend-enforced
 * MUTUALLY EXCLUSIVE (docs/reference/dpi.md > Modes) and the page drew them as
 * Tabs — which say "two independent panes you may browse" — so the exclusivity
 * surfaced only as a surprise `AlertDialog` at the instant a switch was
 * flipped. A radiogroup says the true thing about the model in its shape, and
 * the takeover confirm changes job: it now guards "this restarts the engine",
 * not "this silently disables the other mode".
 *
 * The selected row is `primary-container` per Highlight-by-Container — the
 * selection is carried by the CONTAINER, never by a ring drawn around a block.
 * There is no `min-h` here on purpose (see the header): the hint wraps to two
 * lines on a narrow container, and padding is what should decide the height.
 */
export const CHOICE_ROW = {
  GROUP: "flex flex-col gap-2",
  ROOT: "flex w-full items-center gap-3.5 rounded-pill px-4.5 py-3.5 text-left transition-colors duration-(--duration-standard) ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
  UNSELECTED: "bg-surface-container text-on-surface",
  SELECTED: "bg-primary-container text-on-primary-container",
  /**
   * The radio mark, drawn in `currentColor` so it is the row's own ink in both
   * states rather than a second token that could drift from the container it
   * sits on.
   */
  MARK: "grid size-5 flex-none place-items-center rounded-pill border-2 border-current transition-opacity duration-(--duration-quick) ease-standard",
  MARK_IDLE: "opacity-55",
  MARK_ON: "opacity-100",
  MARK_DOT: "size-2.5 rounded-pill bg-current",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  NAME: "text-[0.9375rem] font-semibold",
  /**
   * The consequence sentence, and it is REQUIRED on every row rather than
   * optional — it is what makes a mode row a decision instead of a label. On
   * the selected row it inherits `on-primary-container`; on an unselected one
   * it takes the ink token, never `text-muted-foreground` (finding 13).
   */
  HINT: "text-[0.8125rem] leading-relaxed text-pretty",
  HINT_IDLE: "text-on-surface-variant",
  RIGHT: "ml-auto flex flex-none items-center gap-2",
  GLYPH: "size-[1.125rem]",
} as const;

// -----------------------------------------------------------------------------
// The verify comparison
// -----------------------------------------------------------------------------

/**
 * One comparison row, on ONE shared 0-100 scale.
 *
 * This is Call B, and it upholds a canon component rather than inventing one:
 * `components/cellular/antenna-alignment/recorder-card.tsx` already ships this
 * exact shape for "which of these won", including the winner promotion and the
 * ramp-ink drop. Finding 18 is that the surface whose entire purpose is that
 * question drew it as three `justify-between` rows inside a stock `Alert`, so
 * the answer had to be read by comparing three numerals by eye.
 *
 * `WINNER` is `primary-container` per Highlight-by-Container. Its numeral drops
 * the ramp ink and inherits `on-primary-container`, because `--quality-N` is
 * computed for 4.5:1 against a CARD ground, not against `primary-container`,
 * and in dark mode a bright ramp ink on a deep-blue container is the weakest
 * pair on the surface. Quality is still carried there by BAR LENGTH, which is
 * the non-chromatic channel the rule actually requires.
 *
 * ONE DEVIATION FROM THE COMP, STATED RATHER THAN HIDDEN. The comp paints the
 * winning row's bar fill in `on-primary-container` via `color-mix`. `MetricBar`
 * cannot express that without minting a new tone on a SHARED primitive to
 * satisfy one call site — which is the exact mistake `metric-bar.tsx`'s own
 * header records having made once and removed ("a tone added to a shared
 * primitive to satisfy one call site inherits that call site's mistake, and
 * outlives it"). So the winner keeps its ramp fill, and the row's promotion is
 * carried by the container and the ink alone. The track stays
 * `surface-container-high` on every row including the winner's; the measured
 * reason that it is NOT switched to `muted` there is in `verify-card.tsx`,
 * beside the call.
 */
export const CMP_ROW = {
  STACK: "flex flex-col gap-2",
  /**
   * THE ROW WRAPS BELOW `@lg/card`, AND THAT IS NOT COSMETIC.
   *
   * Measured at a 375px viewport, where the card's inner width is ~303px: a
   * fixed 116px label plus the verdict chip plus its gaps left the lane about
   * 60px, so all three bars collapsed to stubs of near-identical length and the
   * chip overlapped the unit. The one thing the row exists to do — carry the
   * comparison in bar LENGTH — was the first thing the layout dropped.
   *
   * Wrapped, the lane takes a full line of its own (`order-last basis-full`)
   * with the label and chip sharing the line above it, so the bars keep the
   * full card width at every size. The radius follows the shape: a pill on a
   * two-line box reads as a stadium, so it is `rounded-tile` until the row is
   * actually one line.
   */
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tile px-5 py-3.5 transition-colors duration-(--duration-standard) ease-standard @lg/card:flex-nowrap @lg/card:rounded-pill @lg/card:py-3",
  NEUTRAL: "bg-surface-container text-on-surface",
  WINNER: "bg-primary-container text-on-primary-container",
  LABEL: "text-[0.8125rem] font-semibold @lg/card:w-[7.25rem] @lg/card:flex-none",
  LABEL_IDLE: "text-on-surface-variant",
  LANE: "order-last flex w-full min-w-0 basis-full flex-col gap-[7px] @lg/card:order-none @lg/card:w-auto @lg/card:flex-1 @lg/card:basis-auto",
  NUM: "text-[1.0625rem] font-semibold tracking-[-0.01em] tabular-nums",
  UNIT: "ml-1 text-xs font-medium opacity-75",
  RIGHT: "ml-auto flex flex-none items-center",
} as const;

/**
 * The headline figure above the comparison: the improvement factor.
 *
 * `success-on-surface` is INK on a neutral card ground, which is the system's
 * primary mechanism for colour — not a fill, and not a container. The figure is
 * only ever drawn when the comparison completed, so there is no state where it
 * reports a verdict it does not have.
 */
export const HEADLINE = {
  ROOT: "flex flex-wrap items-baseline gap-3",
  BIG: "text-success-on-surface text-4xl font-bold tracking-[-0.03em] tabular-nums",
  SUB: "text-on-surface-variant text-sm",
} as const;

// -----------------------------------------------------------------------------
// The target hostlist
// -----------------------------------------------------------------------------

/**
 * One domain row.
 *
 * The domain itself IS a machine string — a name matched byte-for-byte against
 * the SNI on the wire — so this is one of the places the Machine-Voice Rule
 * genuinely sends text to `font-mono`. The count beside the card title is not:
 * it is a quantity, so it stays in the UI face with `tabular-nums`.
 */
export const HOST_ROW = {
  /**
   * The scroll viewport, and the answer to BOTH halves of one report: the list
   * "takes a lot of vertical AND horizontal space".
   *
   * They are one shape. A domain is eleven characters and the chip was a full
   * card width, so at any desktop size most of every row was empty pill — and
   * 21 of them stacked ran past 900px. `GRID` reclaims the horizontal run by
   * flowing chips into columns; this caps the vertical.
   *
   * THE CAP IS A CEILING, NOT A HEIGHT. 5 grid rows: five 40px rows plus four
   * 6px gaps is 224px, which is `max-h-56`. A short list still collapses well
   * under it — twelve domains in three columns is four rows, 184px, against
   * ~550px stacked — so this is not a floor wearing a cap's clothes. The
   * numbers are derived from `ROOT` and `GRID` below and move with them.
   *
   * The gutter pair (`-mr-2` / `pr-2`) gives the scrollbar its own lane so a
   * chip never sits underneath the thumb; `custom-profile-view.tsx` uses the
   * same trick for the same reason.
   *
   * THE SCROLLBAR IS THEMED HERE BECAUSE NOTHING THEMES IT GLOBALLY. There is
   * no `::-webkit-scrollbar` or `scrollbar-color` anywhere in `globals.css`,
   * and two other files have already worked around that ad hoc with a bare
   * thin-width declaration. A native scrollbar inside a `rounded-card` surface
   * is exactly the "browser surface that belongs to no design system" the
   * craft floor names. Scoped here rather than fixed product-wide, because a
   * global scrollbar token is a product decision and this is a polish pass —
   * but it is a real gap and it is logged as one.
   *
   * The thumb takes `surface-container-high`: light 0.938 and dark 0.235,
   * against a card ground of 1.000 and 0.170. Visible in both themes, one step
   * from the ground in both, and the same value the chips' own hover fill uses.
   * A `var()` that did not resolve would ship as no declaration at all with no
   * error anywhere, which is why the token is named rather than guessed.
   */
  VIEWPORT:
    "-mr-2 max-h-56 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin] [scrollbar-color:var(--color-surface-container-high)_transparent]",
  /**
   * The chip grid. Container queries against the CARD, never the viewport, so
   * the column count follows the card's real width — which now changes with
   * `CARD_PAIR` above it, not only with the window.
   */
  GRID: "grid grid-cols-1 gap-1.5 @xl/card:grid-cols-2 @3xl/card:grid-cols-3",
  /**
   * PINNED at 40px, and safe to pin because the domain truncates. `HEIGHT` is
   * what the skeleton imports, so the list mirrors by reference rather than by
   * a restated number — the same rule the tile follows, for the same reason.
   */
  ROOT: "flex h-10 items-center gap-2.5 rounded-pill bg-surface-container pr-2 pl-4",
  HEIGHT: "h-10",
  TEXT: "min-w-0 flex-1 truncate font-mono text-[0.78125rem]",
  REMOVE:
    "size-8 flex-none rounded-pill text-on-surface-variant hover:bg-surface-container-high",
  GLYPH: "size-3.5",
} as const;

/**
 * How many rows the viewport shows before it scrolls.
 *
 * Exported so the skeleton renders the SAME count the cap is derived from,
 * rather than the four bare blocks it used to guess (The Skeleton-Mirror
 * Rule). Change this and `HOST_ROW.VIEWPORT`'s ceiling together.
 */
export const HOST_VISIBLE_ROWS = 5;

/**
 * The add-a-domain field.
 *
 * Handed to a raw `<input>`, deliberately NOT to the `Input` primitive.
 * `Input`'s base string carries `dark:bg-input/30` and `md:text-sm`, and `cn()`
 * cannot let an unprefixed class displace a variant-prefixed one — so the fill
 * silently reverts in dark mode, and the size reverts at a 768px VIEWPORT,
 * which is a viewport breakpoint leaking into a container-query surface. The
 * focus ring is folded in here so the next consumer cannot forget it.
 *
 * The fill is one step above its host: this field sits directly on the card's
 * `bg-surface`, so `surface-container` is host + 1 and the Field-Step Rule is
 * satisfied by the composition. On a borderless field the fill IS the whole
 * affordance; get the step wrong and the control renders at 1.00:1 against its
 * own background, with no edge at all.
 */
export const FIELD =
  "h-[2.625rem] w-full min-w-0 flex-1 rounded-field border-0 bg-surface-container px-4.5 font-mono text-sm text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The field and its Add button, side by side once the CARD is wide enough. */
export const FIELD_ROW = "flex flex-col gap-2.5 @lg/card:flex-row";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

/**
 * The card shell. A PEER, not the anchor: `rounded-card` (36px) and the whisper
 * shadow, which is the only card lift in the vocabulary and is never
 * load-bearing. `border-0` is explicit — a tonal surface never also carries a
 * hairline (The No-Hairline-On-Fill Rule).
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx` ships
 * `shadow-sm`, and `cn()` does NOT dedupe it against this one: `tailwind-merge`
 * cannot tell whether an arbitrary `shadow-` value is a box-shadow or a shadow COLOUR,
 * so an unresolvable `var()` lands in the colour group and both classes survive
 * the merge. Tailwind then compiles both to `--tw-shadow` and the winner is
 * emission order, which is its deterministic name sort — `shadow-[` sorts
 * before `shadow-s`, so the primitive's default is emitted LAST and wins. The
 * marker makes the whisper win by construction instead of by alphabet.
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

/** Header layout: titles left, one chip or pill pushed right. */
export const CARD_HEAD = {
  ROOT: "flex items-start gap-4",
  TITLES: "flex min-w-0 flex-col gap-1.5",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "ml-auto flex flex-none items-center gap-2",
  /**
   * The same header, for a card whose action group is more than one control.
   *
   * `ACTIONS` is `flex-none`, which is correct for a single chip and wrong for
   * four things: the group never shrinks, so on a narrow card it takes the
   * width it wants and `CARD_TITLE` — which WRAPS by design rather than
   * truncating — absorbs the whole loss. The targets card now carries a count
   * chip plus three list actions, so its group drops onto its own line instead
   * and only claims the right edge once the card is wide enough to give it one.
   */
  ROOT_WRAP: "flex flex-wrap items-start gap-x-4 gap-y-3",
  ACTIONS_WRAP: "flex flex-wrap items-center gap-2 @lg/card:ml-auto",
} as const;

/**
 * A quiet, icon-only card action. Import, export, restore.
 *
 * 40px, which is `HOST_ROW.ROOT`'s own height rather than a new number, and
 * comfortably above the row-level `REMOVE` control at 32px — a card-scoped
 * action should not be the same size as a per-row one. These are occasional
 * and secondary to the add-a-domain field, so they take the ghost treatment
 * and `on-surface-variant` ink; the primary action on this card is still the
 * one at the bottom with a fill behind it.
 *
 * Icon-only means the label lives in `aria-label` and a `title`, never in the
 * glyph alone. Three unlabelled icons in a row is a guessing game.
 */
export const ICON_ACTION =
  "size-10 flex-none rounded-pill text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface";

/**
 * The two-up band: the mode decision beside the test that measures it.
 *
 * Requested directly, and it does change this page's documented cadence — the
 * shell used to read strip, decision, what the decision operates on, then the
 * occasional test. It now reads decision beside measurement, then the payload.
 * The shell's own header comment is rewritten to say so; a file that describes
 * an order it no longer has is worse than one that describes none.
 *
 * `items-start` IS THE LOAD-BEARING PART. DESIGN.md does not ban equal heights
 * — it says they are explicit, and conditional on symmetry being a real
 * property of the pair. It is not one here. The verify card is a single
 * footnote line when idle and a headline plus three comparison bars when
 * complete, so a lock would strand dead space in whichever card had less to
 * say, and which one that is CHANGES while the test runs. That is precisely
 * the Radio Information failure DESIGN.md records having paid for once.
 *
 * WHY THE 5XL STEP AND NOT THE 6XL ONE. The container is the viewport less
 * 264px of sidebar, less 48px of main padding, less 16px of page padding. The
 * 6xl step (1152px) therefore needs a viewport past 1480px — a 1440px laptop,
 * the commonest desktop width there is, would never see this layout at all.
 * The 5xl step (1024px) needs 1352px, and its ~546px cells clear the 512px
 * threshold `CMP_ROW` uses to keep the comparison rows on one line. The cost
 * is a ~20px band of viewport widths where those rows take their already
 * designed wrapped layout, which is a layout and not a defect. The 5xl step is
 * also one this codebase already uses; the 6xl step appears nowhere in it.
 */
export const CARD_PAIR = "grid grid-cols-1 items-start gap-5 @5xl/main:grid-cols-2";

/**
 * The band's full-width member: the targets card, under the pair.
 *
 * It sits in the same grid rather than beside it so there is ONE source of
 * truth for the band's rows. Splitting it into a second container would let
 * the two gaps drift apart, which is the class of bug this module exists for.
 */
export const CARD_PAIR_WIDE = "@5xl/main:col-span-2";

/**
 * A settings row inside a card — the Force-TCP switch.
 *
 * The consequence sentence is required for the same reason it is on a mode row:
 * a switch with only a label is a field, and a switch with a consequence is a
 * decision.
 */
export const SETTING_ROW = {
  ROOT: "flex items-center gap-4",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  LABEL: "text-[0.9375rem] font-semibold",
  HINT: "text-on-surface-variant text-[0.8125rem] leading-relaxed text-pretty",
} as const;

/**
 * A footnote under a card's content — the sentence that keeps a reading honest
 * ("line speed is the reference; a slow result on all three is a slow
 * connection, not throttling").
 */
export const FOOTNOTE = "text-on-surface-variant text-[0.8125rem] leading-relaxed";

// -----------------------------------------------------------------------------
// The condition screen
// -----------------------------------------------------------------------------

/**
 * The full-card state screen: not installed, installing, uninstalling.
 *
 * The geometry is restated here rather than imported from
 * `components/cellular/condition-screen.tsx` — same rule as the tile box, and
 * the same reason. This is the ANCHOR of the page it appears on (there is no
 * strip above it, because there is no engine to report on yet), which is why it
 * is the one surface in the family wearing `rounded-hero`.
 *
 * `info` resolves to the brand ramp, per The Info-Is-Brand Rule: a saturated
 * brand blue and a saturated info blue cannot coexist without ambiguity.
 */
export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3.5 rounded-hero px-8 py-10 text-center",
  INFO: "bg-primary-container text-on-primary-container",
  DESTRUCTIVE: "bg-destructive-container text-on-destructive-container",
  DISC: "grid size-14 flex-none place-items-center rounded-pill",
  DISC_INFO: "bg-primary text-primary-foreground",
  DISC_DESTRUCTIVE: "bg-destructive text-destructive-foreground",
  GLYPH: "size-[1.625rem]",
  TITLE: "text-xl font-semibold tracking-[-0.01em]",
  /**
   * No ink wash. The comp draws this at 92% opacity, and an alpha on an
   * `on-*-container` ink is the exact compensation the ethernet re-author
   * deleted four of — it exists only to soften a token that is already measured
   * against the container it sits on. The ink is the ink.
   */
  BODY: "max-w-[44ch] text-sm leading-relaxed text-pretty",
  /**
   * The CTA's GEOMETRY only. The fill comes from the `Button` primitive's
   * default variant — a strong `bg-primary` on the `primary-container` ground,
   * which is the same pairing `bannerActionVariants` uses for its `primary`
   * tone on the same container. A `currentColor` alpha would have been a
   * request to whatever happens to be behind it rather than to a token.
   */
  ACTION: "mt-2 h-[2.625rem] gap-2 rounded-pill px-6 text-sm font-semibold",
} as const;

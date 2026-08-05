import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { BandCategory } from "@/types/band-locking";

// =============================================================================
// Band Locking — shared geometry and tone contract
// =============================================================================
// The single source of truth for this surface's shapes, tones and skeleton
// mirrors. Modelled on `components/cellular/custom-profiles/shapes.ts`, and for
// the same reason: the incumbent band-locking code declared its card shell in
// THREE places inside one file (the loading branch, the empty branch and the
// loaded branch of `band-cards.tsx`), so a radius fixed in one branch stayed
// wrong in the other two. Every consumer imports from here.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// Two kinds of object, and the incumbent layout said they were the same kind:
// it put a read-only status panel and three interactive control surfaces into
// one 2-column grid as visual peers.
//
//   1. THE HERO reports what the modem is doing right now — its lock posture,
//      the failover safety net, and the bands actually on air. Read-only except
//      for the one switch that arms the safety net.
//   2. THE CATEGORY CARDS are where you change it. One per AT parameter
//      (`lte_band`, `nsa_nr5g_band`, `nr5g_band`), which is also one per
//      genuinely distinct supported-band list from the modem.
//
// The hero earns `rounded-hero` under the Consistent-Layout Rule's "a genuine
// glance surface may earn a hero card" exception. It is the ONE hero on this
// page. A second one spends the exception twice.
//
// -----------------------------------------------------------------------------
// THE TWO-AXIS BAND CHIP (read before touching BAND_CHIP)
// -----------------------------------------------------------------------------
// The incumbent grid was a checkbox per band, which conflates two facts that
// are not the same fact:
//
//   SELECTED — what you have picked and have not applied yet. Local state.
//   LIVE     — what is actually configured on the modem right now, read back
//              from `ue_capability_band` via `current.sh`.
//
// A checkbox has one channel and there are two facts, so the incumbent grid
// could not show you a pending change at all. Once you clicked, the UI claimed
// the new state before the modem had it — a State-Honesty violation hiding
// inside a form control.
//
// The chip separates them onto two channels that do not interfere:
//
//   FILL carries SELECTED.  `primary-container` when picked, `surface-container`
//                           when not. Brand, not a functional role: a chosen
//                           band is not a *healthy* band, and the
//                           Identity-Never-Acts Rule keeps `nr`/`lte` out of a
//                           control's tone entirely.
//   RING carries LIVE.      A 2px inset `--primary` ring, present iff the band
//                           is configured on the modem at this moment.
//
// So the four combinations read directly, and the two pending ones — the states
// the incumbent could not express — are the interesting half:
//
//   fill + ring   already locked, staying locked
//   fill, no ring PENDING ADD — will be locked when you apply
//   ring, no fill PENDING REMOVAL — will be dropped when you apply
//   neither       not locked, staying that way
//
// WHY AN INSET SHADOW AND NOT A BORDER. Identical rationale to
// `PROFILE_ROW_ACTIVE_RING` in the custom-profiles contract: a real border adds
// a layout box, so every chip in the grid would shift by 2px the moment a lock
// landed and the grid would visibly reflow on every successful apply. An inset
// shadow costs no box, so a chip gaining or losing its ring is a pure paint.
//
// This is NOT a No-Hairline-On-Fill violation. That rule bans a stroke drawn to
// prop up a fill too weak to read alone. Here the fill reads fine on its own and
// carries a DIFFERENT fact; the ring is a second independent signal, not a
// crutch for the first.
//
// WHY `--primary` READS ON BOTH FILLS. The ring has to survive on
// `surface-container` and on `primary-container`, in both themes. It does,
// because `--primary` and `--primary-container` are far apart on the lightness
// axis in each theme and they move in opposite directions across the flip:
// light is L 0.488 on L 0.885, dark is L 0.79 on L 0.4. A ring drawn in
// `on-primary-container` instead would vanish against the container it sits on.
//
// -----------------------------------------------------------------------------
// THE TOUCH-TARGET FLOOR
// -----------------------------------------------------------------------------
// The incumbent target was a `size-4` checkbox: 16px, against the project's
// stated 44px minimum on coarse pointers. This page is used roadside on a
// tablet, in sun, on a device whose connection you are about to reconfigure.
//
// The chip paints at 40px — the metric-row-pill height, so a band chip and a
// glance row are visibly the same family — and a `before:` overlay expands the
// hit area to 44px without contributing a layout box. Same construction as the
// `Banner` dismiss button, and for the same reason: the target the finger gets
// and the box the grid lays out do not have to be the same rectangle.
// =============================================================================

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * The page's anchor card. `rounded-hero` (40px) — one per surface.
 *
 * `shadow-whisper` as a bare utility does NOT resolve; it must go through the
 * custom property, as written.
 */
export const BAND_HERO =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * One category card. `rounded-card` (36px) — a peer in a grid, never a second
 * hero. Imported by the loaded, loading AND empty branches so the three can
 * never again disagree about their own radius.
 */
export const BAND_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 24px on a peer card, 28px on the hero (baked into BAND_HERO). */
export const CARD_PAD = "px-6";

// -----------------------------------------------------------------------------
// The hero
// -----------------------------------------------------------------------------

/**
 * The hero's leading glyph disc. 52px, brand fill with its own `-foreground`
 * ink — the hero shell is plain `surface` rather than a container, so the disc
 * takes the FILL pair directly (a container tile would invert this).
 */
export const HERO_DISC =
  "grid size-13 flex-none place-items-center rounded-pill bg-primary text-primary-foreground";

/**
 * The eyebrow above the lock-posture line.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * because the committed world ships one: DESIGN.md's tile anatomy is literally
 * `eyebrow -> value -> caption`, and the custom-profiles hero already carries
 * the identical step. The committed world outranks a generic default, and the
 * label earns itself here — "Locked to 4 of 21 bands" alone does not say
 * whether you are reading the modem's state or your own pending selection, and
 * on this page those are different numbers.
 */
export const HERO_EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

/** The posture value under the eyebrow. Headline step. */
export const HERO_VALUE = "text-xl font-semibold tracking-[-0.01em]";

/**
 * The failover row. `rounded-field` (20px) rather than a metric-row pill,
 * because this row WRAPS: it carries a label, a help affordance, a switch and a
 * status chip, and on a narrow container those fall to a second line. A pill
 * that has wrapped to two lines is a stadium, not a pill, and the
 * Radius-Follows-Size Rule puts a two-line block on the field step.
 */
export const HERO_ROW = "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-field bg-surface-container px-4 py-3";

/** The "on air now" block under the failover row. */
export const HERO_ONAIR = {
  ROOT: "flex flex-col gap-2.5",
  /** Chips wrap; the row never scrolls horizontally. */
  LIST: "flex flex-wrap items-center gap-2",
} as const;

// -----------------------------------------------------------------------------
// The band chip
// -----------------------------------------------------------------------------

/**
 * The live ring: 2px inset, brand. Present iff the band is configured on the
 * modem right now. See THE TWO-AXIS BAND CHIP above for why this is a shadow
 * and not a border.
 */
export const BAND_CHIP_LIVE_RING = "shadow-[inset_0_0_0_2px_var(--primary)]";

export const BAND_CHIP = {
  /** The grid wrapper. Wraps rather than scrolls — a hidden band is an unlockable band. */
  GRID: "flex flex-wrap gap-2",
  /**
   * One chip.
   *
   * `h-10` is the paint; the `before:` overlay is the 44px hit target (see THE
   * TOUCH-TARGET FLOOR). `min-w-[3.5rem]` keeps "B1" and "B12" the same width so
   * the grid does not comb.
   *
   * Mono + tabular: a band designator is a device identifier, which the
   * Machine-Voice Rule puts in the machine's typeface.
   *
   * The transition names its properties rather than using `transition-all`: the
   * chip changes fill, ink and ring, and `transition-all` with no duration
   * silently inherits Tailwind's off-scale 150ms (The One-Scale Rule).
   */
  ROOT: [
    "relative inline-flex h-10 min-w-[3.5rem] items-center justify-center rounded-pill px-3.5",
    "font-mono text-[0.8125rem] font-semibold tabular-nums select-none",
    "transition-[color,background-color,box-shadow] duration-[var(--duration-standard)] ease-standard",
    "before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-['']",
    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ].join(" "),
  /** Skeleton mirror. Same height and minimum width as a real chip. */
  SKELETON: "h-10 w-[3.5rem] rounded-pill",
} as const;

/**
 * Chip fill by SELECTED state. Brand container, never a functional role — a
 * band you picked is not a band that is healthy, and `nr`/`lte` are identity
 * tones that the Identity-Never-Acts Rule keeps out of controls entirely.
 *
 * The unselected fill is `surface-container`, one step off the card, so the
 * grid reads as a field of blocks rather than as text floating on the card.
 *
 * BOTH hovers are `enabled:`-scoped. Tailwind's `hover:` does not exclude a
 * disabled element on its own, so an unscoped hover would light up every chip
 * on a scenario-gated card — advertising an interaction that is switched off,
 * which is the same class of lie as a status chip claiming a state the device
 * is not in.
 *
 * The selected hover is an alpha on the container, matching what
 * `components/ui/badge.tsx` already does for every tonal chip in the product.
 * That is the one sanctioned place for an alpha on a fill here: it is a
 * transient pointer tint on a surface whose resting colour is still the token,
 * not a compensation for a mismatched pair.
 */
export function bandChipFill(selected: boolean): string {
  return selected
    ? "bg-primary-container text-on-primary-container enabled:hover:bg-primary-container/80"
    : "bg-surface-container text-on-surface-variant enabled:hover:bg-surface-container-high";
}

/**
 * The full chip class for a given (selected, live) pair.
 *
 * Both facts are also announced non-visually — see `bandChipA11yKey`, which
 * resolves to a distinct sentence per state. The ring is a shape signal rather
 * than a colour one, so it survives grayscale and every colour-vision
 * deficiency, but a screen reader gets the words regardless.
 */
export function bandChipClass(selected: boolean, live: boolean): string {
  return [
    BAND_CHIP.ROOT,
    bandChipFill(selected),
    live ? BAND_CHIP_LIVE_RING : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The i18n key describing a chip's state to assistive technology. Three
 * sentences, not a colour: "selected", "not selected", "selected and active on
 * the modem". A pending removal (live, not selected) reads as "not selected",
 * which is the truthful description of what applying would do.
 */
export function bandChipA11yKey(selected: boolean, live: boolean): string {
  if (selected && live) return "band_locking.a11y.band_live";
  return selected
    ? "band_locking.a11y.band_selected"
    : "band_locking.a11y.band_unselected";
}

/** The legend under a grid that has at least one live band. */
export const BAND_LEGEND = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant",
  ITEM: "inline-flex items-center gap-1.5",
  /** The swatch that stands in for a selected chip. */
  SWATCH_SELECTED: "size-3 rounded-pill bg-primary-container",
  /** The swatch that stands in for a live chip — ring only, no fill. */
  SWATCH_LIVE: `size-3 rounded-pill bg-surface-container ${BAND_CHIP_LIVE_RING}`,
} as const;

// -----------------------------------------------------------------------------
// Inline notice (the category card's error slot)
// -----------------------------------------------------------------------------

/**
 * The card-scoped error notice.
 *
 * This replaces the surface's single loudest legacy tell:
 * `bg-destructive/10 border border-destructive/30 text-destructive` — an
 * opacity wash propped up by a hairline drawn to compensate for it. A 10% alpha
 * over a tinted surface is not a stable colour: it collapses in dark mode and it
 * is the first thing to wash out in sunlight, which is the exact ambient
 * condition this product is designed against.
 *
 * `rounded-field` (20px) so it never out-rounds the 36px card hosting it.
 */
export const NOTICE = {
  ROOT: "flex items-start gap-3 rounded-field px-4 py-3 text-sm",
  /** Glyph-Disc Rule: the icon sits in a filled circle on the role's STRONG fill. */
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
} as const;

export const NOTICE_TONE = {
  fill: "bg-destructive-container text-on-destructive-container",
  disc: "bg-destructive text-destructive-foreground",
  glyph: "error" as MaterialSymbolName,
};

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * The action pill. Identical string to `radio/page-header.tsx`'s `PILL_ACTION`
 * and the custom-profiles contract — restated rather than imported so this
 * surface takes no dependency on an unrelated route's module graph.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The same pill without a leading-glyph gap, for a text-only action. */
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";

/**
 * The quick-select affordances (Select all / Clear). Deliberately smaller and
 * quieter than the two real actions: they change a selection, they do not write
 * to the modem, and sizing them like `Apply` would put three equal-weight pills
 * in one footer and lose which of them is consequential.
 */
export const PILL_QUIET =
  "h-9 rounded-pill px-3.5 text-xs font-semibold text-on-surface-variant";

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

/**
 * Failover state -> Badge variant + glyph.
 *
 * Keyed onto `BadgeVariant` rather than a class string, so a fifth state
 * without a matching role fails the build instead of shipping untinted.
 *
 * Every state carries a DISTINCT glyph. `ready` and `fallback` are the pair
 * that makes this mandatory rather than tidy: `success-container` and
 * `warning-container` measure 1.03:1 apart and are the SAME surface under
 * deuteranopia, so the glyph is the only channel separating "the safety net is
 * armed" from "the safety net has fired and your lock is not in force".
 */
export const FAILOVER_BADGE: Record<
  "disabled" | "fallback" | "monitoring" | "ready",
  { variant: BadgeVariant; glyph: MaterialSymbolName; spin?: boolean }
> = {
  // Deliberately off, not broken. `muted`, never `destructive`.
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  // Degraded but running: the modem is connected, just not where you told it.
  fallback: { variant: "warning", glyph: "warning" },
  // In progress routes to the BRAND container (the Info-Is-Brand Rule), so a
  // monitoring chip and a primary button differ by shape and glyph rather than
  // by owning two different blues.
  monitoring: { variant: "info", glyph: "progress_activity", spin: true },
  ready: { variant: "success", glyph: "check_circle" },
};

/**
 * Category-card status -> Badge variant + glyph.
 *
 * `unrestricted` is `success` and `locked` is `warning`, which is a deliberate
 * reading of the functional contract rather than a value judgement about
 * locking: a narrowed band list is the state that can cost you the connection,
 * and `warning` means "degraded / constrained", not "you did something wrong".
 * `scenario` is `info` because something else owns the setting right now — a
 * standing condition, not a fault.
 */
export const CATEGORY_BADGE: Record<
  "scenario" | "unrestricted" | "locked",
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  scenario: { variant: "info", glyph: "shield" },
  unrestricted: { variant: "success", glyph: "lock_open" },
  locked: { variant: "warning", glyph: "lock" },
};

/** Badge glyph size. Matches the `[&>svg]:size-3` slot `Badge` reserves. */
export const BADGE_GLYPH_SIZE = 12;

/**
 * The hero's leading glyph, by posture. `settings_input_antenna` for a
 * constrained radio, `cell_tower` for an unconstrained one — two distinct
 * glyphs, because the disc is a single-slot indicator and two states in one
 * slot must never share a mark.
 *
 * Both are already in the subset allowlist (`components/ui/material-symbol-names.ts`),
 * so this surface needs no font regeneration — which matters, because
 * `icons:subset` fetches from Google and cannot run offline.
 */
export const POSTURE_GLYPH: Record<
  "locked" | "unrestricted" | "unknown",
  MaterialSymbolName
> = {
  locked: "settings_input_antenna",
  unrestricted: "cell_tower",
  unknown: "schedule",
};

// -----------------------------------------------------------------------------
// Skeleton mirrors
// -----------------------------------------------------------------------------

/**
 * Loaded geometry, restated once so the skeletons can mirror it by IMPORT
 * rather than by estimate. The incumbent loading branch guessed `h-9 w-40` for a
 * footer button that renders at 42px, and `size-4` slivers for a control that no
 * longer exists — a skeleton that mirrors nothing makes the handoff jump worse,
 * not better.
 *
 * Sizes are the loaded element's LINE BOX, not its font size: a skeleton sized
 * to the glyph reflows the moment real text lands.
 */
export const SKELETON_SHAPE = {
  /** Card title (18px/600) and description (14px) line boxes. */
  CARD_TITLE: "h-5 w-28",
  CARD_DESC: "h-4 w-52",
  /** The status chip in a card header. */
  CARD_CHIP: "h-5 w-24",
  /** One band chip. */
  CHIP: BAND_CHIP.SKELETON,
  /** How many chip placeholders a loading grid draws. */
  CHIP_COUNT: 12,
  /** The footer's primary action, at the real 42px pill height. */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-44 rounded-pill",
  /** Hero: disc, eyebrow, posture value. */
  HERO_DISC: "size-13 rounded-pill",
  HERO_EYEBROW: "h-3 w-24",
  HERO_VALUE: "h-6 w-56",
  /** Hero: the failover row and one on-air chip. */
  HERO_ROW: "h-[3.25rem] w-full rounded-field",
  ONAIR_CHIP: "h-5 w-14 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// Category identity
// -----------------------------------------------------------------------------

/**
 * The i18n key stem for a category's card copy and its short name.
 *
 * THIS EXISTS TO KILL A TRANSLATION-INDUCED BUG. The incumbent built toast copy
 * by string surgery on the rendered English title:
 *
 *     toast.success(`${title.replace(" Locking", "")} bands locked successfully`)
 *
 * The moment those titles are translated — which is the first thing any i18n
 * pass does, because they are the most visible strings on the page — the
 * `.replace()` stops matching and the toast reads "LTE Band Locking bands locked
 * successfully" in English beside a translated title. No gate can see that:
 * `i18n:check` grades missing keys as warnings and exits 0, and a literal has no
 * key to be missing in the first place.
 *
 * Keying the short name off the CATEGORY instead of off the rendered title means
 * the two can never drift, in any locale.
 */
export function categoryTitleKey(category: BandCategory): string {
  return `band_locking.categories.${category}.title`;
}

export function categoryDescriptionKey(category: BandCategory): string {
  return `band_locking.categories.${category}.description`;
}

export function categoryShortKey(category: BandCategory): string {
  return `band_locking.short.${category}`;
}

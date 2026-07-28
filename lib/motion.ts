import type { Variants, Transition } from "motion/react";

// =============================================================================
// QManager Motion System — the project's single source of truth for motion.
// =============================================================================
// Every animation in the app settles on the same curves, drawn from the same
// duration scale, so the whole product feels like one instrument. Reach for
// these tokens before writing a bespoke transition, and add new shared motion
// here rather than re-deriving a curve locally.
//
// Character (per DESIGN.md > Motion): expressive in duration and curve, and
// still settled. The expressiveness comes from the easing, never from
// overshoot, which is what keeps it compatible with a tool whose job is holding
// a connection alive. The one sanctioned exception in the entire product is the
// save-confirmation check at 1.03 scale. Never springy, never elastic.
//
// These values mirror the CSS custom properties in `app/globals.css`
// (--ease-emphasized, --ease-standard, --duration-*, --stagger-step). The CSS
// layer is authoritative for anything styled in a class; this module exists
// because `motion/react` transitions need the same values as JS numbers. If you
// retune one layer, retune the other in the same change, or the product drifts
// apart curve by curve.
//
// Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`
// in `components/motion-provider.tsx`, so every motion/react component below
// automatically collapses transform movement (keeping opacity) for users who
// ask for it. Keep variants here pure transform + opacity so that one switch
// stays sufficient. Raw CSS keyframes carry their own
// `@media (prefers-reduced-motion: reduce)` block beside them in globals.css.
// =============================================================================

// -----------------------------------------------------------------------------
// Easing
// -----------------------------------------------------------------------------

/**
 * The expressive curve: a deliberate departure and a long settle. Owns
 * container size and shape changes, the aggregation chain re-proportioning, and
 * alert arrival — the moments that should be felt before they are read.
 *
 * Mirrors `--ease-emphasized`.
 */
export const EASE_EMPHASIZED = [0.05, 0.7, 0.1, 1] as const;

/**
 * The everyday curve, and the right default for a state change. Owns the nav
 * indicator, card entrance, meter fill, chip container morph, and the page
 * entrance in `components/app-layout.tsx`.
 *
 * Mirrors `--ease-standard`.
 */
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

/**
 * The short curve, for moves too brief to need shaping. Owns label swaps, live
 * value ticks, hover tints and focus rings. A plain ease-out, deliberately:
 * below ~180ms a bespoke cubic is indistinguishable from the built-in.
 *
 * Mirrors `--ease-quick`.
 */
export const EASE_QUICK = "easeOut" as const;

/** CSS-string equivalents, for Tailwind arbitrary values and plain transitions. */
export const EASE_EMPHASIZED_CSS = "cubic-bezier(0.05, 0.7, 0.1, 1)";
export const EASE_STANDARD_CSS = "cubic-bezier(0.2, 0, 0, 1)";

// -----------------------------------------------------------------------------
// Duration scale (seconds)
// -----------------------------------------------------------------------------

/**
 * Three steps, and they are the only durations product motion should use.
 * Seconds here because `motion/react` takes seconds; the CSS side of each value
 * is the matching `--duration-*` custom property, in milliseconds.
 *
 * The ambient loop (2s, service rings and the live ping dot) is deliberately
 * absent: it is CSS-only, lives on `--duration-ambient`, and nothing in JS
 * should be starting a continuous animation.
 */
export const DUR = {
  /** Label swaps, live value ticks, hover tints, focus rings. */
  quick: 0.18,
  /** Most state changes: card entrance, meter fill, nav, page entrance. */
  standard: 0.3,
  /** Container size and shape, aggregation re-proportion, alert arrival. */
  emphasized: 0.4,
} as const;

/** The card-cascade step. Mirrors `--stagger-step` (60ms). */
export const STAGGER_STEP = 0.06;

// -----------------------------------------------------------------------------
// Composed gestures
// -----------------------------------------------------------------------------

/**
 * The live value tick (Motion Guide recipe 06), as a *composition* of two
 * tokens rather than one.
 *
 * The guide files the tick under `quick`, and the shipped implementation read
 * that as "the whole gesture lasts 180ms". But a dip-and-return is two legs, so
 * one `quick` budget bought 90ms each way — under the ~100ms floor where the eye
 * reads a transition as a transition at all. The result was the blink the guide
 * spends its own copy warning against.
 *
 * The guide's own demo is the tell: `mg-tick` puts the dip at 12% of its cycle
 * and spends the remaining 88% returning. It is deliberately ASYMMETRIC — the
 * dip is the event, the return is the settle — and collapsing the recipe into a
 * single duration is what threw that away.
 *
 * So: `quick` down (the leg that carries the signal, still below conscious
 * notice), `standard` up (the leg that lets it land). No fifth token, and the
 * ratio is derived from the scale rather than dialled in by eye.
 */
export const TICK = {
  /** Peak dip. The guide's 35%, unchanged — this was never the problem. */
  opacity: 0.35,
  /** 180ms + 300ms. Total wall time of the gesture, in seconds. */
  duration: DUR.quick + DUR.standard,
  /** Where the dip sits: 180 / 480 = 0.375. Keep in sync with `duration`. */
  dipOffset: DUR.quick / (DUR.quick + DUR.standard),
} as const;

/**
 * Meter fill on FIRST PAINT (Motion Guide recipe 07).
 *
 * Distinct from `transitionStandard`, which still owns the poll retarget, and
 * the split is the point. A first paint travels 0 → full; a retarget moves a few
 * percent. Giving both the same 300ms clock is what made the fill read as a
 * snap: Material scales duration with distance, and this is the longest journey
 * a meter ever makes. `emphasized` is the top of the existing scale, so the
 * arrival gets the system's slowest curve without inventing a sixth value.
 */
export const transitionMeterFill: Transition = {
  duration: DUR.emphasized,
  ease: EASE_EMPHASIZED,
};

/**
 * The row-cascade step, for rows *inside* one card rather than cards across a
 * page. Deliberately denser: a cascade's total length is the step times the
 * child count, and a card holding a dozen metric rows would take most of a
 * second to finish at the card step, which reads as the card still loading.
 * The eye also groups rows inside a shared border as one object, so they should
 * arrive nearly together.
 */
export const STAGGER_STEP_ROWS = 0.04;

// -----------------------------------------------------------------------------
// Prebuilt transitions
// -----------------------------------------------------------------------------

/** The everyday transition: standard curve at the standard duration. */
export const transitionStandard: Transition = {
  duration: DUR.standard,
  ease: EASE_STANDARD,
};

/** The expressive transition, for size, shape and arrival. */
export const transitionEmphasized: Transition = {
  duration: DUR.emphasized,
  ease: EASE_EMPHASIZED,
};

// -----------------------------------------------------------------------------
// Variants
// -----------------------------------------------------------------------------

/**
 * Card cascade container — the parent of a card's content groups or a list.
 * Children settle in sequence one `STAGGER_STEP` apart. Pair with `staggerItem`
 * on each direct child.
 *
 * Keep the 60ms step. Wider and the last card feels late behind a slow poll,
 * which reads as the page still loading rather than as choreography.
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER_STEP },
  },
};

/**
 * Row cascade container — the dense sibling of `staggerContainer`, for a list
 * of rows within a single card (metric rows, test results, band rows, activity
 * entries). Same children, tighter step.
 *
 * Choosing between the two: if the children are cards, use `staggerContainer`;
 * if they are rows sharing one card's border, use this.
 */
export const staggerRows: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER_STEP_ROWS },
  },
};

/**
 * Card cascade item — content rises 10px into place on the standard curve. This
 * is the most-used entrance in the product and dozens of surfaces consume it by
 * reference, so its curve *is* the app's entrance feel. Change it here and the
 * whole app retunes at once.
 */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

/**
 * Row cascade item — the in-card sibling of `staggerItem`, and the child that
 * pairs with `staggerRows`. Same curve and duration; the rise is 5px rather
 * than 10px.
 *
 * The shorter travel is not a taste call. Rows inside one card sit at ~6px
 * spacing, so a 10px lift moves each row past its own neighbour's resting
 * position and the group reads as the card reflowing rather than as content
 * arriving. Cards sit in a 16px page gutter, where 10px still reads as a lift.
 *
 * Choosing between the two, restated from `staggerContainer`/`staggerRows`: if
 * the children are cards, `staggerItem`; if they are rows sharing one card's
 * border, this.
 */
export const staggerRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

// The route transition is deliberately NOT defined here. `components/app-layout.tsx`
// implements it inline, keyed on `pathname`, because it is a single site that
// needs no shared definition. It is enter-only by design: DESIGN.md forbids an
// exit animation on navigation, since the outgoing page is already gone and
// animating it out only delays the incoming one. A `pageVariants` export used to
// live here carrying both the retired curve and exactly that forbidden exit. It
// had no consumers, so it was removed rather than retuned.

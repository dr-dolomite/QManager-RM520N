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

// The route transition is deliberately NOT defined here. `components/app-layout.tsx`
// implements it inline, keyed on `pathname`, because it is a single site that
// needs no shared definition. It is enter-only by design: DESIGN.md forbids an
// exit animation on navigation, since the outgoing page is already gone and
// animating it out only delays the incoming one. A `pageVariants` export used to
// live here carrying both the retired curve and exactly that forbidden exit. It
// had no consumers, so it was removed rather than retuned.

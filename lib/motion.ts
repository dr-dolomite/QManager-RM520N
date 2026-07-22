import type { Variants, Transition } from "motion/react";

// =============================================================================
// QManager Motion System — the project's single source of truth for motion.
// =============================================================================
// Every animation in the app settles on the same curve, drawn from the same
// duration scale, so the whole product feels like one instrument. This is the
// reference layer: reach for these tokens before writing a bespoke transition,
// and add new shared motion here rather than re-deriving a curve locally.
//
// Character (per DESIGN.md): Apple instrument-class. Silky, exponential
// ease-out; never bouncy, never springy, never Material-pop. Motion conveys
// state — entrance, feedback, settle — not decoration.
//
// Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`
// at the app root, so every motion/react component below automatically
// collapses transform/layout movement (keeping opacity) for users who ask for
// it. Variants here stay pure transform + opacity so that global switch is all
// that's ever needed.
// =============================================================================

// -----------------------------------------------------------------------------
// Easing
// -----------------------------------------------------------------------------

/**
 * The reference curve. ease-out-expo: a fast departure and a long, gentle
 * settle that never overshoots — the feel of a Control Center toggle or a
 * macOS window coming to rest. Default to this for any state change.
 */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * A slightly gentler tail for short, frequent moves (button presses, small
 * swaps, exits) where the long expo settle would feel sluggish.
 */
export const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const;

/** CSS-string equivalents for Tailwind arbitrary values and plain transitions. */
export const EASE_OUT_EXPO_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_OUT_QUART_CSS = "cubic-bezier(0.25, 1, 0.5, 1)";

// -----------------------------------------------------------------------------
// Duration scale (seconds)
// -----------------------------------------------------------------------------

/**
 * Product motion lives between 150ms and 500ms. These four steps are the only
 * durations the system should use; anything slower reads as choreography the
 * user has to wait through, anything faster reads as a snap.
 */
export const DUR = {
  /** Presses, micro-feedback, live value swaps. */
  fast: 0.16,
  /** Most state transitions: hover, color shifts, toggles. */
  base: 0.24,
  /** Entrances and the page-content rise. */
  slow: 0.34,
  /** Determinate fills and the circular signal-meter arc. */
  slower: 0.5,
} as const;

// -----------------------------------------------------------------------------
// Prebuilt transitions
// -----------------------------------------------------------------------------

/** The everyday transition: reference curve at the base duration. */
export const transitionBase: Transition = {
  duration: DUR.base,
  ease: EASE_OUT_EXPO,
};

/** The entrance transition: reference curve at the slow duration. */
export const transitionSlow: Transition = {
  duration: DUR.slow,
  ease: EASE_OUT_EXPO,
};

// -----------------------------------------------------------------------------
// Variants
// -----------------------------------------------------------------------------

/**
 * Stagger container — the parent of a card's content groups or a list. Children
 * settle in sequence at a calm cadence. Pair with `itemVariants` on each child.
 */
export const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.055, delayChildren: 0.02 },
  },
};

/**
 * Fade-up entrance — content lifts 8px into place on the reference curve. This
 * is the most-used entrance in the product; dozens of surfaces consume it by
 * reference, so its curve *is* the app's entrance feel. Change it here and the
 * whole app retunes at once.
 */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.slow, ease: EASE_OUT_EXPO },
  },
};

/**
 * Route transition — the single most-felt motion in the product, fired on every
 * navigation. Incoming content rises 10px and settles on the reference curve;
 * outgoing content fades quickly out of the way first (drive with
 * `AnimatePresence mode="wait"`). Pure transform + opacity: no blur, no scale,
 * the quiet macOS System Settings pane-swap. Reduced motion drops the rise via
 * the global `MotionConfig` and leaves a clean cross-fade.
 */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.slow, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.12, ease: EASE_OUT_QUART },
  },
};

"use client";

import { motion } from "motion/react";
import { DUR, EASE_QUICK } from "@/lib/motion";

/**
 * Live value tick (DESIGN.md > Motion > "Live value tick"; Motion Guide recipe
 * 06): a 180ms opacity dip to 35% and back when the rendered text changes, and
 * nothing else. No fade-out-then-in, no slide, no colour flash — a value that
 * ticks every two seconds cannot afford a gesture.
 *
 * The dip is driven by remounting on a key derived from the value itself, so a
 * poll that returns the same string animates nothing. That is the whole
 * mechanism: there is no effect, no ref, and no timer to leak.
 *
 * The same dip is also the label half of the status-chip two-clock (DESIGN.md >
 * Motion > "Status chip swap"; Motion Guide recipe 05): the container morphs
 * its fill over `standard` via a CSS `transition-colors` while the label
 * crossfades over `quick` through this component, so a state change is felt
 * peripherally before it is read.
 *
 * Two preconditions the caller owns:
 *
 * 1. **`tabular-nums`, for numeric values.** The dip draws the eye to the value
 *    at the exact moment it changes, so proportional figures reflowing under it
 *    turn a quiet acknowledgement into visible jitter. Label swaps are exempt —
 *    a label changes on a real state change, not on every poll, so there is no
 *    per-tick jitter to amplify.
 * 2. **A stable box.** The tick animates ink, never layout. If the new string
 *    is wider than the old one the row still reflows instantly underneath the
 *    fade, which is the one thing this recipe is meant to avoid. Centre a label
 *    that can change width, or give a numeric value a fixed column.
 *
 * Opacity-only, so it survives `prefers-reduced-motion` intact (the global
 * `MotionConfig reducedMotion="user"` keeps opacity and drops movement) and
 * stays non-load-bearing: the final text is correct whether or not the dip ran.
 */
export function TickValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.35 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.quick, ease: EASE_QUICK }}
      className={className}
    >
      {value}
    </motion.span>
  );
}

export default TickValue;

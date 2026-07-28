"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { DUR, EASE_QUICK, STAGGER_STEP } from "@/lib/motion";

/**
 * The label half of the status chip morph (DESIGN.md > Motion, "Status chip
 * swap"; Motion Guide recipe 05).
 *
 * Recipe 05 runs on **two clocks**: the container's fill and ink morph over
 * `standard` (that half lives in `components/ui/badge.tsx`), while the label
 * crossfades over `quick`. The state change is felt peripherally through the
 * colour before it is read through the words.
 *
 * **This exists because the label half was shipping with one of its two legs
 * missing.** The pattern it replaces was a `motion.span` carrying a `key` and an
 * `initial`/`animate` pair, with no `AnimatePresence` around it. A keyed
 * remount outside `AnimatePresence` is not a crossfade: React drops the old node
 * in a single commit, so only the incoming label ever animated. The outgoing one
 * vanished in one frame — which is exactly the instant blink the recipe exists
 * to prevent, and no duration on the incoming leg could have fixed it.
 *
 * The guide's own demo carries both legs and gives them a direction:
 * `mg-chip-out` takes the old label up and out (−7px), `mg-chip-in` brings the
 * new one up from below (+7px). The vertical travel is what makes the swap read
 * as one label replacing another rather than as a flicker in place.
 *
 * Timing, composed from the existing scale rather than a new token:
 *
 * - Both legs run `quick` (180ms), which is the duration the guide files the
 *   label crossfade under.
 * - The incoming leg is delayed by one `--stagger-step` (60ms) so the two
 *   overlap rather than run in lockstep. Without the offset the outgoing and
 *   incoming labels cross at 50% opacity simultaneously and the chip reads
 *   muddy for a frame; with it, the exit leads and the entrance answers. Total
 *   wall time 240ms, still comfortably inside the 300ms container morph
 *   underneath, so the fill finishes last and the two clocks stay legible.
 *
 * `mode="popLayout"` pulls the exiting label out of layout flow, which is what
 * the guide's demo does by hand with `position:absolute` on the incoming span.
 * Without it the two labels would briefly stack and shove the chip taller.
 *
 * `initial={false}` keeps the first paint silent: a chip arriving with the card
 * is the entrance cascade's moment, and this should only ever report a *change*.
 * That matches `useValueTick`, which seeds its previous value for the same
 * reason.
 *
 * Reduced motion needs no branch here. `MotionConfig reducedMotion="user"`
 * (components/motion-provider.tsx) drops the transform and keeps the opacity, so
 * the gesture degrades to a plain crossfade — movement goes, opacity stays,
 * and a crossfade still carries the information that the state changed.
 */
export function SwapLabel({
  swapKey,
  className,
  children,
}: {
  /**
   * Changing this is what triggers the swap, so it must encode everything the
   * label renders — not just the state name. Two states that render the same
   * string should share a key, or the chip will animate a swap the user cannot
   * see.
   */
  swapKey: React.Key;
  /** Applied to the moving span, so callers keep their own gap and type scale. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={swapKey}
        initial={{ opacity: 0, y: 7 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: DUR.quick,
            ease: EASE_QUICK,
            delay: STAGGER_STEP,
          },
        }}
        exit={{
          opacity: 0,
          y: -7,
          transition: { duration: DUR.quick, ease: EASE_QUICK },
        }}
        // `inline-flex` rather than the default inline box: a transform on an
        // inline element is dropped outright, which would silently cost the
        // 7px travel and leave a bare opacity fade behind.
        className={cn("inline-flex items-center", className)}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

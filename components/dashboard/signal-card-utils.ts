import type { Variants } from "motion/react";
import { DUR, EASE_STANDARD } from "@/lib/motion";

/** Fade-up entrance for individual signal metric rows. Content arriving, so it
 *  takes `standard` rather than the emphasized curve reserved for container
 *  mass. The rise is 5px rather than the shared item's 10px: these rows sit
 *  inside one card at tight spacing, and a full 10px lift reads as the card
 *  reflowing. Pair with `staggerRows` on the parent. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

/**
 * Maps a signal quality level to a Tailwind text-color class.
 *
 * These are the `*-on-surface` variants, not the base fills: the values now sit
 * on a filled `surface-container` pill rather than on the plain card, and the
 * base `--success` / `--warning` tones are tuned to sit behind their own
 * foreground, not to be read as ink on a light tinted surface. The
 * `-on-surface` steps are the darkened pairs measured for exactly this case.
 */
export function getValueColorClass(quality: string): string {
  switch (quality) {
    case "excellent":
    case "good":
      return "text-success-on-surface";
    case "fair":
      return "text-warning-on-surface";
    case "poor":
      return "text-destructive-on-surface";
    default:
      return "";
  }
}

import type { Variants } from "motion/react";

/** Stagger container for signal metric rows. Denser than the 60ms card cascade
 *  because these are rows inside one card, not cards across a page. */
export const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

/** Fade-up entrance for individual metric rows. Content arriving, so it takes
 *  `standard` (300ms) rather than the 400ms reserved for container mass. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.2, 0, 0, 1] },
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

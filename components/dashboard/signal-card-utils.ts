// The row entrance that used to be declared here is now `staggerRowItem` in
// `lib/motion.ts`. It was never specific to signal cards — Device Information
// needed the same 5px in-card rise and reached for the 10px card variant
// instead, which is exactly the drift DESIGN.md's "single motion source" rule
// exists to prevent. Import it from the canon; this file keeps only the colour
// helper, which genuinely is signal-specific.

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

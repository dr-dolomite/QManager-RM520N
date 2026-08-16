// The row entrance that used to be declared here is now `staggerRowItem` in
// `lib/motion.ts`. It was never specific to signal cards — Device Information
// needed the same 5px in-card rise and reached for the 10px card variant
// instead, which is exactly the drift DESIGN.md's "single motion source" rule
// exists to prevent. Import it from the canon; this file keeps only the colour
// helper, which genuinely is signal-specific.

import { qualityInkClass } from "@/components/cellular/signal-quality-display";
import type { SignalQuality } from "@/types/modem-status";

/**
 * Maps a signal quality level to its NUMERAL ink class.
 *
 * Now a thin delegate to the canonical `qualityInkClass()`, which is the single
 * home for the five-stop signal quality ramp. It survives as its own export
 * only because five surfaces already import it by this name; new call sites
 * should reach for the canonical function directly.
 *
 * Two things changed when this moved onto the ramp:
 *
 *   · The healthy end no longer resolves to `--primary`. That token is
 *     simultaneously the brand, the only hue allowed to act, and 5G NR's
 *     identity, so "Good" was reporting an LTE reading in the 5G colour. The
 *     ramp contains no identity hue at all — that is the whole reason it was
 *     minted.
 *   · The parameter is `SignalQuality`, not `string`. The old signature had a
 *     `default:` arm returning `""` — an untinted figure inheriting whatever
 *     ink it happened to sit in, and a silent catch-all that swallowed the new
 *     `bad` stop instead of failing the build. A missing reading now returns a
 *     real token (`text-on-surface-variant`) via `none`.
 *
 * Ink and bar are a PAIR: adjacent ramp stops sit deliberately below the CVD
 * separation floor, so a tinted figure needs either a bar whose LENGTH carries
 * the same value or an `sr-only` quality word beside it.
 *
 * Callers that render an IDENTIFIER (band, EARFCN, PCI) must not call this at
 * all — pass no class rather than passing `"none"`, or a value with no
 * good-or-bad reading gets painted as a missing measurement.
 */
export function getValueColorClass(quality: SignalQuality): string {
  return qualityInkClass(quality);
}

import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { BadgeVariant } from "@/components/ui/badge";
import type { MetricBarTone } from "@/components/ui/metric-bar";
import type { SignalQuality } from "@/types/modem-status";

// =============================================================================
// Signal quality → display channels
// =============================================================================
// One home for the three mappings that turn a `SignalQuality` into something
// visible, so two per-antenna surfaces cannot disagree about what "fair" looks
// like. They are separated out because they are SYSTEM-level decisions that
// DESIGN.md legislates by name, not per-page taste:
//
//   glyph   — the Every-Chip-Has-A-Glyph Rule and the Identity-Chip Rule. The
//             non-chromatic channel, and on an identity-toned chip the ONLY
//             channel carrying quality.
//   variant — the Filled-Chip Rule. Keys onto the exported `BadgeVariant` type
//             rather than a class string, so a tone with no matching role fails
//             the build instead of rendering transparent.
//   tone    — the meter fill, likewise keyed onto `MetricBarTone`.
//
// NOTE: `antenna-statistics/tech-card.tsx` still carries its own private copies
// of all three (`QUALITY_GLYPH`, `verdictVariant`, `meterTone`). They are
// value-identical to these. This module is the canonical home and that file
// should adopt it the next time the antenna family is touched — it was left
// alone here only to keep a design migration from editing a shipped surface it
// had no other reason to open.
// =============================================================================

/**
 * The wedge ladder. Monotonically decreasing bar count, which is what lets
 * quality survive grayscale, deuteranopia, and a container fill washed out by
 * direct sunlight.
 *
 * The `signal_cellular_{1..4}_bar` family, never the `alt` family: `alt`'s
 * 1-bar mark is a 2×4px speck and the family has no 0-bar member at all, so
 * "poor" and "no reading" would collapse into the same glyph — precisely the
 * pair that most needs to be distinguishable here.
 */
export const QUALITY_GLYPH = {
  excellent: "signal_cellular_4_bar",
  good: "signal_cellular_3_bar",
  fair: "signal_cellular_2_bar",
  poor: "signal_cellular_1_bar",
  none: "signal_cellular_off",
} as const satisfies Record<SignalQuality, MaterialSymbolName>;

/**
 * Quality as a status-chip role.
 *
 * Excellent and Good deliberately share `success`: blue is simultaneously the
 * brand, the only hue that acts, and the 5G NR identity, so promoting
 * "excellent" to `primary` would put NR's identity on an LTE chip. The glyph
 * ladder separates the two tiers instead.
 */
export function qualityBadgeVariant(quality: SignalQuality): BadgeVariant {
  switch (quality) {
    case "excellent":
    case "good":
      return "success";
    case "fair":
      return "warning";
    case "poor":
      return "destructive";
    default:
      return "muted";
  }
}

/** Quality as a meter fill tone. */
export function qualityMeterTone(quality: SignalQuality): MetricBarTone {
  switch (quality) {
    case "excellent":
    case "good":
      return "success";
    case "fair":
      return "warning";
    default:
      return "destructive";
  }
}

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
// NOTE: `antenna-statistics/tech-card.tsx` used to carry value-identical private
// copies of all three (`QUALITY_GLYPH`, `verdictVariant`, `meterTone`). It
// adopted this module during the five-stop quality ramp migration, so every
// antenna surface — `tech-card.tsx`, `antenna-alignment/live-aim.tsx`,
// `antenna-alignment/port-strip.tsx` — now reads its glyph, chip role, meter
// tone and numeral ink from here. There are no private copies left in the
// family; do not re-introduce one.
//
// `cell-scanner/**` is deliberately NOT a consumer. It runs a separate 3-tier
// scale by design and its own comment forbids drive-by unification.
// =============================================================================

/**
 * The wedge ladder. Monotonically decreasing bar count, which is what lets
 * quality survive grayscale, deuteranopia, and a container fill washed out by
 * direct sunlight.
 *
 * The `signal_cellular_{0..4}_bar` family, never the `alt` family: `alt`'s
 * 1-bar mark is a 2×4px speck and the family has no 0-bar member at all, so
 * "poor" and "no reading" would collapse into the same glyph — precisely the
 * pair that most needs to be distinguishable here.
 *
 * `bad` took `signal_cellular_0_bar`, which had to be added to the font subset
 * for it. It could not borrow either neighbour: `signal_cellular_off` is
 * `none` ("nothing was measured"), and sharing `1_bar` with `poor` would put
 * two states in one slot behind one glyph. That matters more here than
 * anywhere else in the system, because `poor` and `bad` are ADJACENT ramp
 * stops and adjacent stops are deliberately below the colour separation floor
 * — strip the glyph and the two become genuinely indistinguishable, which is
 * exactly the "nudge the antenna" vs "it is pointing at a wall" call the fifth
 * level was minted to make.
 */
export const QUALITY_GLYPH = {
  excellent: "signal_cellular_4_bar",
  good: "signal_cellular_3_bar",
  fair: "signal_cellular_2_bar",
  poor: "signal_cellular_1_bar",
  bad: "signal_cellular_0_bar",
  none: "signal_cellular_off",
} as const satisfies Record<SignalQuality, MaterialSymbolName>;

/**
 * Quality as a status-chip role.
 *
 * Excellent and Good deliberately share `success`: blue is simultaneously the
 * brand, the only hue that acts, and the 5G NR identity, so promoting
 * "excellent" to `primary` would put NR's identity on an LTE chip. The glyph
 * ladder separates the two tiers instead.
 *
 * `poor` and `bad` likewise share `destructive`, for a structural reason
 * rather than a stylistic one: the five-stop ramp is a SCALE and lives on
 * numerals and bars, while chips are CATEGORIES and live on the functional
 * three plus `muted`. `BadgeVariant` has no fifth failure role and minting
 * `--quality-N-container` tokens to give it one is a token-layer change, not
 * part of this wave. The glyph ladder separates the two tiers here too, which
 * is precisely what the Every-Chip-Has-A-Glyph Rule is for.
 */
export function qualityBadgeVariant(quality: SignalQuality): BadgeVariant {
  switch (quality) {
    case "excellent":
    case "good":
      return "success";
    case "fair":
      return "warning";
    case "poor":
    case "bad":
      return "destructive";
    default:
      return "muted";
  }
}

/**
 * Quality as a meter fill tone — the five-stop ramp, in scale order.
 *
 * Returns `null` for `none`, and that is the API doing real work rather than
 * being fussy. A missing reading renders an EMPTY TRACK (DESIGN.md > Quality
 * bars), so there is no correct fill colour to return; making the absence a
 * `null` the caller has to handle stops a surface from quietly picking one.
 * The bug this replaces did exactly that — `active-bands-card.tsx` let `none`
 * fall through a `default:` arm to `success` and painted an unread antenna
 * green.
 *
 * Pair it with `value={null}` on `MetricBar`, which is what actually
 * suppresses the fill. This function only decides the colour.
 */
export function qualityMeterTone(quality: SignalQuality): MetricBarTone | null {
  switch (quality) {
    case "excellent":
      return "quality-5";
    case "good":
      return "quality-4";
    case "fair":
      return "quality-3";
    case "poor":
      return "quality-2";
    case "bad":
      return "quality-1";
    case "none":
      return null;
  }
}

/**
 * Quality as NUMERAL ink — the other half of the ramp (DESIGN.md > Metric
 * rows: "A value that carries quality takes its ramp ink here").
 *
 * `--quality-N` rather than `--quality-N-bar`: this is the text weight of the
 * stop, and in light mode stops 1–3 resolve to deep reds and browns because
 * 4.5:1 against a near-white ground caps those hues at L ≈ 0.50. That is a
 * gamut ceiling — do not "fix" it by brightening. Where the figure is large
 * enough to fall under the 3:1 threshold instead, use the `-bar` value as ink.
 *
 * Ink and bar are a PAIR. Colour alone is not an accessible channel and
 * adjacent ramp stops sit below the separation floor by design, so a tinted
 * numeral without a bar beside it — and without an `sr-only` quality word —
 * is a bug, not a shortcut.
 */
export function qualityInkClass(quality: SignalQuality): string {
  switch (quality) {
    case "excellent":
      return "text-quality-5";
    case "good":
      return "text-quality-4";
    case "fair":
      return "text-quality-3";
    case "poor":
      return "text-quality-2";
    case "bad":
      return "text-quality-1";
    case "none":
      // Not a ramp stop. A missing reading is neutral, never the bottom of the
      // scale: "we did not measure" is not "we measured something terrible".
      return "text-on-surface-variant";
  }
}

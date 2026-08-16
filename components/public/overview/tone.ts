import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { MetricBarTone } from "@/components/ui/metric-bar";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  type ConnectionState,
  type SignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";

// =============================================================================
// Overview splash — tone vocabulary
// =============================================================================
// Every map here is keyed on a UNION, never on a raw class string, so a new
// state without a matching role fails the build rather than rendering untinted.
//
// Two colour axes are kept deliberately separate, per DESIGN.md's
// Identity-Chip Rule:
//
//   · the band TAG carries IDENTITY    — the `nr` / `lte` outline tag, ink and
//     stroke only. It never means "healthy", and per the Two-Form Rule it is
//     never a large tinted container block.
//   · the METER and VALUE carry QUALITY — the five-stop signal quality ramp,
//     which contains NO identity hue at all. That is the point of the ramp:
//     these two channels used to run through a four-tone functional map whose
//     healthy end resolved to `--primary`, i.e. to 5G NR's own identity colour,
//     so an LTE-only visitor was shown "all good" in the 5G blue.
//
// The quality half of that vocabulary is NOT declared here. It lives in
// `components/cellular/signal-quality-display.ts`, which is the canonical map
// module for the whole product; the two thin wrappers below only fold in this
// surface's extra `reachable` axis so the splash and the app cannot drift about
// what "fair" looks like.
// =============================================================================

// Temperature warning thresholds — kept in sync with device-metrics.tsx
export const TEMP_WARN = 60; // °C
export const TEMP_DANGER = 75; // °C

export type TempBand = "unknown" | "normal" | "warn" | "danger";

export function temperatureBand(temp: number | null): TempBand {
  if (temp == null) return "unknown";
  if (temp >= TEMP_DANGER) return "danger";
  if (temp >= TEMP_WARN) return "warn";
  return "normal";
}

export type TranslateFn = (
  key: string,
  opts?: Record<string, unknown>,
) => string;

/** Per-band readout can show RSRP or SINR; thresholds switch with the metric. */
export type BandMetric = "rsrp" | "sinr";

export const BAND_METRICS: readonly BandMetric[] = ["rsrp", "sinr"] as const;

export const BAND_METRIC_THRESHOLDS: Record<BandMetric, SignalThresholds> = {
  rsrp: RSRP_THRESHOLDS,
  sinr: SINR_THRESHOLDS,
};

// ---------- Quality ramp (meters + numeric values) -------------------------

/**
 * Ink for a reading whose quality is not a ramp stop — an unreachable modem, or
 * a metric that was simply never measured. `muted` in DESIGN.md's sense:
 * deliberately inactive, and never live data. An unreachable modem is not a bad
 * reading, it is NO reading, so it must not be painted the bottom of the scale.
 */
const NO_READING_INK = "text-on-surface-variant";

/**
 * The ramp stops as meter-fill classes.
 *
 * `metric-bar.tsx` owns the same mapping privately and does not export it, so
 * this is the one place it is restated — the band meter is a hand-built 7px
 * `motion.div` (first-paint-only `scaleX`, staggered 40ms), not a `MetricBar`,
 * and swapping it for one would change both its geometry and its entrance.
 * Keying on `MetricBarTone` rather than on `SignalQuality` is what keeps that
 * restatement safe: the SOURCE of the tone stays `qualityMeterTone()`, so a
 * sixth ramp stop cannot be added on one side only.
 */
type QualityRampTone = Extract<MetricBarTone, `quality-${number}`>;

const RAMP_BAR_CLASS: Record<QualityRampTone, string> = {
  "quality-1": "bg-quality-1-bar",
  "quality-2": "bg-quality-2-bar",
  "quality-3": "bg-quality-3-bar",
  "quality-4": "bg-quality-4-bar",
  "quality-5": "bg-quality-5-bar",
};

function isRampTone(tone: MetricBarTone): tone is QualityRampTone {
  return tone in RAMP_BAR_CLASS;
}

/**
 * The ramp's NUMERAL ink for a reading, folding in this surface's `reachable`
 * axis. Straight through to the canonical `qualityInkClass()` otherwise.
 */
export function qualityValueClass(
  quality: SignalQuality,
  reachable: boolean,
): string {
  return reachable ? qualityInkClass(quality) : NO_READING_INK;
}

/**
 * The ramp's METER fill for a reading, or `null` when there is nothing to draw.
 *
 * `null` is the empty-track signal (DESIGN.md > Quality bars) and it is load-
 * bearing: `qualityMeterTone()` deliberately returns no colour for `none`, so a
 * caller that `??`-ed a fallback in would paint an unmeasured carrier a ramp
 * colour. Callers must suppress the fill ELEMENT, not draw a zero-length one —
 * a 0%-wide red bar labelled "−140 dBm" reads as a fault to go and fix.
 */
export function qualityBarClass(
  quality: SignalQuality,
  reachable: boolean,
): string | null {
  if (!reachable) return null;
  const tone = qualityMeterTone(quality);
  if (tone === null || !isRampTone(tone)) return null;
  return RAMP_BAR_CLASS[tone];
}

// ---------- Container tone (the status trio's filled tiles) ----------------

export type TileTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "destructive";

export const TILE_CLASSES: Record<TileTone, string> = {
  neutral: "bg-surface-container text-foreground",
  primary: "bg-primary-container text-on-primary-container",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
};

export interface TileVerdict {
  tone: TileTone;
  icon?: MaterialSymbolName;
}

/**
 * Overall = worst of RSRP/RSRQ/SINR. Because `success-container` and
 * `warning-container` measure ~1.03:1 apart — the same surface to the eye, and
 * identical under deuteranopia — no two states in one slot share a glyph.
 *
 * This is the CONTAINER axis, not the ramp: filled tonal tiles run on the
 * functional roles, which have no fifth failure step. `bad` therefore shares
 * `destructive` with `poor` — and consequently the glyph is the ONLY thing
 * separating the two here, which is exactly the rule above doing its job.
 * `signal_cellular_0_bar` is `bad`'s ramp glyph in the canonical
 * `QUALITY_GLYPH` map, so the tile and the band rows name the same state the
 * same way; `priority_high` stays `poor`'s alone.
 */
export const OVERALL_TILE: Record<SignalQuality, TileVerdict> = {
  excellent: { tone: "success", icon: "signal_cellular_alt" },
  good: { tone: "success", icon: "signal_cellular_alt" },
  fair: { tone: "warning", icon: "warning" },
  poor: { tone: "destructive", icon: "priority_high" },
  bad: { tone: "destructive", icon: "signal_cellular_0_bar" },
  none: { tone: "neutral", icon: "signal_cellular_off" },
};

export type ConnectionLabel = ConnectionState | "modem_unreachable";

export const CONNECTION_TILE: Record<ConnectionLabel, TileVerdict> = {
  connected: { tone: "success", icon: "check_circle" },
  searching: { tone: "warning", icon: "schedule" },
  limited: { tone: "warning", icon: "warning" },
  inactive: { tone: "neutral", icon: "do_not_disturb_on" },
  unknown: { tone: "neutral", icon: "help" },
  error: { tone: "destructive", icon: "priority_high" },
  disconnected: { tone: "destructive", icon: "cancel" },
  modem_unreachable: { tone: "destructive", icon: "signal_cellular_off" },
};

export const TEMPERATURE_TILE: Record<TempBand, TileVerdict> = {
  unknown: { tone: "neutral" },
  normal: { tone: "neutral" },
  warn: { tone: "warning", icon: "warning" },
  danger: { tone: "destructive", icon: "priority_high" },
};

// ---------- Type styles ----------------------------------------------------

/**
 * 11px / 600 / .11em — the label above every tile and section.
 *
 * The comp draws this at 10px. It ships at 11px: that is the floor already set
 * by the sidebar's surface-scoped exception and by the eyebrow this very card
 * shipped before the retarget, and going below it would make uppercase text at
 * 0.11em tracking the smallest type in the product. Fidelity to the comp is not
 * worth a new product-wide minimum on the least legible thing on the page.
 */
export const EYEBROW_CLASS =
  "text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.11em]";

/** The tile geometry the skeleton must mirror exactly. */
export const TILE_SHAPE = "rounded-field px-[0.9375rem] py-[0.8125rem]";

// ---------- Machine voice --------------------------------------------------

/**
 * A duration as a reading, not a sentence — deliberately un-keyed, and rendered
 * in the mono face per DESIGN.md's Machine-Voice Rule.
 */
export function formatAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

/** U+2212 MINUS SIGN for negative readings — a hyphen is not a minus. */
export function minusSign(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/** NR carriers are reported as "n78"; LTE as "B1". Identity, not health. */
export function isNrBand(band: string): boolean {
  return /^n/i.test(band.trim());
}

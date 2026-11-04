import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { EYEBROW } from "@/components/pre-auth-type";
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

type TempBand = "unknown" | "normal" | "warn" | "danger";

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

// ---------- Status tone (the tile DISC, never the tile body) ----------------
//
// THE TILE BODY IS NEUTRAL. THE DISC CARRIES THE COLOUR.
//
// This surface previously ran a filled tonal tile: the whole 66px body took the
// role's pale container and its `on-` ink. That is the composition PRODUCT.md
// replaced on 2026-08-16, and the one `radio/summary-tiles.tsx`, the SMS strip
// and the Cell Scanner triad have each already removed. Two things were wrong
// with it, both stated rather than felt:
//
//   · A 66px body is not "compact emphasis", so a role container was the wrong
//     LAYER for it. Three pale bodies at near-identical container lightness
//     encode CATEGORY without encoding IMPORTANCE, so the strip flattens to
//     equal weight and the eye has nowhere to land.
//   · The digits inherited the container's ink, so a warm modem printed its
//     temperature in amber. The feature doc claims "the digits stay neutral;
//     the icon carries the state" — which the shipped code stopped doing on
//     2026-07-29 and which a neutral body makes true again for free.
//
// A neutral body with a saturated disc gives each tile a focal point at ~1/8th
// the tinted area, and gives the pair a reading order again.

type StatusTone = "neutral" | "success" | "warning" | "destructive";

interface TileVerdict {
  tone: StatusTone;
  /**
   * Required, not optional. Every status tile carries a glyph, because
   * `success-container` and `warning-container` measure ~1.03:1 apart — the
   * same surface to the eye, and identical under deuteranopia — so the glyph is
   * the only thing that reliably separates two states in one slot. Making it
   * required is what turns that rule into a build error instead of a review
   * note: `TEMPERATURE_TILE` shipped TWO of its four bands with no icon at all.
   */
  icon: MaterialSymbolName;
}

/**
 * The disc fill for each status tone. Always a FILL pair (`bg-X` +
 * `text-X-foreground`), never a container — The Glyph-Disc Rule: in light mode
 * the pale role containers collapse under CVD simulation and the strong fills
 * do not, so the disc is the only place a role colour is reliably legible.
 *
 * `neutral` is the one non-role member, and it takes the same neutral surface
 * step the SMS strip's neutral disc takes (`sms/shapes.ts` > TILE_DISC_NEUTRAL).
 * A state with no honest hue gets no hue — it does not get borrowed one.
 */
export const TILE_DISC: Record<StatusTone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
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

/**
 * Four bands, four tones, four glyphs — and none of them shared.
 *
 * This map used to give `unknown` and `normal` BOTH `{ tone: "neutral" }` with
 * no icon at all, so a modem sitting at a healthy 47 °C and a modem reporting
 * nothing at all rendered identically. Two separate corrections:
 *
 *   · `normal` now reports the GOOD NEWS. Temperature previously only spoke
 *     when something was wrong, which makes a silent tile ambiguous between
 *     "fine" and "not measured".
 *   · `unknown` STAYS NEUTRAL, and this is not negotiable. A null temperature
 *     is NO READING, and painting it green is the same class of defect as the
 *     antenna that rendered green with nothing measured — the bug that made
 *     `qualityMeterTone()` return `null` rather than a colour.
 */
export const TEMPERATURE_TILE: Record<TempBand, TileVerdict> = {
  unknown: { tone: "neutral", icon: "help" },
  normal: { tone: "success", icon: "thermostat" },
  warn: { tone: "warning", icon: "warning" },
  danger: { tone: "destructive", icon: "priority_high" },
};

// ---------- Type styles ----------------------------------------------------

/**
 * The eyebrow above every tile and section.
 *
 * Re-exported, not restated. This step belongs to the PRE-AUTH TYPE SCALE and
 * is shared with the sign-in card, so it lives in `components/pre-auth-type.ts`
 * and this alias exists only so the surface's own modules can keep reading it
 * from the surface's own tone module.
 */
export const EYEBROW_CLASS = EYEBROW;

// ---------- Tile geometry --------------------------------------------------
//
// Both exports are read by the loaded tiles AND by the skeleton, which is the
// Skeleton-Mirror Rule in its literal form: a skeleton mirrors the loaded
// geometry by importing the same constant, never by restating a number. The
// skeleton previously hardcoded `h-16` for the info tiles and `h-[4.125rem]`
// for the status tiles, which is exactly the drift the rule exists to stop —
// the two numbers were already different from each other for no reason.

/** The tile body's radius and padding. */
export const TILE_SHAPE = "rounded-tile px-[0.9375rem] py-[0.8125rem]";

/**
 * One height for BOTH tile families, so the status pair and the identity trio
 * line up as one grid rather than as two strips that nearly match.
 *
 * 66px is what the status tile needs and no more: a 40px disc plus the shape's
 * own 13px of vertical padding on each side. The identity tile's eyebrow-plus-
 * value column is shorter than that and simply centres inside it.
 */
export const TILE_HEIGHT = "h-[4.125rem]";

/** The 40px glyph disc. Fill comes from `TILE_DISC`, never from a caller. */
export const TILE_DISC_SHAPE =
  "grid size-10 flex-none place-items-center rounded-pill";

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

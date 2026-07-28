import type { MaterialSymbolName } from "@/components/ui/material-symbol";
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
//   · the band CHIP carries IDENTITY   — primary-container for NR,
//     lte-container for LTE. It never means "healthy".
//   · the METER and VALUE carry QUALITY — the functional-colour contract.
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

// ---------- Quality tone (meters + numeric values) -------------------------

export type Tone = "success" | "warning" | "destructive" | "muted";

export function qualityTone(
  quality: SignalQuality,
  reachable: boolean,
): Tone {
  if (!reachable || quality === "none") return "muted";
  if (quality === "excellent" || quality === "good") return "success";
  if (quality === "fair") return "warning";
  return "destructive";
}

/**
 * Text uses the `*-on-surface` variants (darker in light theme, lighter in
 * dark) so functional-colour values clear WCAG AA 4.5:1 against the card
 * surface in both themes. The fill tokens stay tuned for 3:1 non-text.
 */
export const TONE_CLASSES: Record<Tone, { text: string; bar: string }> = {
  success: { text: "text-success-on-surface", bar: "bg-success" },
  warning: { text: "text-warning-on-surface", bar: "bg-warning" },
  destructive: { text: "text-destructive-on-surface", bar: "bg-destructive" },
  muted: { text: "text-on-surface-variant", bar: "bg-on-surface-variant/40" },
};

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
 */
export const OVERALL_TILE: Record<SignalQuality, TileVerdict> = {
  excellent: { tone: "primary", icon: "signal_cellular_alt" },
  good: { tone: "primary", icon: "signal_cellular_alt" },
  fair: { tone: "warning", icon: "warning" },
  poor: { tone: "destructive", icon: "priority_high" },
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

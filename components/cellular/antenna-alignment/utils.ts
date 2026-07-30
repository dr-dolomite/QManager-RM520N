import {
  ANTENNA_PORTS,
  hasAntennaData,
  isPortReporting,
  normalizeSignalValue,
} from "@/types/modem-status";
import type { SignalMetric, SignalPerAntenna } from "@/types/modem-status";
import type { BadgeVariant } from "@/components/ui/badge";

export { ANTENNA_PORTS };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RadioMode = "lte" | "nr" | "endc";
export type AntennaType = "directional" | "omni";
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface RecordingSnapshot {
  label: string;
  ts: number;
  lte_rsrp: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_sinr: (number | null)[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIGNAL_KEYS = [
  "lte_rsrp",
  "lte_sinr",
  "nr_rsrp",
  "nr_sinr",
] as const;

export const SAMPLES_PER_RECORDING = 3;
export const SLOT_COUNT = 3;
export const ALIGNMENT_STORAGE_KEY = "qmanager:antenna-alignment:v1";

export const RADIO_MODE_LABELS: Record<RadioMode, string> = {
  lte: "4G LTE",
  nr: "5G SA",
  endc: "5G NSA (EN-DC)",
};

export const DEFAULT_ANGLES = ["0°", "45°", "90°"];
export const DEFAULT_POSITIONS = ["Position A", "Position B", "Position C"];

export const EMPTY_SNAPSHOT_ARRAYS = {
  lte_rsrp: [null, null, null, null] as (number | null)[],
  lte_sinr: [null, null, null, null] as (number | null)[],
  nr_rsrp: [null, null, null, null] as (number | null)[],
  nr_sinr: [null, null, null, null] as (number | null)[],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Alignment-local alias for the shared per-antenna read boundary.
 *
 * The sentinel policy lives in `types/modem-status.ts` so this page and
 * antenna-statistics cannot disagree about what a number means. `metric`
 * defaults to `"rsrp"` purely for source compatibility with the single-argument
 * call sites this function used to have — the shared `rsrp` sentinel set is the
 * same `{-140, -32768}` this file used to carry locally. Pass the real metric:
 * SINR additionally suppresses `-20`, and RSRQ deliberately does not.
 */
export function normalizeValue(
  value: number | null | undefined,
  metric: SignalMetric = "rsrp"
): number | null {
  return normalizeSignalValue(value, metric);
}

export function formatValue(
  value: number | null | undefined,
  unit: string
): string {
  if (value === null || value === undefined) return "—";
  return `${value} ${unit}`;
}

export function getQualityColor(quality: string) {
  switch (quality) {
    case "excellent":
    case "good":
      return "text-success";
    case "fair":
      return "text-warning";
    case "poor":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Antenna quality as a chip role. Returns a `Badge` variant rather than a class
 * string so the chip cannot drift from the tonal system.
 */
export function getQualityBadgeVariant(quality: string): BadgeVariant {
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

export function qualityToBarColor(quality: string) {
  switch (quality) {
    case "excellent":
    case "good":
      return "bg-success";
    case "fair":
      return "bg-warning";
    case "poor":
      return "bg-destructive";
    default:
      return "bg-muted";
  }
}

// ---------------------------------------------------------------------------
// Scoring scale — NOT the display scale
// ---------------------------------------------------------------------------
//
// These two map the FULL 3GPP range (RSRP -140..-44 dBm, SINR -23..30 dB) and
// exist only to feed `computeCompositeScore`. Display bars use
// `signalToProgress(value, thresholds)` from `types/modem-status.ts` instead,
// which maps the narrower quality window [poor..excellent].
//
// The two scales answer different questions and cannot be merged. A bar asks
// "where in the usable range is this reading", so clamping at the top of the
// window is right — anything better than about -80 dBm is simply good, and the
// bar should say so. The composite score asks something else: it has to RANK
// three recorded positions against each other. Under the quality window every
// position better than -80 dBm scores 100, so two genuinely different good
// aims come out identical and `findBestSlot` stops discriminating exactly when
// the user has found a promising spot and is fine-tuning it. Ranking needs the
// full spread; display needs the honest "how good is this". Hence the split.

export function rsrpToScorePercent(value: number | null): number {
  if (value === null) return 0;
  const clamped = Math.max(-140, Math.min(-44, value));
  return Math.round(((clamped + 140) / 96) * 100);
}

export function sinrToScorePercent(value: number | null): number {
  if (value === null) return 0;
  const clamped = Math.max(-23, Math.min(30, value));
  return Math.round(((clamped + 23) / 53) * 100);
}

/** Determine active RAT(s) across ALL antennas. */
export function detectRadioMode(spa: SignalPerAntenna): RadioMode {
  const hasLte = hasAntennaData(spa, "lte");
  const hasNr = hasAntennaData(spa, "nr");
  if (hasLte && hasNr) return "endc";
  if (hasNr) return "nr";
  return "lte";
}

export function isAntennaActive(
  spa: SignalPerAntenna,
  index: number
): boolean {
  return isPortReporting(spa, index, "lte") || isPortReporting(spa, index, "nr");
}

export function computeCompositeScore(
  snap: RecordingSnapshot,
  mode: RadioMode
): number {
  let rsrpVal: number | null = null;
  let sinrVal: number | null = null;

  if (mode === "nr" || mode === "endc") {
    rsrpVal = snap.nr_rsrp[0];
    sinrVal = snap.nr_sinr[0];
  }
  if ((mode === "lte" || mode === "endc") && rsrpVal === null) {
    rsrpVal = snap.lte_rsrp[0];
    sinrVal = snap.lte_sinr[0];
  }

  // Full-range helpers on purpose — see the comment above them.
  const rsrpPct = rsrpToScorePercent(rsrpVal);
  const sinrPct = sinrToScorePercent(sinrVal);
  return rsrpPct * 0.6 + sinrPct * 0.4;
}

export function findBestSlot(
  slots: (RecordingSnapshot | null)[],
  mode: RadioMode
): number | null {
  let bestIdx: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s) continue;
    const score = computeCompositeScore(s, mode);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

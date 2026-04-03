import { ANTENNA_PORTS } from "@/types/modem-status";
import type { SignalPerAntenna } from "@/types/modem-status";

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

// -140 dBm is the 3GPP floor sentinel used by Quectel to mean "not measured".
// -32768 is the integer sentinel emitted when the modem returns no data.
const RSRP_INVALID_SENTINELS = new Set([-140, -32768]);

export const SIGNAL_KEYS = [
  "lte_rsrp",
  "lte_sinr",
  "nr_rsrp",
  "nr_sinr",
] as const;

export const SAMPLES_PER_RECORDING = 3;
export const SLOT_COUNT = 3;

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

export function normalizeValue(
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (RSRP_INVALID_SENTINELS.has(value)) return null;
  return value;
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

export function getQualityBadgeClasses(quality: string) {
  switch (quality) {
    case "excellent":
    case "good":
      return "bg-success/15 text-success hover:bg-success/20 border-success/30";
    case "fair":
      return "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30";
    case "poor":
      return "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30";
    default:
      return "bg-muted/50 text-muted-foreground border-muted-foreground/30";
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

export function rsrpToPercent(value: number | null): number {
  if (value === null) return 0;
  const clamped = Math.max(-140, Math.min(-44, value));
  return Math.round(((clamped + 140) / 96) * 100);
}

export function sinrToPercent(value: number | null): number {
  if (value === null) return 0;
  const clamped = Math.max(-23, Math.min(30, value));
  return Math.round(((clamped + 23) / 53) * 100);
}

/** Determine active RAT(s) across ALL antennas. */
export function detectRadioMode(spa: SignalPerAntenna): RadioMode {
  let hasLte = false;
  let hasNr = false;
  for (let i = 0; i < 4; i++) {
    if (
      normalizeValue(spa.lte_rsrp[i]) !== null ||
      normalizeValue(spa.lte_rsrq[i]) !== null ||
      normalizeValue(spa.lte_sinr[i]) !== null
    )
      hasLte = true;
    if (
      normalizeValue(spa.nr_rsrp[i]) !== null ||
      normalizeValue(spa.nr_rsrq[i]) !== null ||
      normalizeValue(spa.nr_sinr[i]) !== null
    )
      hasNr = true;
  }
  if (hasLte && hasNr) return "endc";
  if (hasNr) return "nr";
  return "lte";
}

export function isAntennaActive(
  spa: SignalPerAntenna,
  index: number
): boolean {
  return (
    normalizeValue(spa.lte_rsrp[index]) !== null ||
    normalizeValue(spa.lte_rsrq[index]) !== null ||
    normalizeValue(spa.lte_sinr[index]) !== null ||
    normalizeValue(spa.nr_rsrp[index]) !== null ||
    normalizeValue(spa.nr_rsrq[index]) !== null ||
    normalizeValue(spa.nr_sinr[index]) !== null
  );
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

  const rsrpPct = rsrpToPercent(rsrpVal);
  const sinrPct = sinrToPercent(sinrVal);
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

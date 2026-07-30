import {
  ANTENNA_PORTS,
  hasAntennaData,
  isPortReporting,
  normalizeSignalValue,
} from "@/types/modem-status";
import type { SignalMetric, SignalPerAntenna } from "@/types/modem-status";

export { ANTENNA_PORTS };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RadioMode = "lte" | "nr" | "endc";
export type AntennaType = "directional" | "omni";
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface RecordingSnapshot {
  /**
   * What the slot is called. This is USER DATA once a slot is recorded — the
   * label is frozen at capture time so a recorded measurement can never be
   * relabelled into claiming something it did not measure.
   */
  label: string;
  /**
   * True when `label` is the untouched default for this slot rather than
   * something the user typed, in which case the renderer resolves it through
   * i18n instead of printing the stored string.
   *
   * OPTIONAL on purpose, and that is what keeps the storage schema at v1: a
   * snapshot written before this field existed reads back as `undefined`, which
   * means "render the stored string" — the correct reading of pre-existing user
   * data, since we cannot know whether they typed it. Adding an optional field
   * is a schema EXTENSION; only changing what an existing field *means* would
   * need the `version` gate to move, and that would cost users their slots.
   */
  isDefaultLabel?: boolean;
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

/** Which sentinel set each accumulator key reads through. */
export const KEY_METRIC: Record<SignalKey, SignalMetric> = {
  lte_rsrp: "rsrp",
  lte_sinr: "sinr",
  nr_rsrp: "rsrp",
  nr_sinr: "sinr",
};

export const SAMPLES_PER_RECORDING = 3;
export const SLOT_COUNT = 3;
export const ALIGNMENT_STORAGE_KEY = "qmanager:antenna-alignment:v1";

/**
 * Angles are numerals plus a degree sign, so they read the same in every locale
 * and stay hardcoded. Positions are words, so only the LETTER lives here and the
 * noun comes from `antenna_alignment.recorder.position`.
 */
export const DEFAULT_ANGLES = ["0°", "45°", "90°"];
export const POSITION_LETTERS = ["A", "B", "C"];

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

// ---------------------------------------------------------------------------
// Scoring scale — NOT the display scale
// ---------------------------------------------------------------------------
//
// These two map the FULL 3GPP range (RSRP -140..-44 dBm, SINR -23..30 dB) and
// exist only to feed `scoreSnapshot`. Display bars use
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
//
// Both now take a plain `number`, not `number | null`, and that narrowing is a
// bug fix rather than a tidy-up. They used to return 0 for null — the very same
// value a genuine -140 dBm maps to — so "this chain measured nothing" and "this
// chain is pinned at the noise floor" ranked identically. That is the shared
// sentinel boundary's founding defect, relocated from the display layer into the
// ranking layer: an in-band sentinel, where 0 means both a score and an absence.
// Making null unrepresentable at the type level forces the caller to decide, and
// `scoreSnapshot` decides by dropping the leg and reweighting.

export function rsrpToScorePercent(value: number): number {
  const clamped = Math.max(-140, Math.min(-44, value));
  return Math.round(((clamped + 140) / 96) * 100);
}

export function sinrToScorePercent(value: number): number {
  const clamped = Math.max(-23, Math.min(30, value));
  return Math.round(((clamped + 23) / 53) * 100);
}

/** Composite weighting: RSRP carries more than SINR. See `scoreSnapshot`. */
export const SCORE_WEIGHTS = { rsrp: 0.6, sinr: 0.4 } as const;

// ---------------------------------------------------------------------------
// Live radio state
// ---------------------------------------------------------------------------

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

/** How many of the four ports are reporting on either radio. */
export function countReportingPorts(spa: SignalPerAntenna): number {
  return ANTENNA_PORTS.reduce(
    (n, _port, i) => (isAntennaActive(spa, i) ? n + 1 : n),
    0
  );
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

export type ScoreLeg = "rsrp" | "sinr";

export interface CompositeScore {
  /** 0–100, or `null` when the snapshot carries no rankable leg at all. */
  value: number | null;
  /** Which radio the score was taken from, derived from the snapshot itself. */
  radio: "nr" | "lte" | null;
  /** The legs that actually contributed, in weight order. */
  legs: ScoreLeg[];
  /** True when a leg was missing and the remaining weights were renormalized. */
  partial: boolean;
}

/**
 * Score one recorded position, 0–100.
 *
 * **This is a pure function of the snapshot**, and that is a deliberate change.
 * It used to take the live `RadioMode` as an argument, so a RAT flap — and
 * per-antenna presence flaps several times an hour on this device — silently
 * re-ranked all three stored slots without the user touching anything. The radio
 * a slot was captured under is already latent in the slot itself: a position
 * recorded on NR has a non-null NR leg. Deriving it here rather than passing it
 * in makes the ranking referentially stable, which is what you want in a number
 * somebody is about to act on with a wrench — and it needed no new stored field.
 *
 * NR is preferred when both radios are present, matching the old EN-DC rule.
 *
 * **Missing legs reweight rather than score zero.** Under a fixed 60/40 split a
 * suppressed SINR cost a position a flat 40 points for a reason that had nothing
 * to do with where the antenna was pointing, so a position could lose the
 * recommendation because one receive chain happened to be idle. The weights now
 * renormalize over the legs that reported, and `partial` says so out loud: a
 * score built from one leg is a weaker claim than one built from two, and the UI
 * has to be able to admit that rather than presenting both as the same number.
 */
export function scoreSnapshot(snap: RecordingSnapshot): CompositeScore {
  const nrRsrp = normalizeValue(snap.nr_rsrp[0], "rsrp");
  const nrSinr = normalizeValue(snap.nr_sinr[0], "sinr");
  const lteRsrp = normalizeValue(snap.lte_rsrp[0], "rsrp");
  const lteSinr = normalizeValue(snap.lte_sinr[0], "sinr");

  const hasNr = nrRsrp !== null || nrSinr !== null;
  const hasLte = lteRsrp !== null || lteSinr !== null;

  const radio: CompositeScore["radio"] = hasNr ? "nr" : hasLte ? "lte" : null;
  if (radio === null) {
    return { value: null, radio: null, legs: [], partial: true };
  }

  const rsrp = radio === "nr" ? nrRsrp : lteRsrp;
  const sinr = radio === "nr" ? nrSinr : lteSinr;

  const contributions: { leg: ScoreLeg; pct: number; weight: number }[] = [];
  if (rsrp !== null) {
    contributions.push({
      leg: "rsrp",
      pct: rsrpToScorePercent(rsrp),
      weight: SCORE_WEIGHTS.rsrp,
    });
  }
  if (sinr !== null) {
    contributions.push({
      leg: "sinr",
      pct: sinrToScorePercent(sinr),
      weight: SCORE_WEIGHTS.sinr,
    });
  }

  if (contributions.length === 0) {
    return { value: null, radio, legs: [], partial: true };
  }

  const totalWeight = contributions.reduce((sum, c) => sum + c.weight, 0);
  const weighted = contributions.reduce((sum, c) => sum + c.pct * c.weight, 0);

  return {
    value: Math.round(weighted / totalWeight),
    radio,
    legs: contributions.map((c) => c.leg),
    partial: contributions.length < 2,
  };
}

/**
 * Score the LIVE primary antenna on the same scale the recorded slots use, so
 * "what am I reading right now" and "what did I record there" are the same
 * number and can be compared directly. Without this the instrument and the
 * recorder would answer the same question in two different units.
 */
export function scoreLive(spa: SignalPerAntenna): CompositeScore {
  return scoreSnapshot({
    label: "",
    ts: 0,
    lte_rsrp: spa.lte_rsrp,
    lte_sinr: spa.lte_sinr,
    nr_rsrp: spa.nr_rsrp,
    nr_sinr: spa.nr_sinr,
  });
}

export interface BestSlot {
  index: number;
  score: CompositeScore;
  /** Points clear of the runner-up; `null` when only one slot is rankable. */
  margin: number | null;
  /**
   * True when the rankable slots were not all captured on the same radio. The
   * comparison then spans two different scales of thing, and the UI says so
   * rather than presenting a cross-radio winner as a clean result.
   */
  mixedRadios: boolean;
}

/**
 * Rank the recorded slots. Takes no live state — see `scoreSnapshot`.
 *
 * Slots carrying no rankable leg are excluded rather than scored zero, so an
 * unmeasurable position can neither win by default nor drag the comparison.
 */
export function findBestSlot(
  slots: (RecordingSnapshot | null)[]
): BestSlot | null {
  const ranked = slots
    .map((snap, index) => ({ index, score: snap ? scoreSnapshot(snap) : null }))
    .filter(
      (entry): entry is { index: number; score: CompositeScore } =>
        entry.score !== null && entry.score.value !== null
    )
    .sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0));

  if (ranked.length === 0) return null;

  const [winner, runnerUp] = ranked;
  const radios = new Set(ranked.map((entry) => entry.score.radio));

  return {
    index: winner.index,
    score: winner.score,
    margin:
      runnerUp && winner.score.value !== null && runnerUp.score.value !== null
        ? winner.score.value - runnerUp.score.value
        : null,
    mixedRadios: radios.size > 1,
  };
}

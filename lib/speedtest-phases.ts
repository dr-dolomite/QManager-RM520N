import type { SpeedtestPhase } from "@/hooks/use-speedtest";

// =============================================================================
// Speedtest step-chip state machine
// =============================================================================
// The dialog draws three step chips — Latency, Download, Upload — that morph
// container colour as each measurement completes. Deriving "past" from an
// index comparison (the previous approach) collapses the moment `phase` is not
// itself one of the three steps: `findIndex` returns -1 for `initializing`,
// `complete` and `error`, so every chip reads as "future" and a finished run
// looks like one that never started.
//
// This module is pure and holds the whole truth instead: given a phase (and,
// on failure, the phase that died) it returns a state for every step. Keeping
// it out of the component means the "did the download finish before the upload
// failed?" question has exactly one answer, in one place.
// =============================================================================

export const SPEEDTEST_STEPS = ["ping", "download", "upload"] as const;

export type SpeedtestStep = (typeof SPEEDTEST_STEPS)[number];

/**
 * `failed` is deliberately distinct from `future`: a run that died during
 * upload must not render its upload chip the same way as a run that has not
 * reached upload yet. That distinction is the diagnostic value of keeping the
 * chips on screen in the error state at all.
 */
export type SpeedtestStepState = "past" | "active" | "failed" | "future";

/** Ordinal position of a phase along the step sequence, or -1 if off-sequence. */
function stepIndex(phase: SpeedtestPhase | SpeedtestStep): number {
  return SPEEDTEST_STEPS.indexOf(phase as SpeedtestStep);
}

/**
 * Resolve the state of every step chip.
 *
 * @param phase     The current lifecycle phase.
 * @param failedAt  The step that was in flight when the run failed. Only
 *                  meaningful when `phase === "error"`; when it is unknown
 *                  (an error raised before any step began, e.g. a failed
 *                  start) every step falls back to `future`.
 */
export function resolveStepStates(
  phase: SpeedtestPhase,
  failedAt?: SpeedtestStep | null,
): Record<SpeedtestStep, SpeedtestStepState> {
  const out = {} as Record<SpeedtestStep, SpeedtestStepState>;

  if (phase === "complete") {
    // Every measurement landed, so every chip is past — including upload,
    // which the running branches can never mark as past on their own.
    for (const step of SPEEDTEST_STEPS) out[step] = "past";
    return out;
  }

  if (phase === "error") {
    const deadIndex = failedAt ? stepIndex(failedAt) : -1;
    for (const step of SPEEDTEST_STEPS) {
      const i = stepIndex(step);
      out[step] =
        deadIndex === -1
          ? "future"
          : i < deadIndex
            ? "past"
            : i === deadIndex
              ? "failed"
              : "future";
    }
    return out;
  }

  // idle and initializing are both "before the first step", and correctly
  // produce an all-future row rather than a partially-lit one.
  const current = stepIndex(phase);
  for (const step of SPEEDTEST_STEPS) {
    const i = stepIndex(step);
    out[step] =
      current === -1 ? "future" : i < current ? "past" : i === current ? "active" : "future";
  }
  return out;
}

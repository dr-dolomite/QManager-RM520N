"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SignalPerAntenna } from "@/types/modem-status";
import {
  ALIGNMENT_STORAGE_KEY,
  EMPTY_SNAPSHOT_ARRAYS,
  KEY_METRIC,
  SAMPLES_PER_RECORDING,
  SIGNAL_KEYS,
  normalizeValue,
} from "./utils";
import type {
  AntennaType,
  RecordingSnapshot,
  SignalKey,
} from "./utils";

// =============================================================================
// usePositionRecorder
// =============================================================================
// The 3-slot recorder's whole state machine: per-slot empty → recording →
// recorded, the sample accumulator, and localStorage persistence.
//
// Extracted from `alignment-meter.tsx` so the recording rules are readable
// without scrolling past 300 lines of JSX, and so the sampling gate below has
// somewhere to be explained.
// =============================================================================

export interface RecorderState {
  antennaType: AntennaType;
  slots: (RecordingSnapshot | null)[];
  activeSlot: number | null;
  samplesCollected: number;
}

const DEFAULT_STATE: RecorderState = {
  antennaType: "directional",
  slots: [null, null, null],
  activeSlot: null,
  samplesCollected: 0,
};

function readPersisted(): RecorderState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(ALIGNMENT_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return DEFAULT_STATE;
    if (parsed.antennaType !== "directional" && parsed.antennaType !== "omni") {
      return DEFAULT_STATE;
    }
    if (!Array.isArray(parsed.slots) || parsed.slots.length !== 3) {
      return DEFAULT_STATE;
    }
    return {
      ...DEFAULT_STATE,
      antennaType: parsed.antennaType,
      slots: parsed.slots,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/**
 * @param spa         the live per-antenna block, or null before the first fetch
 * @param snapshotTs  the MODEM's own timestamp on the snapshot `spa` came from.
 *                    This is the sampling clock — see the gate below.
 */
export function usePositionRecorder(
  spa: SignalPerAntenna | null,
  snapshotTs: number | null
) {
  const [state, setState] = useState<RecorderState>(readPersisted);

  const accRef = useRef<{ [K in SignalKey]: (number | null)[][] }>({
    lte_rsrp: [],
    lte_sinr: [],
    nr_rsrp: [],
    nr_sinr: [],
  });

  const labelRef = useRef("");
  const labelIsDefaultRef = useRef(false);

  /**
   * The last modem timestamp that contributed a sample.
   *
   * THIS IS THE FIX FOR A REAL DEFECT, not a micro-optimisation. The accumulator
   * effect used to be keyed on the parsed `spa` object, and `useModemStatus`
   * calls `setData(json)` on every successful fetch — a brand-new object identity
   * whether or not the contents changed. So one "sample" meant one HTTP
   * response, not one measurement.
   *
   * The two clocks do not line up: the client polls every 2s, while the
   * device-side poller's cycle is ~3.7–4.0s (its own header records this,
   * measured across 103 consecutive polls — the `sleep` runs AFTER the cycle
   * body, so anything derived from POLL_INTERVAL alone is ~50% short). Three
   * fetches across a 6s window therefore captured two distinct modem reads,
   * sometimes one, with a snapshot silently double-weighted in the mean. The card
   * promised "averages 3 samples" and delivered an average of a duplicate, which
   * is noise reduction the tool was claiming and not performing.
   *
   * Gating on the modem's own timestamp makes a sample mean a measurement. The
   * honest cost is wall time: three genuine samples take ~8s, not ~6s, and the
   * card now says so rather than implying a faster loop than it has.
   */
  const lastSampledTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (state.activeSlot === null || !spa || snapshotTs === null) return;
    // Same measurement we already counted — not a new sample.
    if (lastSampledTsRef.current === snapshotTs) return;
    lastSampledTsRef.current = snapshotTs;

    const acc = accRef.current;
    for (const key of SIGNAL_KEYS) {
      acc[key].push(
        [0, 1, 2, 3].map((i) => normalizeValue(spa[key]?.[i], KEY_METRIC[key]))
      );
    }

    const count = acc.lte_rsrp.length;

    if (count < SAMPLES_PER_RECORDING) {
      setState((s) => ({ ...s, samplesCollected: count }));
      return;
    }

    const averaged: Pick<RecordingSnapshot, SignalKey> = {
      ...EMPTY_SNAPSHOT_ARRAYS,
    };
    for (const key of SIGNAL_KEYS) {
      averaged[key] = [0, 1, 2, 3].map((ant) => {
        const vals = acc[key]
          .map((s) => s[ant])
          .filter((v): v is number => v !== null);
        return vals.length > 0
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          : null;
      });
    }

    const snapshot: RecordingSnapshot = {
      label: labelRef.current,
      isDefaultLabel: labelIsDefaultRef.current,
      ts: Date.now(),
      ...averaged,
    };

    setState((s) => {
      if (s.activeSlot === null) return s;
      const slots = [...s.slots];
      slots[s.activeSlot] = snapshot;
      return { ...s, slots, activeSlot: null, samplesCollected: 0 };
    });

    for (const key of SIGNAL_KEYS) acc[key] = [];
  }, [spa, snapshotTs, state.activeSlot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      ALIGNMENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        antennaType: state.antennaType,
        slots: state.slots,
      })
    );
  }, [state.slots, state.antennaType]);

  const startRecording = useCallback(
    (slotIndex: number, label: string, isDefaultLabel: boolean) => {
      for (const key of SIGNAL_KEYS) accRef.current[key] = [];
      labelRef.current = label;
      labelIsDefaultRef.current = isDefaultLabel;
      // Clear the gate so the reading currently on screen counts as sample 1.
      // Without this, a second recording in the same session would skip its
      // first measurement whenever the snapshot had not yet advanced.
      lastSampledTsRef.current = null;
      setState((s) => ({ ...s, activeSlot: slotIndex, samplesCollected: 0 }));
    },
    []
  );

  const cancelRecording = useCallback(() => {
    for (const key of SIGNAL_KEYS) accRef.current[key] = [];
    setState((s) => ({ ...s, activeSlot: null, samplesCollected: 0 }));
  }, []);

  const clearSlot = useCallback((slotIndex: number) => {
    setState((s) => {
      if (s.activeSlot === slotIndex) return s;
      const slots = [...s.slots];
      slots[slotIndex] = null;
      return { ...s, slots };
    });
  }, []);

  const setAntennaType = useCallback((type: AntennaType) => {
    setState((s) => ({ ...s, antennaType: type }));
  }, []);

  const resetAll = useCallback(() => {
    for (const key of SIGNAL_KEYS) accRef.current[key] = [];
    setState((s) => ({
      ...s,
      slots: [null, null, null],
      activeSlot: null,
      samplesCollected: 0,
    }));
  }, []);

  return {
    state,
    startRecording,
    cancelRecording,
    clearSlot,
    setAntennaType,
    resetAll,
  };
}

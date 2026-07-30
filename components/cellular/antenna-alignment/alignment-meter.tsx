"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
} from "@/types/modem-status";
import type { SignalMetric, SignalPerAntenna } from "@/types/modem-status";
import {
  normalizeValue,
  getQualityColor,
  qualityToBarColor,
  findBestSlot,
  SIGNAL_KEYS,
  SAMPLES_PER_RECORDING,
  SLOT_COUNT,
  RADIO_MODE_LABELS,
  DEFAULT_ANGLES,
  DEFAULT_POSITIONS,
  EMPTY_SNAPSHOT_ARRAYS,
  ALIGNMENT_STORAGE_KEY,
  type RadioMode,
  type AntennaType,
  type RecordingSnapshot,
  type SignalKey,
} from "./utils";

// ---------------------------------------------------------------------------
// Recording hook — accumulates samples then averages
// ---------------------------------------------------------------------------

/**
 * Which sentinel set each recorded key reads through. `SIGNAL_KEYS` only covers
 * RSRP and SINR, but the mapping is explicit so adding RSRQ later cannot
 * silently inherit the wrong set — RSRQ's floor of -20 dB is real data.
 */
const KEY_METRIC: Record<SignalKey, SignalMetric> = {
  lte_rsrp: "rsrp",
  lte_sinr: "sinr",
  nr_rsrp: "rsrp",
  nr_sinr: "sinr",
};

interface RecorderState {
  antennaType: AntennaType;
  slots: (RecordingSnapshot | null)[];
  activeSlot: number | null;
  samplesCollected: number;
}

function usePositionRecorder(spa: SignalPerAntenna | null) {
  const [state, setState] = useState<RecorderState>(() => {
    const defaults: RecorderState = {
      antennaType: "directional",
      slots: [null, null, null],
      activeSlot: null,
      samplesCollected: 0,
    };
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(ALIGNMENT_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1) return defaults;
      if (parsed.antennaType !== "directional" && parsed.antennaType !== "omni") return defaults;
      if (!Array.isArray(parsed.slots) || parsed.slots.length !== 3) return defaults;
      return {
        ...defaults,
        antennaType: parsed.antennaType,
        slots: parsed.slots,
      };
    } catch {
      return defaults;
    }
  });

  const accRef = useRef<{ [K in SignalKey]: (number | null)[][] }>({
    lte_rsrp: [],
    lte_sinr: [],
    nr_rsrp: [],
    nr_sinr: [],
  });

  const labelRef = useRef("");

  useEffect(() => {
    if (state.activeSlot === null || !spa) return;

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
  }, [spa, state.activeSlot]);

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
    (slotIndex: number, label: string) => {
      for (const key of SIGNAL_KEYS) accRef.current[key] = [];
      labelRef.current = label;
      setState((s) => ({
        ...s,
        activeSlot: slotIndex,
        samplesCollected: 0,
      }));
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

  return { state, startRecording, cancelRecording, clearSlot, setAntennaType, resetAll };
}

// ---------------------------------------------------------------------------
// Mini signal bar (compact, for comparison)
// ---------------------------------------------------------------------------

function MiniSignalBar({
  value,
  unit,
  percent,
  thresholds,
}: {
  value: number | null;
  unit: string;
  percent: number;
  thresholds: typeof RSRP_THRESHOLDS;
}) {
  const quality = getSignalQuality(value, thresholds);
  return (
    <div className="space-y-1">
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          value === null
            ? "text-muted-foreground/40"
            : getQualityColor(quality)
        )}
      >
        {value === null ? "—" : `${value} ${unit}`}
      </span>
      {value === null ? (
        // A null reading is NOT zero percent. A zero-width bar reads as "signal
        // is zero", which is a different and alarming claim about a value the
        // radio never reported. The "—" above already says it wasn't measured,
        // so the track is dropped and only its height is reserved to keep the
        // recorded/live grids aligned.
        <div aria-hidden="true" className="h-1.5" />
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn("h-full rounded-full", qualityToBarColor(quality))}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: percent / 100 }}
            style={{ originX: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 24 }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live signal overview (primary antenna, shown during idle/recording)
// ---------------------------------------------------------------------------

function LiveSignalOverview({
  spa,
  mode,
}: {
  spa: SignalPerAntenna;
  mode: RadioMode;
}) {
  const showLte = mode === "lte" || mode === "endc";
  const showNr = mode === "nr" || mode === "endc";

  const lteRsrp = normalizeValue(spa.lte_rsrp[0], "rsrp");
  const lteSinr = normalizeValue(spa.lte_sinr[0], "sinr");
  const nrRsrp = normalizeValue(spa.nr_rsrp[0], "rsrp");
  const nrSinr = normalizeValue(spa.nr_sinr[0], "sinr");

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      {showLte && (
        <>
          <MiniSignalBar
            value={lteRsrp}
            unit="dBm"
            percent={signalToProgress(lteRsrp, RSRP_THRESHOLDS)}
            thresholds={RSRP_THRESHOLDS}
          />
          <MiniSignalBar
            value={lteSinr}
            unit="dB"
            percent={signalToProgress(lteSinr, SINR_THRESHOLDS)}
            thresholds={SINR_THRESHOLDS}
          />
          <span className="text-[10px] text-muted-foreground -mt-1">
            LTE RSRP
          </span>
          <span className="text-[10px] text-muted-foreground -mt-1">
            LTE SINR
          </span>
        </>
      )}
      {showNr && (
        <>
          <MiniSignalBar
            value={nrRsrp}
            unit="dBm"
            percent={signalToProgress(nrRsrp, RSRP_THRESHOLDS)}
            thresholds={RSRP_THRESHOLDS}
          />
          <MiniSignalBar
            value={nrSinr}
            unit="dB"
            percent={signalToProgress(nrSinr, SINR_THRESHOLDS)}
            thresholds={SINR_THRESHOLDS}
          />
          <span className="text-[10px] text-muted-foreground -mt-1">
            NR RSRP
          </span>
          <span className="text-[10px] text-muted-foreground -mt-1">
            NR SINR
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recording slot card (one per position/angle)
// ---------------------------------------------------------------------------

function RecordingSlotCard({
  slotIndex,
  snapshot,
  antennaType,
  mode,
  isRecording,
  samplesCollected,
  isBest,
  onRecord,
  onCancel,
  onClear,
}: {
  slotIndex: number;
  snapshot: RecordingSnapshot | null;
  antennaType: AntennaType;
  mode: RadioMode;
  isRecording: boolean;
  samplesCollected: number;
  isBest: boolean;
  onRecord: (label: string) => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const defaults =
    antennaType === "directional" ? DEFAULT_ANGLES : DEFAULT_POSITIONS;
  const defaultLabel = defaults[slotIndex];
  const [labelOverride, setLabelOverride] = useState<string | null>(null);
  const label = snapshot ? snapshot.label : (labelOverride ?? defaultLabel);
  const setLabel = (v: string) => setLabelOverride(v);

  const showLte = mode === "lte" || mode === "endc";
  const showNr = mode === "nr" || mode === "endc";

  // Re-normalized on read, not just on record: slots persist to localStorage, so
  // a snapshot captured before SINR's -20 sentinel was recognised is still on
  // disk and would otherwise render as a real -20 dB reading.
  const lteRsrp = normalizeValue(snapshot?.lte_rsrp[0], "rsrp");
  const lteSinr = normalizeValue(snapshot?.lte_sinr[0], "sinr");
  const nrRsrp = normalizeValue(snapshot?.nr_rsrp[0], "rsrp");
  const nrSinr = normalizeValue(snapshot?.nr_sinr[0], "sinr");

  const slotStatus = isRecording
    ? "recording"
    : snapshot
      ? isBest
        ? "recorded, best result"
        : "recorded"
      : "empty";

  return (
    <div
      role="region"
      aria-label={`Slot ${slotIndex + 1}: ${label} — ${slotStatus}`}
      className={cn(
        "relative rounded-xl border p-4 space-y-3 transition-all",
        isRecording && "ring-2 ring-primary border-primary",
        isBest && snapshot && "ring-2 ring-primary border-primary"
      )}
    >
      {isBest && snapshot && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
          <Badge className="gap-1 text-[10px]">
            <MaterialSymbol name="trophy" size={12} />
            Best
          </Badge>
        </div>
      )}

      <div className="flex items-center gap-2">
        {antennaType === "directional" ? (
          <MaterialSymbol
            name="explore"
            size={16}
            className="text-muted-foreground shrink-0"
          />
        ) : (
          <MaterialSymbol
            name="location_on"
            size={16}
            className="text-muted-foreground shrink-0"
          />
        )}
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isRecording || !!snapshot}
          className="h-7 text-sm font-medium px-2"
          placeholder={
            antennaType === "directional" ? "Angle…" : "Location…"
          }
        />
      </div>

      {/* Recording in progress */}
      {isRecording && (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 py-1" aria-live="polite">
            <MaterialSymbol
              name="progress_activity"
              size={16}
              className="text-info animate-spin motion-reduce:animate-none"
            />
            <span className="text-xs text-muted-foreground">
              Sample {samplesCollected} of {SAMPLES_PER_RECORDING}
            </span>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: SAMPLES_PER_RECORDING }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  i < samplesCollected
                    ? "bg-info"
                    : "bg-muted-foreground/20"
                )}
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="w-full h-7 text-xs"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Recorded snapshot */}
      {!isRecording && snapshot && (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive"
            aria-label={`Clear ${label}`}
            onClick={onClear}
          >
            <MaterialSymbol name="delete" size={14} />
          </Button>
          {showLte && (
            <div className="space-y-1">
              {mode === "endc" && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  LTE
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <MiniSignalBar
                    value={lteRsrp}
                    unit="dBm"
                    percent={signalToProgress(lteRsrp, RSRP_THRESHOLDS)}
                    thresholds={RSRP_THRESHOLDS}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    RSRP
                  </span>
                </div>
                <div>
                  <MiniSignalBar
                    value={lteSinr}
                    unit="dB"
                    percent={signalToProgress(lteSinr, SINR_THRESHOLDS)}
                    thresholds={SINR_THRESHOLDS}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    SINR
                  </span>
                </div>
              </div>
            </div>
          )}
          {showNr && (
            <div className="space-y-1">
              {mode === "endc" && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  NR
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <MiniSignalBar
                    value={nrRsrp}
                    unit="dBm"
                    percent={signalToProgress(nrRsrp, RSRP_THRESHOLDS)}
                    thresholds={RSRP_THRESHOLDS}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    RSRP
                  </span>
                </div>
                <div>
                  <MiniSignalBar
                    value={nrSinr}
                    unit="dB"
                    percent={signalToProgress(nrSinr, SINR_THRESHOLDS)}
                    thresholds={SINR_THRESHOLDS}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    SINR
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <MaterialSymbol name="check_circle" size={12} className="text-success" />
            Recorded {new Date(snapshot.ts).toLocaleTimeString()}
          </div>
        </div>
      )}

      {/* Empty — ready to record */}
      {!isRecording && !snapshot && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 py-3 justify-center">
            <span
              aria-hidden="true"
              className="size-3 rounded-full border-2 border-muted-foreground/50"
            />
            <span className="text-xs text-muted-foreground">Not recorded</span>
          </div>
          <Button
            size="sm"
            onClick={() => onRecord(label)}
            className="w-full h-7 text-xs"
          >
            Record {antennaType === "directional" ? "Angle" : "Position"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Alignment Meter card
// ---------------------------------------------------------------------------

export default function AlignmentMeterSection({
  spa,
  mode,
}: {
  spa: SignalPerAntenna;
  mode: RadioMode;
}) {
  const {
    state: recorderState,
    startRecording,
    cancelRecording,
    clearSlot,
    setAntennaType,
    resetAll,
  } = usePositionRecorder(spa);

  const { slots, activeSlot, antennaType, samplesCollected } = recorderState;
  const filledCount = slots.filter(Boolean).length;
  const bestSlot = filledCount >= 2 ? findBestSlot(slots, mode) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 @lg/main:flex-row @lg/main:items-center @lg/main:justify-between">
          <div>
            <CardTitle className="text-base">Alignment Meter</CardTitle>
            <CardDescription className="text-xs">
              Record{" "}
              {antennaType === "directional" ? "3 angles" : "3 positions"} to
              find the best{" "}
              {antennaType === "directional" ? "aim" : "placement"}. Each
              recording averages {SAMPLES_PER_RECORDING} samples.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={antennaType}
              onValueChange={(v) => {
                if (v) setAntennaType(v as AntennaType);
              }}
            >
              <ToggleGroupItem
                value="directional"
                className="gap-1 text-xs h-7 px-2"
              >
                <MaterialSymbol name="explore" size={12} />
                Directional
              </ToggleGroupItem>
              <ToggleGroupItem
                value="omni"
                className="gap-1 text-xs h-7 px-2"
              >
                <MaterialSymbol name="location_on" size={12} />
                Omni
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              className="h-7 gap-1 text-xs"
              disabled={activeSlot !== null}
            >
              <MaterialSymbol name="restart_alt" size={12} />
              Reset
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
                    <Badge>{RADIO_MODE_LABELS[mode]}</Badge>
        {/* Live signal preview */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Live Signal (Primary Antenna)
          </p>
          <LiveSignalOverview spa={spa} mode={mode} />
        </div>

        {/* 3 recording slots */}
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <RecordingSlotCard
              key={`${antennaType}-${i}`}
              slotIndex={i}
              snapshot={slots[i]}
              antennaType={antennaType}
              mode={mode}
              isRecording={activeSlot === i}
              samplesCollected={activeSlot === i ? samplesCollected : 0}
              isBest={bestSlot === i}
              onRecord={(label) => startRecording(i, label)}
              onCancel={cancelRecording}
              onClear={() => clearSlot(i)}
            />
          ))}
        </div>

        {/* Recommendation */}
        <AnimatePresence>
          {bestSlot !== null && slots[bestSlot] && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-lg border border-primary/30 bg-primary/5 p-4"
            >
              <div className="flex items-start gap-3">
                <MaterialSymbol
                  name="trophy"
                  size={20}
                  className="text-primary shrink-0 mt-0.5"
                />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    Recommended:{" "}
                    <span className="text-primary">
                      {slots[bestSlot]!.label}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {antennaType === "directional"
                      ? "This angle produced the strongest composite signal across your recorded positions."
                      : "This location produced the strongest composite signal across your recorded positions."}
                    {filledCount < SLOT_COUNT &&
                      ` Record the remaining ${SLOT_COUNT - filledCount} slot${SLOT_COUNT - filledCount > 1 ? "s" : ""} for a more complete comparison.`}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

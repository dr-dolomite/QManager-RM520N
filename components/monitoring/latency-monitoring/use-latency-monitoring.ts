"use client";

import { useCallback, useMemo, useState } from "react";

import { useLatencyHistory } from "@/hooks/use-latency-history";
import { useModemStatus } from "@/hooks/use-modem-status";
import type {
  ConnectivityStatus,
  PingHistoryEntry,
} from "@/types/modem-status";

// =============================================================================
// Latency Monitor — data layer
// =============================================================================

export type ViewMode = "realtime" | "hourly" | "twelvehour" | "daily";

export const VIEW_MODES: readonly ViewMode[] = [
  "realtime",
  "hourly",
  "twelvehour",
  "daily",
];

/** Newest N samples the table renders. The chart plots the whole window. */
export const TABLE_CAP = 50;

/** One plotted / tabulated sample. */
export interface LatencySample {
  /** Stable ms epoch. Realtime: anchored to `receivedAtMs`. Aggregate: bucket start. */
  timestamp: number;
  /** Stable React key. Does NOT move when the underlying reading does not. */
  key: string;
  /** null = lost probe / all-lost bucket. NEVER 0. */
  latency: number | null;
  /** 0-100, or null when unmeasured. NEVER coerced to 0. */
  loss: number | null;
  /** ms, or null. Realtime is always null — per-probe jitter does not exist. */
  jitter: number | null;
  /** Aggregate only; null in realtime. */
  min: number | null;
  max: number | null;
  /** [min, max] for the spread band, or null. Aggregate only. */
  spread: [number, number] | null;
  /** Probes behind this point. 1 in realtime. */
  sampleCount: number;
  /** false when the sample is a lost probe or an all-lost bucket. */
  ok: boolean;
}

export interface UseLatencyMonitoringReturn {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  /** Live connectivity payload, or null before the first snapshot. */
  connectivity: ConnectivityStatus | null;
  /** Every sample in the window, oldest first. NOT capped. Chart plots all of these. */
  samples: LatencySample[];
  /** samples.length */
  total: number;
  /** The newest `TABLE_CAP` samples, still oldest first. Table renders these. */
  tableSamples: LatencySample[];
  /** Seconds between realtime samples (connectivity.history_interval_sec), else null. */
  intervalSec: number | null;
  /** Resolved PER VIEW. realtime -> modem status, aggregate -> latency history. */
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// --- Constants ---------------------------------------------------------------

const STATUS_POLL_MS = 5000;

/** Used only when the payload reports a non-positive cadence — a zero spacing
 *  would stamp every sample at the same ms and collide the React keys. */
const FALLBACK_INTERVAL_MS = 5000;

const BUCKET_MS: Record<Exclude<ViewMode, "realtime">, number> = {
  hourly: 3_600_000,
  twelvehour: 43_200_000,
  daily: 86_400_000,
};

// --- Helpers -----------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Where the newest realtime sample sits in wall-clock, plus the window content
 *  that placed it there. Re-seeded only when the ring's content changes. */
interface HistoryAnchor {
  sig: string;
  atMs: number;
  intervalMs: number;
}

function reanchor(
  prev: HistoryAnchor | null,
  sig: string,
  intervalMs: number,
  receivedAtMs: number,
): HistoryAnchor {
  if (!prev || prev.intervalMs !== intervalMs || receivedAtMs < prev.atMs) {
    return { sig, atMs: receivedAtMs, intervalMs };
  }
  // Quantise the advance to whole sample intervals: a poll lands at an arbitrary
  // wall-clock, and only a whole-interval step leaves a surviving row's stamp put.
  const steps = Math.max(
    0,
    Math.round((receivedAtMs - prev.atMs) / intervalMs),
  );
  return { sig, atMs: prev.atMs + steps * intervalMs, intervalMs };
}

/** Counts back from the NEWEST entry using `history.length` — never
 *  `history_size`, a fixed capacity the daemon's truncations routinely undershoot. */
function buildRealtimeSamples(
  history: (number | null)[],
  intervalMs: number,
  anchorMs: number,
): LatencySample[] {
  const len = history.length;
  return history.map((value, i) => {
    const timestamp = anchorMs - (len - 1 - i) * intervalMs;
    const ok = value !== null;
    return {
      timestamp,
      key: String(timestamp),
      latency: value,
      loss: ok ? 0 : 100,
      jitter: null,
      min: null,
      max: null,
      spread: null,
      sampleCount: 1,
      ok,
    };
  });
}

interface BucketAcc {
  sumLat: number;
  countLat: number;
  countNull: number;
  total: number;
  min: number | null;
  max: number | null;
  sumJit: number;
  countJit: number;
}

function aggregateByBucket(
  entries: PingHistoryEntry[],
  bucketMs: number,
): LatencySample[] {
  if (entries.length === 0) return [];

  const buckets = new Map<number, BucketAcc>();

  for (const entry of entries) {
    const start = Math.floor((entry.ts * 1000) / bucketMs) * bucketMs;
    let acc = buckets.get(start);
    if (!acc) {
      acc = {
        sumLat: 0,
        countLat: 0,
        countNull: 0,
        total: 0,
        min: null,
        max: null,
        sumJit: 0,
        countJit: 0,
      };
      buckets.set(start, acc);
    }

    acc.total++;
    if (entry.lat === null) {
      acc.countNull++;
    } else {
      acc.sumLat += entry.lat;
      acc.countLat++;
    }

    // `lat` is a real observed RTT, so it stands in for the band on rows where
    // the poller archived no window min/max.
    const lo = entry.min ?? entry.lat;
    const hi = entry.max ?? entry.lat;
    if (lo !== null) acc.min = acc.min === null ? lo : Math.min(acc.min, lo);
    if (hi !== null) acc.max = acc.max === null ? hi : Math.max(acc.max, hi);

    if (entry.jit !== null) {
      acc.sumJit += entry.jit;
      acc.countJit++;
    }
  }

  const out: LatencySample[] = [];
  for (const [timestamp, acc] of buckets) {
    // A bucket whose every probe was lost has no latency to state; the 100%
    // loss beside it is what reports the outage.
    const latency = acc.countLat > 0 ? round1(acc.sumLat / acc.countLat) : null;
    const { min, max } = acc;
    out.push({
      timestamp,
      key: String(timestamp),
      latency,
      loss: round1((acc.countNull / acc.total) * 100),
      jitter: acc.countJit > 0 ? round1(acc.sumJit / acc.countJit) : null,
      min,
      max,
      spread: min !== null && max !== null ? [min, max] : null,
      sampleCount: acc.total,
      ok: latency !== null,
    });
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

// --- Hook --------------------------------------------------------------------

export function useLatencyMonitoring(): UseLatencyMonitoringReturn {
  const [viewMode, setViewMode] = useState<ViewMode>("realtime");
  const isRealtime = viewMode === "realtime";

  const {
    data: modemStatus,
    receivedAtMs,
    isLoading: statusLoading,
    error: statusError,
    refresh: refreshStatus,
  } = useModemStatus({ pollInterval: STATUS_POLL_MS });

  const {
    data: pingHistory,
    isLoading: historyLoading,
    error: historyError,
    refresh: refreshHistory,
  } = useLatencyHistory({ enabled: !isRealtime });

  const connectivity = modemStatus?.connectivity ?? null;

  const intervalMs = useMemo(() => {
    const sec = connectivity?.history_interval_sec;
    return sec && sec > 0 ? sec * 1000 : FALLBACK_INTERVAL_MS;
  }, [connectivity?.history_interval_sec]);

  // Signature of the ring's CONTENT. The poll cadence and the sample cadence
  // drift in and out of step, so a landed snapshot is not itself a new sample.
  const historySig = useMemo(() => {
    const history = connectivity?.latency_history;
    if (!history || history.length === 0) return "";
    return `${intervalMs}|${history.join(",")}`;
  }, [connectivity?.latency_history, intervalMs]);

  const [anchor, setAnchor] = useState<HistoryAnchor | null>(null);

  // Derived DURING render, the sanctioned React pattern (see `useChartDrawIn`):
  // an effect would let one frame paint against a stale anchor.
  const seeded =
    historySig !== "" && receivedAtMs !== null && anchor?.sig !== historySig
      ? reanchor(anchor, historySig, intervalMs, receivedAtMs)
      : anchor;
  if (seeded !== anchor) setAnchor(seeded);

  const anchorMs = seeded?.sig === historySig ? seeded.atMs : null;

  const realtimeSamples = useMemo<LatencySample[]>(() => {
    const history = connectivity?.latency_history;
    if (!history || history.length === 0 || anchorMs === null) return [];
    return buildRealtimeSamples(history, intervalMs, anchorMs);
  }, [connectivity?.latency_history, intervalMs, anchorMs]);

  const aggregateSamples = useMemo<LatencySample[]>(() => {
    if (isRealtime) return [];
    return aggregateByBucket(pingHistory, BUCKET_MS[viewMode]);
  }, [isRealtime, viewMode, pingHistory]);

  const samples = isRealtime ? realtimeSamples : aggregateSamples;

  const tableSamples = useMemo(
    () => samples.slice(-TABLE_CAP),
    [samples],
  );

  const refresh = useCallback(() => {
    if (isRealtime) refreshStatus();
    else refreshHistory();
  }, [isRealtime, refreshStatus, refreshHistory]);

  return {
    viewMode,
    setViewMode,
    connectivity,
    samples,
    total: samples.length,
    tableSamples,
    intervalSec: isRealtime
      ? (connectivity?.history_interval_sec ?? null)
      : null,
    // `useLatencyHistory({ enabled: false })` never fetches, so its `isLoading`
    // stays true forever — realtime must never read it.
    isLoading: isRealtime ? statusLoading : historyLoading,
    error: isRealtime ? statusError : historyError,
    refresh,
  };
}

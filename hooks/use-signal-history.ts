"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { SignalHistoryEntry } from "@/types/modem-status";

// =============================================================================
// useSignalHistory — Polling Hook for Signal History Chart
// =============================================================================
// Fetches the per-antenna signal history NDJSON (converted to JSON array by
// the CGI endpoint) at the same cadence as Tier 1.5 polling (10s).
//
// Returns raw history entries and a chart-ready transformation that computes
// the best (highest) non-null antenna value per RAT per timestamp — matching
// the existing LTE-vs-5G chart layout.
//
// Usage:
//   const { chartData, isLoading, error } = useSignalHistory();
// =============================================================================

/** CGI endpoint that serves the NDJSON file as a JSON array */
const HISTORY_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh";

/** Poll every 10s to match Tier 1.5 backend interval */
const DEFAULT_POLL_INTERVAL = 10_000;

// --- Types -------------------------------------------------------------------

/** Shape expected by the Recharts AreaChart in signal-history.tsx */
export interface SignalChartPoint {
  /** Formatted time string, e.g. "14:32" */
  time: string;
  /** Best-antenna LTE RSRP (dBm), or null if no LTE data */
  rsrp4G: number | null;
  /** Best-antenna NR RSRP (dBm), or null if no NR data */
  rsrp5G: number | null;
  /** Best-antenna LTE RSRQ (dB) */
  rsrq4G: number | null;
  /** Best-antenna NR RSRQ (dB) */
  rsrq5G: number | null;
  /** Best-antenna LTE SINR (dB) */
  sinr4G: number | null;
  /** Best-antenna NR SINR (dB) */
  sinr5G: number | null;
}

export interface UseSignalHistoryOptions {
  /** Polling interval in ms (default: 10000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
}

export interface UseSignalHistoryReturn {
  /** Chart-ready data points (oldest first) */
  chartData: SignalChartPoint[];
  /** Raw history entries from backend */
  raw: SignalHistoryEntry[];
  /** True during the very first fetch */
  isLoading: boolean;
  /** Error message if the last fetch failed */
  error: string | null;
}

// --- Helpers -----------------------------------------------------------------

/**
 * Returns the best (highest / least negative) non-null value from a 4-element
 * antenna array. For RSRP/RSRQ/SINR, higher is always better.
 * Returns null if all values are null.
 */
function bestAntenna(values: (number | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (v !== null && (best === null || v > best)) {
      best = v;
    }
  }
  return best;
}

/**
 * Transforms a raw SignalHistoryEntry into a chart point.
 */
function toChartPoint(entry: SignalHistoryEntry): SignalChartPoint {
  const date = new Date(entry.ts * 1000);
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return {
    time,
    rsrp4G: bestAntenna(entry.lte_rsrp),
    rsrp5G: bestAntenna(entry.nr_rsrp),
    rsrq4G: bestAntenna(entry.lte_rsrq),
    rsrq5G: bestAntenna(entry.nr_rsrq),
    sinr4G: bestAntenna(entry.lte_sinr),
    sinr5G: bestAntenna(entry.nr_sinr),
  };
}

// --- Hook --------------------------------------------------------------------

export function useSignalHistory(
  options: UseSignalHistoryOptions = {}
): UseSignalHistoryReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [raw, setRaw] = useState<SignalHistoryEntry[]>([]);
  const [chartData, setChartData] = useState<SignalChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await authFetch(HISTORY_ENDPOINT);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: SignalHistoryEntry[] = await response.json();

      if (!mountedRef.current) return;

      setRaw(json);
      // Limit to last 10 data points for chart readability
      const recent = json.slice(-10);
      setChartData(recent.map(toChartPoint));
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to fetch signal history";
      setError(message);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    fetchHistory();
    // Paused while the tab is hidden; refetches at once when shown.
    const stop = startVisibleInterval(fetchHistory, pollInterval);

    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [fetchHistory, pollInterval, enabled]);

  return { chartData, raw, isLoading, error };
}

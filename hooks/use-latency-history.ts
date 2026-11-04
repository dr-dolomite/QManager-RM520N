"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { PingHistoryEntry } from "@/types/modem-status";

// =============================================================================
// useLatencyHistory — Polling Hook for Ping History Chart
// =============================================================================
// Fetches the ping history NDJSON (converted to JSON array by the CGI endpoint)
// at a 30-second interval. Historical data does not need real-time refresh.
//
// Returns raw PingHistoryEntry array for the component to aggregate into
// hourly, 12-hour, and daily buckets.
//
// Usage:
//   const { data, isLoading, error, refresh } = useLatencyHistory();
// =============================================================================

/** CGI endpoint that serves the NDJSON file as a JSON array */
const HISTORY_ENDPOINT =
  "/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh";

/** Poll every 30s — historical data does not need real-time cadence */
const DEFAULT_POLL_INTERVAL = 30_000;

export interface UseLatencyHistoryOptions {
  /** Polling interval in ms (default: 30000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
  /** Ask the CGI for only the newest N rows (default: none = the full 24 h) */
  last?: number;
}

export interface UseLatencyHistoryReturn {
  /** Raw history entries from backend (oldest first) */
  data: PingHistoryEntry[];
  /** True during the very first fetch */
  isLoading: boolean;
  /** Error message if the last fetch failed */
  error: string | null;
  /** Manually trigger an immediate refresh */
  refresh: () => void;
}

export function useLatencyHistory(
  options: UseLatencyHistoryOptions = {}
): UseLatencyHistoryReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true, last } = options;
  const url =
    last !== undefined && last > 0
      ? `${HISTORY_ENDPOINT}?last=${Math.floor(last)}`
      : HISTORY_ENDPOINT;

  const [data, setData] = useState<PingHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await authFetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: PingHistoryEntry[] = await response.json();

      if (!mountedRef.current) return;

      setData(json);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error
          ? err.message
          : "Failed to fetch ping history";
      setError(message);
      setIsLoading(false);
    }
  }, [url]);

  const refresh = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

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

  return { data, isLoading, error, refresh };
}

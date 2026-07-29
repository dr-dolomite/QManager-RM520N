"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { ModemStatus } from "@/types/modem-status";

// =============================================================================
// useModemStatus — Polling Hook for QManager Dashboard
// =============================================================================
// Fetches the cached modem status JSON from the CGI endpoint at a regular
// interval. Provides loading/error states and staleness detection.
//
// Usage:
//   const { data, isLoading, isStale, receivedAtMs, error, refresh } =
//     useModemStatus();
//
// The hook does NOT touch the modem — it only reads the pre-built JSON cache.
// =============================================================================

/** How often to poll the CGI endpoint (ms) */
const DEFAULT_POLL_INTERVAL = 2000;

/** After this many seconds without a fresh timestamp, data is "stale" */
const STALE_THRESHOLD_SECONDS = 10;

/** CGI endpoint path (proxied in dev via next.config.ts rewrites) */
const FETCH_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_data.sh";

export interface UseModemStatusOptions {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
}

export interface UseModemStatusReturn {
  /** The latest modem status data (null before first successful fetch) */
  data: ModemStatus | null;
  /** True during the very first fetch (before any data is available) */
  isLoading: boolean;
  /** True if the data's timestamp is older than the stale threshold */
  isStale: boolean;
  /**
   * Browser wall-clock ms at the moment the current `data` LANDED in this
   * client. `null` until the first successful fetch.
   *
   * This exists so consumers that measure elapsed time against a snapshot can
   * do it without reading a clock during render. It is deliberately NOT
   * `data.timestamp`: that field is stamped by the modem, and comparing it to a
   * browser `Date.now()` compares two unsynchronised clocks. It is deliberately
   * NOT a ticking value either — it changes only when a snapshot arrives, which
   * is what makes a render that consumes it idempotent.
   */
  receivedAtMs: number | null;
  /** Error message if the last fetch failed */
  error: string | null;
  /** Manually trigger an immediate refresh */
  refresh: () => void;
}

export function useModemStatus(
  options: UseModemStatusOptions = {}
): UseModemStatusReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [data, setData] = useState<ModemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [receivedAtMs, setReceivedAtMs] = useState<number | null>(null);

  // Use ref to track if the component is mounted (prevent state updates after unmount)
  const mountedRef = useRef(true);
  // Use ref for the interval so we can clear it
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await authFetch(FETCH_ENDPOINT);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: ModemStatus = await response.json();

      if (!mountedRef.current) return;

      setData(json);
      setError(null);

      // ONE clock read serves both consumers below, so a snapshot's arrival
      // time and its computed age can never disagree by the microseconds
      // between two `Date.now()` calls.
      //
      // This callback is the right place — and the only right place — to read a
      // clock in this hook. It runs once per landed response, not once per
      // render, so nothing here re-runs when React re-renders or replays a
      // component. Consumers that need "how long since this snapshot" read
      // `receivedAtMs` as data instead of reaching for their own `Date.now()`
      // during render, which is what `react-hooks/purity` is pointing at when
      // it flags one.
      const nowMs = Date.now();
      setReceivedAtMs(nowMs);

      // Staleness compares the MODEM's timestamp against the browser's clock.
      // The two are unsynchronised, which the 10s threshold absorbs; it is not
      // precise enough to be worth correcting, and a drifting modem clock
      // showing as stale is the safe direction to fail.
      const age = Math.floor(nowMs / 1000) - json.timestamp;
      setIsStale(age > STALE_THRESHOLD_SECONDS);

      // Clear loading state after first successful fetch
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to fetch modem status";
      setError(message);

      // Don't clear existing data on error — show stale data with error indicator
      // But do mark as stale
      setIsStale(true);
      setIsLoading(false);
    }
  }, []);

  // Manual refresh
  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Set up polling
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Fetch immediately on mount
    fetchData();

    // Set up interval
    intervalRef.current = setInterval(fetchData, pollInterval);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData, pollInterval, enabled]);

  return { data, isLoading, isStale, receivedAtMs, error, refresh };
}

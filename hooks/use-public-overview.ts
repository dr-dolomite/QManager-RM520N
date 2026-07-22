"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PublicOverview } from "@/types/public-overview";

// =============================================================================
// usePublicOverview — Polling hook for the unauthenticated overview card.
// =============================================================================
// Mirrors useModemStatus' shape and lifecycle but uses plain `fetch` (NOT
// authFetch). The endpoint is unauthenticated by design; sending a session
// cookie would be harmless but pointless.
//
// Resilience: tracks consecutive fetch failures and applies exponential
// backoff once a threshold is crossed. The component consumes the failure
// count to swap from "stale data + chip" to a full EmptyState once misses
// pile up, so users aren't left staring at indefinitely stale numbers.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/public/overview.sh";
// Pre-login cadence: a passerby on the landing page does not need 0.5 Hz
// refresh. 5 s keeps the card feeling live without hammering the device CGI.
const POLL_INTERVAL = 5000;
const MAX_POLL_INTERVAL = 60_000;
// First N failures keep the base interval; after that, double per failure.
const BACKOFF_THRESHOLD = 6;
const STALE_THRESHOLD_SECONDS = 15;

function computeNextInterval(failures: number): number {
  if (failures < BACKOFF_THRESHOLD) return POLL_INTERVAL;
  const exp = Math.min(failures - BACKOFF_THRESHOLD + 1, 4);
  return Math.min(POLL_INTERVAL * 2 ** exp, MAX_POLL_INTERVAL);
}

export interface UsePublicOverviewReturn {
  data: PublicOverview | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  consecutiveFailures: number;
  refresh: () => void;
}

export function usePublicOverview(): UsePublicOverviewReturn {
  const [data, setData] = useState<PublicOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  const mountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Mirrors consecutiveFailures state for synchronous reads inside tick() —
  // the next interval is computed before React commits the new state value.
  const failuresRef = useRef(0);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request before starting a new one. Prevents an
    // older response from clobbering newer state (e.g. when the user clicks
    // Retry while the previous poll is still in flight).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(FETCH_ENDPOINT, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = (await response.json()) as PublicOverview;
      if (!mountedRef.current || controller.signal.aborted) return;

      setData(json);
      setError(null);
      failuresRef.current = 0;
      setConsecutiveFailures(0);

      if (json.state === "ok") {
        const now = Math.floor(Date.now() / 1000);
        const age = now - json.timestamp;
        setIsStale(age > STALE_THRESHOLD_SECONDS);
      } else {
        // Non-ok states (setup_required / unavailable) are explicit backend
        // states, not stale data — the empty-state UI handles them.
        setIsStale(false);
      }
      setIsLoading(false);
    } catch (err) {
      // AbortError from our own controller is expected — swallow it silently.
      if (controller.signal.aborted) return;
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to fetch overview";
      setError(message);
      setIsStale(true);
      setIsLoading(false);
      failuresRef.current += 1;
      setConsecutiveFailures(failuresRef.current);
      // Retain prior `data` — never blank a working card on a transient error.
      // The component decides whether to swap to EmptyState based on the
      // failure count.
    }
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;

    const cancelPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    // Recursive tick. Each iteration re-derives its own delay so the backoff
    // takes effect immediately as failures accumulate, without needing to
    // tear down and rebuild a setInterval.
    const tick = async () => {
      if (!mountedRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await fetchData();
      if (!mountedRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      cancelPending();
      timeoutRef.current = setTimeout(tick, computeNextInterval(failuresRef.current));
    };

    // Initial fetch is unconditional (cold-start the card even if the tab is
    // hidden — first paint should still have data when the user comes back).
    void tick();

    // Pause polling when the tab is hidden, refresh + resume when it returns.
    // Keeps a backgrounded landing page from waking the device CGI every 5 s
    // and conserves battery on mobile.
    const handleVisibility = () => {
      if (document.hidden) {
        cancelPending();
      } else {
        void tick();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      mountedRef.current = false;
      cancelPending();
      abortRef.current?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [fetchData]);

  return { data, isLoading, isStale, error, consecutiveFailures, refresh };
}

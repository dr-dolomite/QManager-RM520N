"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { NetworkEvent } from "@/types/modem-status";

// =============================================================================
// useRecentActivities — Polling Hook for Network Events
// =============================================================================
// Fetches the NDJSON events file (converted to JSON array by the CGI) at a
// slower interval than the main dashboard poll. Events are things like band
// changes, PCI handoffs, CA activation, signal loss, etc.
//
// Usage:
//   const { events, isLoading, refresh } = useRecentActivities();
// =============================================================================

/** How often to poll the events CGI endpoint (ms) — slower than dashboard */
const DEFAULT_POLL_INTERVAL = 10_000;

/** CGI endpoint path */
const EVENTS_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_events.sh";

export interface UseRecentActivitiesOptions {
  /** Polling interval in ms (default: 10000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
  /** Maximum number of events to keep in state (default: 20, newest first) */
  maxEvents?: number;
}

export interface UseRecentActivitiesReturn {
  /** Network events, newest first */
  events: NetworkEvent[];
  /** True during the very first fetch */
  isLoading: boolean;
  /** True during a manual refresh (non-initial fetch) */
  isRefreshing: boolean;
  /** Error message if the last fetch failed */
  error: string | null;
  /** Manually trigger an immediate fetch and reset the poll timer */
  refresh: () => void;
}

export function useRecentActivities(
  options: UseRecentActivitiesOptions = {}
): UseRecentActivitiesReturn {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    enabled = true,
    maxEvents = 20,
  } = options;

  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const stopTimerRef = useRef<(() => void) | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchEvents = useCallback(async () => {
    if (hasLoadedOnce.current) {
      setIsRefreshing(true);
    }

    try {
      const response = await authFetch(EVENTS_ENDPOINT);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: NetworkEvent[] = await response.json();

      if (!mountedRef.current) return;

      // Events come oldest-first from the file; reverse for newest-first display
      const reversed = [...json].reverse().slice(0, maxEvents);
      setEvents(reversed);
      setError(null);
      hasLoadedOnce.current = true;
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to fetch events";
      setError(message);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [maxEvents]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    fetchEvents();
    // Paused while the tab is hidden; refetches at once when shown.
    stopTimerRef.current = startVisibleInterval(fetchEvents, pollInterval);

    return () => {
      mountedRef.current = false;
      stopTimerRef.current?.();
      stopTimerRef.current = null;
    };
  }, [fetchEvents, pollInterval, enabled]);

  const refresh = useCallback(() => {
    fetchEvents();
    // Restart the timer so the next poll is a full interval away.
    if (stopTimerRef.current) {
      stopTimerRef.current();
      stopTimerRef.current = startVisibleInterval(fetchEvents, pollInterval);
    }
  }, [fetchEvents, pollInterval]);

  return { events, isLoading, isRefreshing, error, refresh };
}

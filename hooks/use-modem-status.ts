"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { ModemStatus } from "@/types/modem-status";

// =============================================================================
// useModemStatus — Shared Polling Store for QManager
// =============================================================================
// Every caller reads ONE module-level snapshot of the cached modem status JSON,
// fetched by ONE timer. The timer runs at the shortest interval any mounted
// caller asks for, capped at MAX_POLL_INTERVAL, and stops while the tab is
// hidden. Each new caller triggers an immediate fetch, so a page that mounts
// later never shows an old snapshot as fresh.
//
// Usage:
//   const { data, isLoading, isStale, receivedAtMs, error, refresh } =
//     useModemStatus();
//
// The hook does NOT touch the modem — it only reads the pre-built JSON cache.
// =============================================================================

/** Interval a caller gets when it asks for none (ms); just over one poller cycle (~3.7-4 s) */
const DEFAULT_POLL_INTERVAL = 5000;

/** For pages that only read capabilities or config from the snapshot (ms) */
export const STATUS_POLL_SLOW_MS = 10_000;

/** For a live pointing tool where a cycle of lag matters (ms) */
export const STATUS_POLL_FAST_MS = 2000;

/**
 * Upper bound on the shared timer (ms). Every fetch_data.sh call is the poller's
 * UI heartbeat and its active-tier grace is 20 s, so an open page must poll at
 * least every 10 s whatever cadence its callers ask for.
 */
const MAX_POLL_INTERVAL = 10_000;

/** After this many seconds without a fresh timestamp, data is "stale" */
const STALE_THRESHOLD_SECONDS = 10;

/** CGI endpoint path (proxied in dev via next.config.ts rewrites) */
const FETCH_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_data.sh";

export interface UseModemStatusOptions {
  /** Requested polling interval in ms (default: 5000; the shared timer caps at 10000) */
  pollInterval?: number;
  /** Whether this caller drives polling (default: true). A disabled caller still reads the shared snapshot. */
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

interface StatusSnapshot {
  data: ModemStatus | null;
  isLoading: boolean;
  isStale: boolean;
  receivedAtMs: number | null;
  error: string | null;
}

const INITIAL_SNAPSHOT: StatusSnapshot = {
  data: null,
  isLoading: true,
  isStale: false,
  receivedAtMs: null,
  error: null,
};

// --- Module-level store ------------------------------------------------------

let snapshot: StatusSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
/** Live polling callers: subscriber id → requested interval (ms) */
const pollers = new Map<number, number>();
let nextPollerId = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let timerMs: number | null = null;
let inFlight: Promise<void> | null = null;
let visibilityBound = false;

function publish(next: StatusSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

async function runFetch(): Promise<void> {
  try {
    const response = await authFetch(FETCH_ENDPOINT);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const json: ModemStatus = await response.json();

    // The one clock read per landed response: arrival time and computed age
    // can never disagree, and nothing here re-runs on a render.
    const nowMs = Date.now();
    // Modem clock vs browser clock; the 10 s threshold absorbs the drift, and a
    // drifting modem showing as stale is the safe direction to fail.
    const age = Math.floor(nowMs / 1000) - json.timestamp;
    publish({
      data: json,
      isLoading: false,
      isStale: age > STALE_THRESHOLD_SECONDS,
      receivedAtMs: nowMs,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch modem status";
    // Keep the last data on error, marked stale.
    publish({ ...snapshot, isLoading: false, isStale: true, error: message });
  }
}

/** One request at a time: a call during a fetch joins the one in flight. */
function fetchStatus(): Promise<void> {
  if (!inFlight) {
    inFlight = runFetch().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Immediate shared refresh, for callers outside React (e.g. after a mutation). */
export function refreshModemStatus(): void {
  void fetchStatus();
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    timerMs = null;
  }
}

/** Re-arm the shared timer from the live callers' intervals and visibility. */
function reschedule() {
  if (pollers.size === 0 || document.hidden) {
    stopTimer();
    return;
  }
  const ms = Math.min(MAX_POLL_INTERVAL, ...pollers.values());
  if (timer !== null && timerMs === ms) return;
  stopTimer();
  timer = setInterval(() => void fetchStatus(), ms);
  timerMs = ms;
}

// A hidden tab stops polling: each fetch is the poller's UI heartbeat, and a
// forgotten tab would otherwise hold it at the full AT rate.
function handleVisibility() {
  if (!document.hidden && pollers.size > 0) void fetchStatus();
  reschedule();
}

function addPoller(intervalMs: number): number {
  const id = ++nextPollerId;
  pollers.set(id, intervalMs);
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", handleVisibility);
    visibilityBound = true;
  }
  reschedule();
  return id;
}

function updatePoller(id: number, intervalMs: number) {
  if (!pollers.has(id) || pollers.get(id) === intervalMs) return;
  pollers.set(id, intervalMs);
  reschedule();
}

function removePoller(id: number) {
  pollers.delete(id);
  if (pollers.size === 0 && visibilityBound) {
    document.removeEventListener("visibilitychange", handleVisibility);
    visibilityBound = false;
  }
  reschedule();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => INITIAL_SNAPSHOT;

// --- Hook --------------------------------------------------------------------

export function useModemStatus(
  options: UseModemStatusOptions = {}
): UseModemStatusReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const pollIntervalRef = useRef(pollInterval);
  const pollerIdRef = useRef<number | null>(null);

  // A changed interval re-arms the shared timer without an extra fetch.
  useEffect(() => {
    pollIntervalRef.current = pollInterval;
    if (pollerIdRef.current !== null) {
      updatePoller(pollerIdRef.current, pollInterval);
    }
  }, [pollInterval]);

  // Joining fetches at once (even while hidden, so the first paint has data).
  useEffect(() => {
    if (!enabled) return;
    const id = addPoller(pollIntervalRef.current);
    pollerIdRef.current = id;
    void fetchStatus();
    return () => {
      pollerIdRef.current = null;
      removePoller(id);
    };
  }, [enabled]);

  const refresh = useCallback(() => {
    void fetchStatus();
  }, []);

  return { ...state, refresh };
}

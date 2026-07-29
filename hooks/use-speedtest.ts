import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { SpeedtestStep } from "@/lib/speedtest-phases";
import type {
  SpeedtestCheckResponse,
  SpeedtestStartResponse,
  SpeedtestStatusResponse,
  SpeedtestFinalResult,
  SpeedtestProgressLine,
  SpeedtestServerEntry,
  SpeedtestServersResponse,
} from "@/types/speedtest";

// =============================================================================
// useSpeedtest — Speedtest Lifecycle Hook
// =============================================================================
// Manages the full speedtest lifecycle:
//   1. Check if speedtest-cli is available (on mount)
//   2. Detect if a test is already running (on dialog open, or continuously in
//      `watch` mode)
//   3. Start a new test
//   4. Poll progress while running
//   5. Surface final result on completion
//
// TWO CONSUMERS, TWO CADENCES
// ---------------------------
// The dialog mounts this hook to drive a test. The dashboard tile mounts it in
// `watch` mode so a run started from another tab shows up without the user
// opening anything. Those want very different polling costs, so the interval is
// derived from the mode and the phase rather than being a constant:
//
//   watch + not running   -> DETECT_INTERVAL_MS (cheap heartbeat)
//   running (either mode) -> LIVE_INTERVAL_MS   (smooth progress)
//   dialog + not running  -> no polling at all
//
// SCHEDULING: setTimeout, NOT setInterval
// ---------------------------------------
// Measured on the device: while a test runs, the Ookla binary saturates the
// single core and this endpoint takes up to ~30s to answer (it is normally
// <1s). setInterval fires regardless of whether the previous request returned,
// so a 500ms interval against a 30s response time queues ~60 overlapping
// requests onto a CPU that is already the bottleneck. A self-scheduling
// timeout books the next poll only after the current one settles, so under
// load the cadence degrades instead of stampeding.
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/at_cmd";

/** Cadence while a test is actively running — fast enough to animate. */
const LIVE_INTERVAL_MS = 500;
/** Cadence for `watch` consumers just checking whether a run has appeared. */
const DETECT_INTERVAL_MS = 10_000;

/**
 * Ookla's ping phase emits ~5 progress lines and finishes inside one second,
 * so at the live cadence it would be gone in a frame or two — the step chips
 * would appear to jump from "connecting" straight to "download", with latency
 * completing before it was ever seen to start. Hold the ping phase on screen
 * for at least this long so the three-step sequence reads as three steps.
 * This delays only the *presentation*; the test itself is unaffected.
 */
const PING_FLOOR_MS = 600;

export type SpeedtestPhase =
  | "idle"
  | "initializing"
  | "ping"
  | "download"
  | "upload"
  | "complete"
  | "error";

/** Last bandwidth seen for a phase, in bytes/sec, kept so a failed run can still report what it managed. */
export interface SpeedtestPhaseFigures {
  download?: number;
  upload?: number;
}

export interface UseSpeedtestOptions {
  /**
   * Poll continuously (at DETECT_INTERVAL_MS) even when no test is running, so
   * a run started elsewhere is picked up. The dashboard tile sets this; the
   * dialog does not.
   */
  watch?: boolean;
}

export interface UseSpeedtestReturn {
  /** Whether speedtest-cli binary is available on the system */
  isAvailable: boolean | null;
  /** Current phase of the speedtest lifecycle */
  phase: SpeedtestPhase;
  /** 0–1 progress within the current phase */
  progress: number;
  /** Latest progress data from the running test */
  currentProgress: SpeedtestProgressLine | null;
  /** Final result (persists after completion, also loaded from cache) */
  result: SpeedtestFinalResult | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Which step was in flight when the run failed (null if it failed before any step) */
  failedAt: SpeedtestStep | null;
  /** Best-known figures from steps that completed before a failure */
  phaseFigures: SpeedtestPhaseFigures;
  /** Whether a test is actively running */
  isRunning: boolean;
  /** Nearby servers available for selection */
  servers: SpeedtestServerEntry[];
  /** Currently selected server ID (null = automatic) */
  selectedServer: number | null;
  /** Whether servers are being fetched */
  isLoadingServers: boolean;
  /** Set when the server list could not be fetched (the endpoint fails with HTTP 200) */
  serversError: boolean;
  /** Start a new speedtest */
  start: () => Promise<void>;
  /** Refresh status (detect if a test is running from another tab) */
  refreshStatus: () => Promise<void>;
  /** Fetch nearby servers */
  fetchServers: () => Promise<void>;
  /** Set server selection (null = automatic) */
  setSelectedServer: (id: number | null) => void;
}

export function useSpeedtest(
  options: UseSpeedtestOptions = {},
): UseSpeedtestReturn {
  const { watch = false } = options;

  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<SpeedtestPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [currentProgress, setCurrentProgress] =
    useState<SpeedtestProgressLine | null>(null);
  const [result, setResult] = useState<SpeedtestFinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedAt, setFailedAt] = useState<SpeedtestStep | null>(null);
  const [phaseFigures, setPhaseFigures] = useState<SpeedtestPhaseFigures>({});
  const [servers, setServers] = useState<SpeedtestServerEntry[]>([]);
  const [selectedServer, setSelectedServer] = useState<number | null>(null);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [serversError, setServersError] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  /** Live mirror of `phase`, so the scheduler can pick a cadence without re-creating itself. */
  const phaseRef = useRef<SpeedtestPhase>("idle");
  /** When the ping phase was first shown, for the PING_FLOOR_MS hold. */
  const pingShownAtRef = useRef<number | null>(null);
  /** A phase advance deferred by the ping floor, applied when the floor expires. */
  const deferredRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRunning =
    phase === "initializing" ||
    phase === "ping" ||
    phase === "download" ||
    phase === "upload";

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (deferredRef.current) clearTimeout(deferredRef.current);
      timerRef.current = null;
      deferredRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Check availability (once on mount)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const check = async () => {
      try {
        const resp = await authFetch(`${CGI_BASE}/speedtest_check.sh`);
        if (!resp.ok) {
          if (mountedRef.current) setIsAvailable(false);
          return;
        }
        const data: SpeedtestCheckResponse = await resp.json();
        if (mountedRef.current) setIsAvailable(data.available);
      } catch {
        if (mountedRef.current) setIsAvailable(false);
      }
    };
    check();
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch nearby servers
  //
  // cgi_base.sh emits its failures as {"success":false,...} with HTTP 200, so
  // `resp.ok` is true on every failure mode this endpoint has. Without an
  // explicit error flag the list silently collapses to "Automatic" only and the
  // user is told nothing — which is the most likely outcome on a modem that has
  // just lost its connection, i.e. exactly when someone opens a speed test.
  // ---------------------------------------------------------------------------
  const fetchServers = useCallback(async () => {
    setIsLoadingServers(true);
    setServersError(false);
    try {
      const resp = await authFetch(`${CGI_BASE}/speedtest_servers.sh`);
      if (!resp.ok) {
        if (mountedRef.current) setServersError(true);
        return;
      }
      const data: SpeedtestServersResponse = await resp.json();
      if (!mountedRef.current) return;
      if (data.success && data.servers) {
        setServers(data.servers);
      } else {
        setServersError(true);
      }
    } catch {
      if (mountedRef.current) setServersError(true);
    } finally {
      if (mountedRef.current) setIsLoadingServers(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Phase application, with the ping floor
  //
  // Advancing out of `ping` is deferred until the floor has elapsed. Every
  // other transition is immediate — in particular `complete` and `error` are
  // never delayed, because a finished or failed run must not be held behind a
  // cosmetic timer.
  // ---------------------------------------------------------------------------
  const applyPhase = useCallback((next: SpeedtestPhase) => {
    const commit = (p: SpeedtestPhase) => {
      if (!mountedRef.current) return;
      phaseRef.current = p;
      setPhase(p);
      if (p === "ping" && pingShownAtRef.current === null) {
        pingShownAtRef.current = Date.now();
      }
      if (p !== "ping") pingShownAtRef.current = null;
    };

    if (deferredRef.current) {
      clearTimeout(deferredRef.current);
      deferredRef.current = null;
    }

    const leavingPing =
      phaseRef.current === "ping" && next !== "ping" && next !== "error";
    const shownFor = pingShownAtRef.current
      ? Date.now() - pingShownAtRef.current
      : Number.POSITIVE_INFINITY;

    if (leavingPing && shownFor < PING_FLOOR_MS) {
      deferredRef.current = setTimeout(() => {
        deferredRef.current = null;
        commit(next);
      }, PING_FLOOR_MS - shownFor);
      return;
    }

    commit(next);
  }, []);

  // ---------------------------------------------------------------------------
  // Core poll
  // ---------------------------------------------------------------------------
  const pollStatus = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/speedtest_status.sh`);
      if (!resp.ok) return;
      const data: SpeedtestStatusResponse = await resp.json();
      if (!mountedRef.current) return;

      switch (data.status) {
        case "idle":
          // Server says idle. Don't reset if viewing results.
          if (
            phaseRef.current !== "complete" &&
            phaseRef.current !== "error" &&
            phaseRef.current !== "idle"
          ) {
            applyPhase("idle");
            setProgress(0);
            setCurrentProgress(null);
          }
          break;

        case "running": {
          // A `running` response with NO phase is the status endpoint's lock
          // contention answer — it means "a test is in flight but I could not
          // read its state this instant". Defaulting to "initializing" here
          // would snap a download back to "Connecting" every time the lock was
          // busy, so an absent phase preserves whatever we already had.
          if (data.phase) {
            applyPhase(data.phase as SpeedtestPhase);
          } else if (!isRunningPhase(phaseRef.current)) {
            applyPhase("initializing");
          }

          const p = data.progress;
          if (p && typeof p === "object") {
            setCurrentProgress(p);
            if (p.type === "ping") setProgress(p.ping.progress);
            else if (p.type === "download") {
              setProgress(p.download.progress);
              setPhaseFigures((prev) => ({
                ...prev,
                download: p.download.bandwidth,
              }));
            } else if (p.type === "upload") {
              setProgress(p.upload.progress);
              setPhaseFigures((prev) => ({
                ...prev,
                upload: p.upload.bandwidth,
              }));
            } else setProgress(0);
          }
          break;
        }

        case "complete":
          applyPhase("complete");
          setProgress(1);
          setResult(data.result);
          setCurrentProgress(null);
          break;

        case "error":
          // Record which step died BEFORE flipping the phase, so the step chips
          // can keep reporting how far the run actually got.
          setFailedAt(asStep(phaseRef.current));
          applyPhase("error");
          setError(data.detail || data.error);
          setCurrentProgress(null);
          break;
      }
    } catch {
      // Network error during poll — not critical, retry on the next tick
    }
  }, [applyPhase]);

  // ---------------------------------------------------------------------------
  // Self-scheduling poll loop
  //
  // `inFlightRef` is the anti-stampede guard: a tick that fires while the
  // previous request is still outstanding does nothing, because that request's
  // own completion will book the next one.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const shouldPoll = watch || isRunning;
    if (!shouldPoll) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled || !mountedRef.current) return;
      if (!inFlightRef.current) {
        inFlightRef.current = true;
        try {
          await pollStatus();
        } finally {
          inFlightRef.current = false;
        }
      }
      if (cancelled || !mountedRef.current) return;
      const delay = isRunningPhase(phaseRef.current)
        ? LIVE_INTERVAL_MS
        : DETECT_INTERVAL_MS;
      timerRef.current = setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [watch, isRunning, pollStatus]);

  // ---------------------------------------------------------------------------
  // Start a new test
  // ---------------------------------------------------------------------------
  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setFailedAt(null);
    setPhaseFigures({});
    setProgress(0);
    setCurrentProgress(null);
    applyPhase("initializing");

    try {
      const body: Record<string, unknown> = {};
      if (selectedServer !== null) {
        body.server_id = selectedServer;
      }

      const resp = await authFetch(`${CGI_BASE}/speedtest_start.sh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        if (!mountedRef.current) return;
        applyPhase("error");
        setError("Failed to start speedtest (HTTP error)");
        return;
      }

      const data: SpeedtestStartResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        if (data.error === "already_running") {
          // Another tab/instance started it — follow along. The poll effect is
          // already live because the phase is `initializing`.
          return;
        }
        applyPhase("error");
        setError(data.detail || data.error || "Unknown error");
        return;
      }
      // Success — the poll effect picks it up from the `initializing` phase.
    } catch (err) {
      if (mountedRef.current) {
        applyPhase("error");
        setError(
          err instanceof Error ? err.message : "Failed to start speedtest",
        );
      }
    }
  }, [applyPhase, selectedServer]);

  // ---------------------------------------------------------------------------
  // Refresh status — called on dialog open to detect in-progress tests
  // or load cached results from a previous run
  // ---------------------------------------------------------------------------
  const refreshStatus = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/speedtest_status.sh`);
      if (!resp.ok) return;
      const data: SpeedtestStatusResponse = await resp.json();
      if (!mountedRef.current) return;

      if (data.status === "running") {
        applyPhase((data.phase as SpeedtestPhase) || "initializing");
        if (data.progress) setCurrentProgress(data.progress);
      } else if (data.status === "complete") {
        applyPhase("complete");
        setResult(data.result);
        setProgress(1);
      }
      // idle or error — user can start a new test
    } catch {
      // Silent failure
    }
  }, [applyPhase]);

  return {
    isAvailable,
    phase,
    progress,
    currentProgress,
    result,
    error,
    failedAt,
    phaseFigures,
    isRunning,
    servers,
    selectedServer,
    isLoadingServers,
    serversError,
    start,
    refreshStatus,
    fetchServers,
    setSelectedServer,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function isRunningPhase(p: SpeedtestPhase): boolean {
  return (
    p === "initializing" || p === "ping" || p === "download" || p === "upload"
  );
}

/** Narrow a phase to a step chip, or null when the phase is off-sequence. */
function asStep(p: SpeedtestPhase): SpeedtestStep | null {
  return p === "ping" || p === "download" || p === "upload" ? p : null;
}

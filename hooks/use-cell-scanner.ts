"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { authFetch } from "@/lib/auth-fetch";
import type {
  CellScanResult,
  CellScanStatusResponse,
  ScanStatus,
} from "@/types/cell-scanner";

// Poll interval while a scan is running (ms)
const SCAN_POLL_INTERVAL = 2000;
// sessionStorage key for persisting scan start time across navigations
const SCAN_START_KEY = "qm_cell_scan_start";

/**
 * How many consecutive failed polls before the surface calls it.
 *
 * The poll's catch block used to be EMPTY, with a comment reading "keep
 * retrying". That is a defensible policy for one dropped request and an
 * indefensible one for a modem that has gone away: the page kept the spinner up
 * and the elapsed clock counting for as long as the tab stayed open, and told
 * the user nothing. Five at a 2s cadence is ~10s of silence, which is long
 * enough to ride out a single reload of lighttpd and short enough that a real
 * loss surfaces while the user is still watching.
 */
const MAX_POLL_FAILURES = 5;

interface UseCellScannerReturn {
  status: ScanStatus;
  results: CellScanResult[];
  error: string | null;
  elapsedSeconds: number;
  startScan: () => Promise<void>;
}

export function useCellScanner(): UseCellScannerReturn {
  const { t } = useTranslation("cellular");

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [results, setResults] = useState<CellScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureCountRef = useRef(0);
  // Ref to always hold the latest pollStatus for use in setInterval callbacks,
  // avoiding stale closures when pollStatus is recreated by useCallback.
  const pollStatusRef = useRef<() => Promise<void>>(null!);
  /**
   * The latest `t`, held in a ref so it can be READ inside the callbacks
   * without being a DEPENDENCY of them.
   *
   * i18next is initialised with the default `bindI18n: 'languageChanged'`, so
   * `useTranslation` hands back a new `t` identity the moment the user switches
   * language. When `t` sat in `pollStatus`'s dep array, that new identity
   * rebuilt `pollStatus`, which rebuilt the mount effect below, whose cleanup
   * calls `stopPolling()` — so changing language mid-sweep tore down the poll
   * interval and nothing ever armed it again. The sweep kept running on the
   * modem for its full three minutes while the UI stopped watching, forever.
   *
   * The ref keeps the messages fresh (a translation is only read at the moment
   * an error is raised, never cached) while making `pollStatus` identity-stable,
   * which is what the interval and the mount effect actually need. Removing `t`
   * from the deps WITHOUT this ref would be the stale-closure bug instead:
   * errors raised after a language switch would still be worded in the old one.
   */
  const tRef = useRef(t);
  tRef.current = t;

  // --- Helpers: interval management ------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (startTime: number) => {
      stopTimer();
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    },
    [stopTimer],
  );

  const finishScan = useCallback(() => {
    stopPolling();
    stopTimer();
    failureCountRef.current = 0;
    sessionStorage.removeItem(SCAN_START_KEY);
  }, [stopPolling, stopTimer]);

  /** Start polling using the ref-based callback to avoid stale closures. */
  const ensurePolling = useCallback(() => {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(
      () => pollStatusRef.current(),
      SCAN_POLL_INTERVAL,
    );
  }, []);

  // --- Poll for scan status --------------------------------------------------
  const pollStatus = useCallback(async () => {
    try {
      const res = await authFetch(
        `/cgi-bin/quecmanager/at_cmd/cell_scan_status.sh?_t=${Date.now()}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: CellScanStatusResponse = await res.json();
      failureCountRef.current = 0;

      switch (data.status) {
        case "running":
          setStatus("running");
          // Fix: if we detect a running scan but have no polling interval
          // (mount-time detection), start one via the ref-based callback.
          ensurePolling();
          // If we detect a running scan but have no timer, restore it
          if (!timerRef.current) {
            const stored = sessionStorage.getItem(SCAN_START_KEY);
            const startTime = stored ? Number(stored) : Date.now();
            if (!stored) {
              sessionStorage.setItem(SCAN_START_KEY, String(startTime));
            }
            startTimer(startTime);
          }
          break;

        case "complete": {
          const cells = data.results ?? [];
          setStatus("complete");
          setResults(cells);
          setError(null);
          finishScan();
          if (cells.length > 0) {
            toast.success(tRef.current("cell_scanner.toast.scan_complete_title"), {
              description: tRef.current("cell_scanner.toast.scan_complete_desc", {
                count: cells.length,
              }),
            });
          }
          break;
        }

        case "error":
          setStatus("error");
          setError(data.message ?? tRef.current("cell_scanner.error.scan_failed"));
          finishScan();
          break;

        default:
          // "idle". Two very different situations arrive here and they must not
          // be answered the same way:
          //
          //  - No interval armed. This is the mount poll on a page where nothing
          //    has ever run. Genuinely idle; say nothing.
          //  - An interval IS armed. A sweep was in flight and the status file
          //    now reports nothing at all — no result, no error. The run
          //    vanished. This used to drop the surface silently back to `idle`,
          //    which reads to the user exactly as if the button had never been
          //    pressed: the spinner disappears, the empty state returns, and the
          //    interface volunteers no account of the three minutes it just
          //    spent. Report it as the failure it is.
          if (pollRef.current) {
            setStatus("error");
            setError(tRef.current("cell_scanner.error.scan_vanished"));
            finishScan();
          }
          break;
      }
    } catch {
      // A dropped poll is not on its own a failed scan — the sweep runs on the
      // modem, not in this tab. But silence is not an answer either: after
      // MAX_POLL_FAILURES consecutive misses the run is reported as lost rather
      // than left spinning forever behind an empty catch.
      failureCountRef.current += 1;
      if (failureCountRef.current < MAX_POLL_FAILURES) return;
      if (!pollRef.current) return;

      setStatus("error");
      setError(tRef.current("cell_scanner.error.poll_lost"));
      finishScan();
      toast.error(tRef.current("cell_scanner.toast.poll_failed_title"), {
        description: tRef.current("cell_scanner.toast.poll_failed_desc"),
      });
    }
  }, [ensurePolling, finishScan, startTimer]);

  // Keep the ref in sync so interval callbacks always use the latest pollStatus
  pollStatusRef.current = pollStatus;

  // --- Start a new scan ------------------------------------------------------
  const startScan = useCallback(async () => {
    setStatus("running");
    setError(null);
    failureCountRef.current = 0;

    try {
      const res = await authFetch(
        "/cgi-bin/quecmanager/at_cmd/cell_scan_start.sh",
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (!data.success) {
        if (data.error === "already_running") {
          // Scan already in progress — restore timer from sessionStorage, start polling
          setStatus("running");
          const stored = sessionStorage.getItem(SCAN_START_KEY);
          const startTime = stored ? Number(stored) : Date.now();
          if (!stored) sessionStorage.setItem(SCAN_START_KEY, String(startTime));
          startTimer(startTime);
          ensurePolling();
          return;
        }

        // The OTHER scan type holds the modem — a neighbour read, in this
        // direction. This is emphatically NOT the `already_running` case above
        // and must never fall into it: attaching would arm the poll loop against
        // a sweep status file that does not exist, which answers `idle` one
        // second later and drops the surface back to rest. The user would press
        // Sweep, watch a spinner for a second, and be told nothing at all.
        //
        // The CGI sends a `detail` string, but it is English-only, so it is
        // deliberately discarded in favour of translated copy that also says how
        // long the wait is worth.
        if (data.error === "other_scan_running") {
          setStatus("error");
          setError(tRef.current("cell_scanner.error.other_scan_running"));
          return;
        }

        setStatus("error");
        setError(
          data.detail ||
            data.error ||
            tRef.current("cell_scanner.error.start_failed"),
        );
        return;
      }

      // Store scan start time for elapsed timer persistence
      const startTime = Date.now();
      sessionStorage.setItem(SCAN_START_KEY, String(startTime));
      startTimer(startTime);

      // Begin polling for results via ref-based callback
      stopPolling();
      pollRef.current = setInterval(
        () => pollStatusRef.current(),
        SCAN_POLL_INTERVAL,
      );
    } catch {
      setStatus("error");
      setError(tRef.current("cell_scanner.error.start_unreachable"));
    }
  }, [ensurePolling, startTimer, stopPolling]);

  // --- Check for existing results on mount -----------------------------------
  useEffect(() => {
    pollStatus();
    return () => {
      stopPolling();
      stopTimer();
    };
  }, [pollStatus, stopPolling, stopTimer]);

  // --- beforeunload guard while scanning -------------------------------------
  useEffect(() => {
    if (status !== "running") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);

  return { status, results, error, elapsedSeconds, startScan };
}

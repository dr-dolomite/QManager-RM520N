"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { authFetch } from "@/lib/auth-fetch";
import type {
  NeighbourCellResult,
  NeighbourScanStatusResponse,
  ScanStatus,
} from "@/types/cell-scanner";

// =============================================================================
// The neighbour read's transport
// =============================================================================
// Deliberately a SEPARATE hook from `useCellScanner`, not a shared generic. The
// two drive different endpoints with different lifetimes, and the parts that
// looked shareable are exactly the parts that should differ (see the interval
// note below). What genuinely was shared — the table, the hero, the lock dialog,
// the state panels — is shared as components. Merging the transports too would
// buy one fewer file and cost the ability to tune either.
//
// This hook USED to be the weaker twin of `useCellScanner`, and the gap was not
// stylistic: it had no `pollStatusRef`, so every `setInterval` callback captured
// the first render's `pollStatus` and its closure went stale; and its poll catch
// block was empty, so a modem that stopped answering left the surface spinning
// silently for as long as the tab stayed open. Both are fixed here.
// =============================================================================

/**
 * 1s, and NOT the parent's 2s.
 *
 * This is the one place the two transports should genuinely disagree. A neighbour
 * read is three short AT commands and a `sleep 1` — it finishes in about two
 * seconds, so a 2s cadence would routinely spend a whole extra poll after the
 * result was already on disk and make a fast operation feel slow. The parent
 * sweeps for up to 180s, where a 1s cadence would be 180 pointless requests
 * against a modem that is deliberately busy.
 */
const SCAN_POLL_INTERVAL = 1000;

/**
 * Consecutive failed polls before the run is called lost.
 *
 * Five at a 1s cadence is ~5s of silence. The parent allows ~10s because a sweep
 * has a legitimate reason to be unreachable — it is holding the AT mutex — while
 * a neighbour read does not, so this surface can be less patient without risking
 * a false negative.
 */
const MAX_POLL_FAILURES = 5;

interface UseNeighbourScannerReturn {
  status: ScanStatus;
  results: NeighbourCellResult[];
  error: string | null;
  startScan: () => Promise<void>;
}

export function useNeighbourScanner(): UseNeighbourScannerReturn {
  const { t } = useTranslation("cellular");

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [results, setResults] = useState<NeighbourCellResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureCountRef = useRef(0);
  // Always holds the latest `pollStatus`, so an interval callback armed on one
  // render never calls the closure from an earlier one.
  const pollStatusRef = useRef<() => Promise<void>>(null!);
  /**
   * The latest `t`, held so the callbacks can READ it without DEPENDING on it.
   *
   * i18next runs with the default `bindI18n: 'languageChanged'`, so switching
   * language hands back a fresh `t` identity. With `t` in `pollStatus`'s dep
   * array that rebuilt `pollStatus`, which rebuilt the mount effect, whose
   * cleanup calls `stopPolling()` — a language change mid-read killed the
   * interval and nothing re-armed it. The ref keeps every message current
   * (translations are read at the moment an error is raised, never cached)
   * while leaving `pollStatus` identity-stable, which is the only property the
   * interval and the mount effect care about.
   */
  const tRef = useRef(t);
  tRef.current = t;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const finishScan = useCallback(() => {
    stopPolling();
    failureCountRef.current = 0;
  }, [stopPolling]);

  /** Arm the interval through the ref, never through a captured callback. */
  const ensurePolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(
      () => pollStatusRef.current(),
      SCAN_POLL_INTERVAL,
    );
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await authFetch(
        `/cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh?_t=${Date.now()}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: NeighbourScanStatusResponse = await res.json();
      failureCountRef.current = 0;

      switch (data.status) {
        case "running":
          setStatus("running");
          // Mount-time detection: a read started on another route may still be
          // in flight, and without this it would never be polled.
          ensurePolling();
          break;

        case "complete": {
          const cells = data.results ?? [];
          setStatus("complete");
          setResults(cells);
          setError(null);
          finishScan();
          if (cells.length > 0) {
            toast.success(
              tRef.current("cell_scanner.neighbour.toast.complete_title"),
              {
                description: tRef.current(
                  "cell_scanner.neighbour.toast.complete_desc",
                  { count: cells.length },
                ),
              },
            );
          }
          break;
        }

        case "error":
          setStatus("error");
          setError(
            data.message ?? tRef.current("cell_scanner.neighbour.error.failed"),
          );
          finishScan();
          break;

        default:
          // "idle", and which of the two idles matters.
          //
          // No interval armed: the mount poll on a page where nothing has run.
          // Genuinely idle, and silence is the right answer.
          //
          // An interval armed: a read WAS in flight and the worker died without
          // writing either a result or an error. Resetting to `idle` here — the
          // old behaviour — is indistinguishable from never having pressed the
          // button, so the surface owes the user an account instead.
          if (pollRef.current) {
            setStatus("error");
            setError(tRef.current("cell_scanner.neighbour.error.scan_vanished"));
            finishScan();
          }
          break;
      }
    } catch {
      // One dropped poll is not a failed read — the worker runs on the modem,
      // not in this tab. Sustained silence is, and it gets reported rather than
      // swallowed.
      failureCountRef.current += 1;
      if (failureCountRef.current < MAX_POLL_FAILURES) return;
      if (!pollRef.current) return;

      setStatus("error");
      setError(tRef.current("cell_scanner.neighbour.error.poll_lost"));
      finishScan();
      toast.error(
        tRef.current("cell_scanner.neighbour.toast.poll_failed_title"),
        {
          description: tRef.current(
            "cell_scanner.neighbour.toast.poll_failed_desc",
          ),
        },
      );
    }
  }, [ensurePolling, finishScan]);

  pollStatusRef.current = pollStatus;

  const startScan = useCallback(async () => {
    setStatus("running");
    setError(null);
    failureCountRef.current = 0;

    try {
      const res = await authFetch(
        "/cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh",
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (!data.success) {
        if (data.error === "already_running") {
          // Someone else's read is in flight. Attach to it rather than
          // reporting a failure the user cannot act on.
          setStatus("running");
          ensurePolling();
          return;
        }

        // The other scan type holds the modem — a full band sweep, in this
        // direction, which is the expensive one to wait on. It must NOT fall
        // through to `already_running` above: attaching would poll a neighbour
        // status file that does not exist, read `idle` a second later, and reset
        // the surface as though the button had never been pressed. The CGI's
        // `detail` is English-only and is dropped in favour of copy that names
        // the wait.
        if (data.error === "other_scan_running") {
          setStatus("error");
          setError(tRef.current("cell_scanner.neighbour.error.other_scan_running"));
          return;
        }

        setStatus("error");
        setError(
          data.detail ||
            data.error ||
            tRef.current("cell_scanner.neighbour.error.start_failed"),
        );
        return;
      }

      stopPolling();
      pollRef.current = setInterval(
        () => pollStatusRef.current(),
        SCAN_POLL_INTERVAL,
      );
    } catch {
      setStatus("error");
      setError(tRef.current("cell_scanner.neighbour.error.start_unreachable"));
    }
  }, [ensurePolling, stopPolling]);

  // Pick up a result or an in-flight read left by a previous visit.
  useEffect(() => {
    pollStatus();
    return () => stopPolling();
  }, [pollStatus, stopPolling]);

  // NO `beforeunload` GUARD, and that is deliberate. The parent installs one
  // because losing a 3-minute sweep is expensive and the modem stays busy after
  // the tab closes. A neighbour read costs two seconds and can simply be run
  // again; prompting "are you sure you want to leave?" over it would be the
  // interface inventing a stake it does not have.

  return { status, results, error, startScan };
}

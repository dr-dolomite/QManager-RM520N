"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  BandActionResult,
  BandCategory,
  CurrentBands,
  FailoverState,
  BandCurrentResponse,
  BandLockResponse,
  FailoverToggleResponse,
  FailoverStatusResponse,
} from "@/types/band-locking";
import { bandArrayToString } from "@/types/band-locking";

// =============================================================================
// useBandLocking — Band Lock State, Lock/Unlock, & Failover Hook
// =============================================================================
// Manages the band locking lifecycle: fetching current locked bands,
// applying per-category band locks, unlocking all bands, and toggling
// the failover safety mechanism.
//
// After a successful band lock (when failover is enabled), the hook polls
// the lightweight failover_status.sh endpoint every 1s until the watcher
// process completes. This detects whether failover activated and updates
// the UI accordingly — without touching the modem.
//
// Read and write failures are separate: `readError` is the `current.sh` read; each mutator RETURNS its failure,
// already resolved through `resolveErrorMessage`, so the page toasts it with no hook-state read after an `await`.
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/bands/current.sh           → locked bands + failover
//   GET  /cgi-bin/quecmanager/bands/failover_status.sh   → lightweight flag check
//   POST /cgi-bin/quecmanager/bands/lock.sh              → apply band lock
//   POST /cgi-bin/quecmanager/bands/failover_toggle.sh   → enable/disable failover
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/bands";
const FAILOVER_POLL_INTERVAL = 1000; // 1s — watcher sleeps 5s then checks
const K = "band_locking.errors";

export interface UseBandLockingReturn {
  /** Currently locked/configured bands from ue_capability_band */
  currentBands: CurrentBands | null;
  /** Failover safety mechanism state */
  failover: FailoverState;
  /** True during the INITIAL fetch only. A manual refresh sets `isRefreshing`. */
  isLoading: boolean;
  /** True while a manual `refresh()` is in flight; the loaded layout stays up. */
  isRefreshing: boolean;
  /** Which band category is currently being locked/unlocked (null = idle) */
  lockingCategory: BandCategory | null;
  /**
   * Why the last `current.sh` read failed, or null; a failed read keeps the previous `currentBands`, so this is the
   * only signal the figures are stale.
   */
  readError: string | null;
  /** Lock specific bands for one category, then re-read the current bands. */
  lockBands: (
    category: BandCategory,
    bands: number[],
  ) => Promise<BandActionResult>;
  /** Unlock all bands for one category by locking the full supported list. */
  unlockAll: (
    category: BandCategory,
    supportedBands: number[],
  ) => Promise<BandActionResult>;
  /** Toggle the failover safety mechanism on/off. */
  toggleFailover: (enabled: boolean) => Promise<BandActionResult>;
  /** Re-read current bands + failover state. Resolves true on success. */
  refresh: () => Promise<boolean>;
}

export function useBandLocking(): UseBandLockingReturn {
  const { t } = useTranslation("cellular");
  const [currentBands, setCurrentBands] = useState<CurrentBands | null>(null);
  const [failover, setFailover] = useState<FailoverState>({
    enabled: false,
    activated: false,
    watcher_running: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lockingCategory, setLockingCategory] = useState<BandCategory | null>(
    null,
  );
  const [readError, setReadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // `t` changes identity on a language switch; keeping it out of
  // `fetchCurrent`'s deps stops a switch from re-reading over the AT lock.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const failoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up any running failover poll on unmount
      if (failoverPollRef.current) {
        clearInterval(failoverPollRef.current);
        failoverPollRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current locked bands + failover state (full — touches modem)
  // ---------------------------------------------------------------------------
  // Resolves whether the READ succeeded. An unmount mid-flight still returns
  // the real outcome and only skips the state writes.
  const fetchCurrent = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(`${CGI_BASE}/current.sh?_t=${Date.now()}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data: BandCurrentResponse = await resp.json();

      // `current` and `failover` are omitted from the error envelope; guarding
      // the payload means a malformed success never writes undefined to state.
      if (!data.success || !data.current || !data.failover) {
        if (mountedRef.current) {
          setReadError(
            resolveErrorMessage(
              tRef.current,
              data.error,
              data.detail,
              tRef.current(`${K}.read_failed`),
            ),
          );
        }
        return false;
      }

      if (!mountedRef.current) return true;

      setCurrentBands(data.current);
      // RM520N's `current.sh` reports `watcher_running` too, so it is taken as-is.
      setFailover(data.failover);
      setReadError(null);
      return true;
    } catch {
      if (mountedRef.current) setReadError(tRef.current(`${K}.read_failed`));
      return false;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchCurrent();
  }, [fetchCurrent]);

  // ---------------------------------------------------------------------------
  // Failover status polling (lightweight — no modem contact)
  // ---------------------------------------------------------------------------
  // Started after a successful band lock when failover is enabled.
  // Polls failover_status.sh until the watcher process exits, then:
  //   - Updates failover state from the response
  //   - If activated → re-fetches current.sh to get the reset bands
  //   - Stops polling
  // ---------------------------------------------------------------------------
  const startFailoverPolling = useCallback(() => {
    // Clear any existing poll
    if (failoverPollRef.current) {
      clearInterval(failoverPollRef.current);
      failoverPollRef.current = null;
    }

    failoverPollRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        if (failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }
        return;
      }

      try {
        const resp = await authFetch(`${CGI_BASE}/failover_status.sh`);
        if (!resp.ok) return; // Silent fail — retry next interval

        const data: FailoverStatusResponse = await resp.json();
        if (!mountedRef.current) return;

        // Watcher still running — show "Checking", keep polling
        if (data.watcher_running) {
          setFailover({
            enabled: data.enabled,
            activated: data.activated,
            watcher_running: true,
          });
          return;
        }

        // Watcher finished — stop polling and update state
        if (failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }

        setFailover({
          enabled: data.enabled,
          activated: data.activated,
          watcher_running: false,
        });

        // If failover activated, bands were reset — re-fetch to get new values
        if (data.activated) {
          await fetchCurrent();
        }
      } catch {
        // Network error — silent, retry next interval
      }
    }, FAILOVER_POLL_INTERVAL);
  }, [fetchCurrent]);

  // ---------------------------------------------------------------------------
  // Lock bands for one category
  // ---------------------------------------------------------------------------
  const lockBands = useCallback(
    async (
      category: BandCategory,
      bands: number[],
    ): Promise<BandActionResult> => {
      // No zero-band lock: the card disables Save too, and lock.sh refuses it.
      if (bands.length === 0) {
        return { ok: false, error: t(`${K}.no_bands`) };
      }

      setLockingCategory(category);

      try {
        const resp = await authFetch(`${CGI_BASE}/lock.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            band_type: category,
            bands: bandArrayToString(bands),
          }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: BandLockResponse = await resp.json();

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              t,
              data.error,
              data.detail,
              t(`${K}.lock_failed`),
            ),
          };
        }

        if (!mountedRef.current) return { ok: true };

        // Re-fetch current state to confirm the lock took effect. A failed
        // re-read lands on `readError`, never on the write that succeeded.
        await fetchCurrent();

        // If failover is armed (enabled + watcher spawned), start polling
        // for watcher completion so we detect activation in real-time
        if (data.failover_armed) {
          // Clear any previous activated flag — the watcher just started fresh
          setFailover((prev) => ({
            ...prev,
            activated: false,
            watcher_running: true,
          }));
          startFailoverPolling();
        }

        return { ok: true };
      } catch {
        return { ok: false, error: t(`${K}.lock_failed`) };
      } finally {
        if (mountedRef.current) {
          setLockingCategory(null);
        }
      }
    },
    [fetchCurrent, startFailoverPolling, t],
  );

  // ---------------------------------------------------------------------------
  // Adopt a watcher this tab did not start
  // ---------------------------------------------------------------------------
  // The poll above is armed by `lock.sh` returning `failover_armed`; if the flag arrives another way (a poll begun
  // before a remount), keep polling until the watcher reports done so "Checking" cannot latch on.
  useEffect(() => {
    if (failover.watcher_running && !failoverPollRef.current) {
      startFailoverPolling();
    }
  }, [failover.watcher_running, startFailoverPolling]);

  // ---------------------------------------------------------------------------
  // Unlock all bands for one category (set to full supported list)
  // ---------------------------------------------------------------------------
  const unlockAll = useCallback(
    async (
      category: BandCategory,
      supportedBands: number[],
    ): Promise<BandActionResult> => {
      if (supportedBands.length === 0) {
        return { ok: false, error: t(`${K}.no_supported`) };
      }

      // Locking to ALL supported bands = unlock all
      return lockBands(category, supportedBands);
    },
    [lockBands, t],
  );

  // ---------------------------------------------------------------------------
  // Toggle failover
  // ---------------------------------------------------------------------------
  const toggleFailover = useCallback(
    async (enabled: boolean): Promise<BandActionResult> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/failover_toggle.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: FailoverToggleResponse = await resp.json();

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              t,
              data.error,
              data.detail,
              t(`${K}.failover_failed`),
            ),
          };
        }

        if (mountedRef.current) {
          setFailover((prev) => ({
            ...prev,
            enabled: data.enabled ?? enabled,
          }));
        }
        return { ok: true };
      } catch {
        return { ok: false, error: t(`${K}.failover_failed`) };
      }
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // Manual refresh — stale-while-revalidate, never a skeleton
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async (): Promise<boolean> => {
    setIsRefreshing(true);
    try {
      return await fetchCurrent();
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [fetchCurrent]);

  return {
    currentBands,
    failover,
    isLoading,
    isRefreshing,
    lockingCategory,
    readError,
    lockBands,
    unlockAll,
    toggleFailover,
    refresh,
  };
}

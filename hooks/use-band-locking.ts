"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
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
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/bands/current.sh           → locked bands + failover
//   GET  /cgi-bin/quecmanager/bands/failover_status.sh   → lightweight flag check
//   POST /cgi-bin/quecmanager/bands/lock.sh              → apply band lock
//   POST /cgi-bin/quecmanager/bands/failover_toggle.sh   → enable/disable failover
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/bands";
const FAILOVER_POLL_INTERVAL = 1000; // 1s — watcher sleeps 5s then checks

export interface UseBandLockingReturn {
  /** Currently locked/configured bands from ue_capability_band */
  currentBands: CurrentBands | null;
  /** Failover safety mechanism state */
  failover: FailoverState;
  /**
   * True during the INITIAL data fetch only — "there is nothing to show yet".
   * This is the flag that may drive skeletons. A manual refresh does NOT set
   * it; see `isRefreshing`.
   */
  isLoading: boolean;
  /**
   * True while a manual `refresh()` is in flight — "what is on screen is real
   * but may be stale". Keep the loaded layout rendered and show a quiet
   * in-place indicator. Never set by the failover poller.
   */
  isRefreshing: boolean;
  /** Which band category is currently being locked/unlocked (null = idle) */
  lockingCategory: BandCategory | null;
  /**
   * Error message from the last WRITE — lock, unlock, failover toggle.
   *
   * Deliberately no longer shared with the read. `lockBands` re-reads via
   * `fetchCurrent` AFTER a successful write, so a fused error meant a write that
   * actually landed, followed by a read that lost the AT mutex, raised the green
   * "Locked" toast AND a red inline notice blaming the write that worked.
   */
  error: string | null;
  /**
   * Error message from the last `current.sh` READ. Null while the last read
   * succeeded.
   *
   * A failed read leaves `currentBands` at its previous value (`null` on first
   * load), so this is the ONLY signal that the band figures on screen are not
   * the modem's. Surface it independently of any per-category write scoping —
   * a first-load failure belongs to no category.
   */
  readError: string | null;
  /**
   * Lock specific bands for one category.
   * Sends AT+QNWPREFCFG command for the specified band type.
   * Re-fetches current bands on success.
   * @returns success boolean
   */
  lockBands: (category: BandCategory, bands: number[]) => Promise<boolean>;
  /**
   * Unlock all bands for one category by setting to full supported list.
   * Requires the supported band list (from useModemStatus) to be passed in.
   * @returns success boolean
   */
  unlockAll: (
    category: BandCategory,
    supportedBands: number[],
  ) => Promise<boolean>;
  /**
   * Toggle the failover safety mechanism on/off.
   * @returns success boolean
   */
  toggleFailover: (enabled: boolean) => Promise<boolean>;
  /**
   * Manually re-read current bands + failover state.
   * @returns success boolean, so the caller can report a failed refresh — the
   * shared `error` is scoped per-category by the page and would swallow it.
   */
  refresh: () => Promise<boolean>;
}

export function useBandLocking(): UseBandLockingReturn {
  const [currentBands, setCurrentBands] = useState<CurrentBands | null>(null);
  const [failover, setFailover] = useState<FailoverState>({
    enabled: false,
    activated: false,
    watcher_running: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  /** Manual revalidation only. See `refresh` for why this is not `isLoading`. */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lockingCategory, setLockingCategory] = useState<BandCategory | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** Read failures only. See `readError` in the return contract. */
  const [readError, setReadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
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
  // Returns whether the read SUCCEEDED, so a caller that needs to report the
  // outcome (manual refresh) can. The boolean describes the FETCH, not the
  // component: an unmount mid-flight still returns the true result and simply
  // skips the state writes, because "the page went away" is not a failed read
  // and must not be reported to the user as one.
  const fetchCurrent = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(`${CGI_BASE}/current.sh?_t=${Date.now()}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: BandCurrentResponse = await resp.json();

      // `current` and `failover` are OMITTED from the error envelope, which is
      // why they are optional on `BandCurrentResponse` — the type used to
      // declare them present and got away with it only because of the early
      // return below. Guarding the payload rather than the `success` flag alone
      // means a malformed success can never write `undefined` into state.
      if (!data.success || !data.current || !data.failover) {
        if (mountedRef.current) {
          setReadError(
            data.detail || data.error || "Failed to fetch band configuration",
          );
        }
        return false;
      }

      if (!mountedRef.current) return true;

      setCurrentBands(data.current);
      setFailover(data.failover);
      // Only the READ error clears here. Clearing `error` too would erase a
      // failed lock's notice on the very re-read that follows the next write.
      setReadError(null);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setReadError(
          err instanceof Error
            ? err.message
            : "Failed to fetch band configuration",
        );
      }
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

        // Watcher still running — update state to show "Monitoring", keep polling
        if (data.watcher_running) {
          setFailover({ enabled: data.enabled, activated: data.activated, watcher_running: true });
          return;
        }

        // Watcher finished — stop polling and update state
        if (failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }

        setFailover({ enabled: data.enabled, activated: data.activated, watcher_running: false });

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
    async (category: BandCategory, bands: number[]): Promise<boolean> => {
      if (bands.length === 0) {
        setError("No bands selected");
        return false;
      }

      setError(null);
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
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: BandLockResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to apply band lock");
          return false;
        }

        // Re-fetch current state to confirm the lock took effect
        await fetchCurrent();

        // If failover is armed (enabled + watcher spawned), start polling
        // for watcher completion so we detect activation in real-time
        if (data.failover_armed) {
          // Clear any previous activated flag from UI — watcher just started fresh
          setFailover((prev) => ({ ...prev, activated: false }));
          startFailoverPolling();
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to apply band lock",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setLockingCategory(null);
        }
      }
    },
    [fetchCurrent, startFailoverPolling],
  );

  // ---------------------------------------------------------------------------
  // Adopt a watcher this session did not start
  // ---------------------------------------------------------------------------
  // The poll above is armed by `lock.sh` returning `failover_armed`, so it only
  // ever covers a watcher THIS tab started. But `current.sh` also reports
  // `watcher_running`, and it can legitimately be true on a plain page load —
  // another tab, another operator, or a reload during the ~30s window after a
  // lock.
  //
  // Without this effect that state would never clear: nothing would be polling,
  // so `watcher_running` would stay true until the component remounted. That is
  // load-bearing now that the UI DISABLES controls on this flag — a guard that
  // can latch on forever is worse than no guard, because the surface looks
  // permanently broken rather than briefly busy.
  //
  // It cannot loop: `startFailoverPolling` stops itself the moment the watcher
  // is gone and writes `watcher_running: false`, which makes this condition
  // false. The guard on the ref keeps it from restarting a poll already running.
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
    ): Promise<boolean> => {
      if (supportedBands.length === 0) {
        setError("Supported bands not available");
        return false;
      }

      // Locking to ALL supported bands = unlock all
      return lockBands(category, supportedBands);
    },
    [lockBands],
  );

  // ---------------------------------------------------------------------------
  // Toggle failover
  // ---------------------------------------------------------------------------
  const toggleFailover = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setError(null);

      try {
        const resp = await authFetch(`${CGI_BASE}/failover_toggle.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: FailoverToggleResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to toggle failover");
          return false;
        }

        // Optimistic update
        setFailover((prev) => ({ ...prev, enabled: data.enabled ?? enabled }));
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to toggle failover",
        );
        return false;
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Manual refresh — stale-while-revalidate, NOT a reload
  // ---------------------------------------------------------------------------
  // `isLoading` and `isRefreshing` are two different claims and must not be
  // fused:
  //
  //   isLoading     THERE IS NO DATA TO SHOW YET. First load only. This is the
  //                 flag that legitimately drives skeletons.
  //   isRefreshing  The data on screen is REAL but possibly stale, and we are
  //                 re-reading it. The loaded layout stays rendered.
  //
  // This used to call `setIsLoading(true)`, which made every manual refresh
  // collapse the whole page — hero and all three category cards — back to
  // skeletons, because the coordinator ORs `isLoading` into its page-level
  // loading flag. A refresh that blanks the surface it is refreshing teaches
  // the user not to press it, which defeats the staleness problem it exists to
  // solve. Nothing else depended on that side effect: `refresh` has exactly one
  // consumer, and `fetchCurrent`'s own `finally` already clears `isLoading` for
  // the first load.
  //
  // `isRefreshing` responds to THIS function only. The 1s `failover_status.sh`
  // poller calls `fetchCurrent` directly and can neither set nor clear it, so a
  // watcher cycle can never make the header spin.
  const refresh = useCallback(async (): Promise<boolean> => {
    setIsRefreshing(true);
    try {
      return await fetchCurrent();
    } finally {
      // `fetchCurrent` swallows its own errors, but the flag is cleared in a
      // `finally` regardless: a future throw must not strand the button
      // spinning forever.
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [fetchCurrent]);

  return {
    currentBands,
    failover,
    isLoading,
    isRefreshing,
    lockingCategory,
    error,
    readError,
    lockBands,
    unlockAll,
    toggleFailover,
    refresh,
  };
}

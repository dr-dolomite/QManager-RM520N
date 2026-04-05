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
  /** True during initial data fetch */
  isLoading: boolean;
  /** Which band category is currently being locked/unlocked (null = idle) */
  lockingCategory: BandCategory | null;
  /** Error message from the last operation */
  error: string | null;
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
  /** Manually refresh current bands + failover state */
  refresh: () => void;
}

export function useBandLocking(): UseBandLockingReturn {
  const [currentBands, setCurrentBands] = useState<CurrentBands | null>(null);
  const [failover, setFailover] = useState<FailoverState>({
    enabled: false,
    activated: false,
    watcher_running: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [lockingCategory, setLockingCategory] = useState<BandCategory | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

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
  const fetchCurrent = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/current.sh?_t=${Date.now()}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: BandCurrentResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(
          data.detail || data.error || "Failed to fetch band configuration",
        );
        return;
      }

      setCurrentBands(data.current);
      setFailover(data.failover);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch band configuration",
      );
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
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchCurrent();
  }, [fetchCurrent]);

  return {
    currentBands,
    failover,
    isLoading,
    lockingCategory,
    error,
    lockBands,
    unlockAll,
    toggleFailover,
    refresh,
  };
}

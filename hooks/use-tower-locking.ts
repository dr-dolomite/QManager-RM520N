"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  TowerLockConfig,
  TowerModemState,
  TowerFailoverState,
  TowerScheduleConfig,
  TowerStatusResponse,
  TowerLockResponse,
  TowerSettingsResponse,
  TowerScheduleResponse,
  TowerScheduleSaveResult,
  TowerFailoverStatusResponse,
  LteLockCell,
  NrSaLockCell,
} from "@/types/tower-locking";

export type { TowerScheduleSaveResult } from "@/types/tower-locking";

// =============================================================================
// useTowerLocking — Tower Lock State, Lock/Unlock, Settings & Schedule Hook
// =============================================================================
// Manages the tower locking lifecycle: fetching current lock state from the
// modem, applying/clearing LTE and NR-SA tower locks, updating persist and
// failover settings, and managing the schedule.
//
// After a successful lock (when failover is enabled), the hook polls the
// lightweight failover_status.sh endpoint every 3s until the watcher
// process completes. This detects whether failover activated and updates
// the UI accordingly — without touching the modem.
//
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/tower/status.sh           → full state
//   GET  /cgi-bin/quecmanager/tower/failover_status.sh  → lightweight flag check
//   POST /cgi-bin/quecmanager/tower/lock.sh             → apply/clear lock
//   POST /cgi-bin/quecmanager/tower/settings.sh         → persist + failover config
//   POST /cgi-bin/quecmanager/tower/schedule.sh         → schedule config + cron
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/tower";
const FAILOVER_POLL_INTERVAL = 3000; // 3s — watcher sleeps 20s then checks

export interface UseTowerLockingReturn {
  /** Tower lock configuration from config file */
  config: TowerLockConfig | null;
  /** Live modem lock state (from AT+QNWLOCK queries) */
  modemState: TowerModemState | null;
  /** Failover watcher state (from flag files) */
  failoverState: TowerFailoverState | null;
  /** True during initial data fetch */
  isLoading: boolean;
  /** True while an LTE lock/unlock operation is in progress */
  isLteLocking: boolean;
  /** True while an NR-SA lock/unlock operation is in progress */
  isNrLocking: boolean;
  /** True while a failover enable/disable save is in progress */
  isSavingFailover: boolean;
  /** Error message from the last operation */
  error: string | null;

  /**
   * Lock LTE to specific cells (1-3 EARFCN+PCI pairs).
   * @returns success boolean
   */
  lockLte: (cells: LteLockCell[]) => Promise<boolean>;
  /** Clear LTE tower lock. */
  unlockLte: () => Promise<boolean>;
  /**
   * Lock NR-SA to a specific cell (PCI + ARFCN + SCS + Band).
   * @returns success boolean
   */
  lockNrSa: (cell: NrSaLockCell) => Promise<boolean>;
  /** Clear NR-SA tower lock. */
  unlockNrSa: () => Promise<boolean>;

  /**
   * Update persist and failover settings.
   * Persist changes are sent to the modem immediately via AT command.
   */
  updateSettings: (
    persist: boolean,
    failover: { enabled: boolean; threshold: number }
  ) => Promise<boolean>;

  /**
   * Update schedule configuration and manage the systemd timer. Resolves to
   * `{ success, armed?, reason? }` — `armed:false` means the schedule persisted
   * but no live timer was installed on this device.
   */
  updateSchedule: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;

  /** True while the failover watcher is running (anti-spam guard) */
  isWatcherRunning: boolean;

  /** Manually refresh all tower lock state. */
  refresh: () => void;
}

export function useTowerLocking(): UseTowerLockingReturn {
  const [config, setConfig] = useState<TowerLockConfig | null>(null);
  const [modemState, setModemState] = useState<TowerModemState | null>(null);
  const [failoverState, setFailoverState] =
    useState<TowerFailoverState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLteLocking, setIsLteLocking] = useState(false);
  const [isNrLocking, setIsNrLocking] = useState(false);
  const [isSavingFailover, setIsSavingFailover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const failoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (failoverPollRef.current) {
        clearInterval(failoverPollRef.current);
        failoverPollRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch full tower lock status (modem queries + config + failover flags)
  // ---------------------------------------------------------------------------
  const MAX_RETRIES = 3;

  const fetchStatus = useCallback(async (isRetry = false) => {
    try {
      const resp = await authFetch(`${CGI_BASE}/status.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: TowerStatusResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch tower lock status");
        return;
      }

      // Fix: use explicit null/undefined checks instead of truthy checks.
      // Objects like {enabled: false} are truthy but would pass, while
      // the truthy check is really guarding against null/undefined.
      if (data.modem_state !== null && data.modem_state !== undefined) {
        setModemState(data.modem_state);
      }
      if (data.config !== null && data.config !== undefined) {
        setConfig(data.config);
      }
      if (data.failover_state !== null && data.failover_state !== undefined) {
        setFailoverState(data.failover_state);
      }
      setError(null);
      retryCountRef.current = 0; // Reset retry counter on success
    } catch (err) {
      if (!mountedRef.current) return;
      const msg =
        err instanceof Error ? err.message : "Failed to fetch tower lock status";
      setError(msg);

      // Auto-retry with exponential backoff (2s, 4s, 8s)
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.pow(2, retryCountRef.current + 1) * 1000;
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            fetchStatus(true);
          }
        }, delay);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Failover status polling (lightweight — no modem contact)
  // ---------------------------------------------------------------------------
  const startFailoverPolling = useCallback(() => {
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
        if (!resp.ok) return;

        const data: TowerFailoverStatusResponse = await resp.json();
        if (!mountedRef.current) return;

        // Watcher still running — keep polling
        if (data.watcher_running) return;

        // Watcher finished — stop polling and update state
        if (failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }

        setFailoverState({
          enabled: data.enabled,
          activated: data.activated,
          watcher_running: false,
        });

        // If failover activated, locks were cleared — re-fetch to get new state
        if (data.activated) {
          await fetchStatus();
        }
      } catch {
        // Network error — silent, retry next interval
      }
    }, FAILOVER_POLL_INTERVAL);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Generic lock/unlock helper
  // ---------------------------------------------------------------------------
  const isWatcherRunning = failoverState?.watcher_running ?? false;

  const sendLockRequest = useCallback(
    async (
      body: Record<string, unknown>,
      setLocking: (v: boolean) => void
    ): Promise<boolean> => {
      // Anti-spam: block new LOCK operations while failover watcher is running.
      // Unlock operations are allowed through — the backend will stop the
      // watcher before sending the AT unlock command.
      if (body.action === "lock" && failoverState?.watcher_running) {
        setError("Please wait — failover check is still in progress");
        return false;
      }

      setError(null);
      setLocking(true);

      try {
        const resp = await authFetch(`${CGI_BASE}/lock.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: TowerLockResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Tower lock operation failed");
          return false;
        }

        // Wait for modem to reconnect after lock/unlock command (3-5s typical).
        // isLocking stays true so the spinner remains visible to the user.
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Re-fetch full state — modem should have reconnected by now
        await fetchStatus();

        // On unlock, stop any active failover polling — the backend killed the
        // watcher before sending the AT command, so there's nothing to poll.
        if (body.action === "unlock" && failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }

        // If failover is armed (user enabled it before locking and the
        // watcher was spawned), sync frontend state + start polling.
        if (data.failover_armed) {
          setConfig((prev) =>
            prev
              ? { ...prev, failover: { ...prev.failover, enabled: true } }
              : prev
          );
          setFailoverState((prev) =>
            prev
              ? { ...prev, enabled: true, activated: false, watcher_running: true }
              : { enabled: true, activated: false, watcher_running: true }
          );
          startFailoverPolling();
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error
            ? err.message
            : "Tower lock operation failed"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setLocking(false);
        }
      }
    },
    [fetchStatus, startFailoverPolling, failoverState?.watcher_running]
  );

  // ---------------------------------------------------------------------------
  // LTE Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockLte = useCallback(
    async (cells: LteLockCell[]): Promise<boolean> => {
      if (cells.length === 0) {
        setError("At least one EARFCN + PCI pair is required");
        return false;
      }
      return sendLockRequest(
        { type: "lte", action: "lock", cells },
        setIsLteLocking
      );
    },
    [sendLockRequest]
  );

  const unlockLte = useCallback(async (): Promise<boolean> => {
    return sendLockRequest(
      { type: "lte", action: "unlock" },
      setIsLteLocking
    );
  }, [sendLockRequest]);

  // ---------------------------------------------------------------------------
  // NR-SA Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockNrSa = useCallback(
    async (cell: NrSaLockCell): Promise<boolean> => {
      return sendLockRequest(
        {
          type: "nr_sa",
          action: "lock",
          pci: cell.pci,
          arfcn: cell.arfcn,
          scs: cell.scs,
          band: cell.band,
        },
        setIsNrLocking
      );
    },
    [sendLockRequest]
  );

  const unlockNrSa = useCallback(async (): Promise<boolean> => {
    return sendLockRequest(
      { type: "nr_sa", action: "unlock" },
      setIsNrLocking
    );
  }, [sendLockRequest]);

  // ---------------------------------------------------------------------------
  // Update Settings (persist + failover)
  // ---------------------------------------------------------------------------
  const updateSettings = useCallback(
    async (
      persist: boolean,
      failover: { enabled: boolean; threshold: number }
    ): Promise<boolean> => {
      setError(null);

      const isTogglingFailover = failover.enabled !== config?.failover?.enabled;
      const isDisablingFailover =
        isTogglingFailover && failover.enabled === false;

      if (isTogglingFailover) {
        setIsSavingFailover(true);
      }

      try {
        const resp = await authFetch(`${CGI_BASE}/settings.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persist,
            failover_enabled: failover.enabled,
            failover_threshold: failover.threshold,
          }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: TowerSettingsResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to update settings");
          return false;
        }

        // Optimistic update of config
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                persist,
                failover: {
                  enabled: failover.enabled,
                  threshold: failover.threshold,
                },
              }
            : prev
        );

        // Update failoverState to match (prevents badge desync).
        // When disabling failover, the backend kills the watcher daemon,
        // so clear watcher_running. When the backend spawned the watcher
        // (enabled failover with active lock), set watcher_running.
        if (data.watcher_spawned) {
          setFailoverState((prev) =>
            prev
              ? { ...prev, enabled: true, activated: false, watcher_running: true }
              : { enabled: true, activated: false, watcher_running: true }
          );
          startFailoverPolling();
        } else {
          setFailoverState((prev) =>
            prev
              ? {
                  ...prev,
                  enabled: failover.enabled,
                  ...(failover.enabled ? {} : { watcher_running: false }),
                }
              : { enabled: failover.enabled, activated: false, watcher_running: false }
          );
        }

        // On disable: clear any stale poll and re-sync with backend
        if (isDisablingFailover) {
          if (failoverPollRef.current) {
            clearInterval(failoverPollRef.current);
            failoverPollRef.current = null;
          }
          await fetchStatus();
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to update settings"
        );
        return false;
      } finally {
        if (mountedRef.current && isTogglingFailover) {
          setIsSavingFailover(false);
        }
      }
    },
    [startFailoverPolling, fetchStatus, config?.failover?.enabled]
  );

  // ---------------------------------------------------------------------------
  // Update Schedule
  // ---------------------------------------------------------------------------
  const updateSchedule = useCallback(
    async (
      schedule: TowerScheduleConfig,
    ): Promise<TowerScheduleSaveResult> => {
      setError(null);

      try {
        const resp = await authFetch(`${CGI_BASE}/schedule.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(schedule),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: TowerScheduleResponse = await resp.json();
        if (!mountedRef.current) return { success: false };

        if (!data.success) {
          setError(data.detail || data.error || "Failed to update schedule");
          return { success: false };
        }

        // Optimistic update of config
        setConfig((prev) =>
          prev ? { ...prev, schedule } : prev
        );

        // Thread the on-device arm status through so the card can warn when the
        // schedule saved but couldn't be armed (e.g. timer unit not shipped).
        return { success: true, armed: data.armed, reason: data.reason };
      } catch (err) {
        if (!mountedRef.current) return { success: false };
        setError(
          err instanceof Error ? err.message : "Failed to update schedule"
        );
        return { success: false };
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchStatus();
  }, [fetchStatus]);

  return {
    config,
    modemState,
    failoverState,
    isLoading,
    isLteLocking,
    isNrLocking,
    isSavingFailover,
    isWatcherRunning,
    error,
    lockLte,
    unlockLte,
    lockNrSa,
    unlockNrSa,
    updateSettings,
    updateSchedule,
    refresh,
  };
}

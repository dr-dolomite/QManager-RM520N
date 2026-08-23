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

/**
 * A non-fatal partial success reported by the backend: the operation landed on
 * the modem, but something alongside it did not.
 *
 * Both codes were already being emitted and silently discarded —
 * `service_enable_failed` was not even declared in the response type, and
 * `persist_command_failed` was declared with zero consumers. The visible symptom
 * was a switch that stayed ON after its AT write had failed.
 *
 * The hook reports the CODE, not a sentence: rendered copy lives in the
 * components, where `useTranslation` is, so a warning cannot ship as an English
 * literal from inside a hook that has no namespace.
 */
export type TowerWarningCode =
  | "service_enable_failed"
  | "service_disable_failed"
  | "persist_command_failed";

export interface UseTowerLockingReturn {
  /** Tower lock configuration from config file */
  config: TowerLockConfig | null;
  /** Live modem lock state (from AT+QNWLOCK queries) */
  modemState: TowerModemState | null;
  /** Failover watcher state (from flag files) */
  failoverState: TowerFailoverState | null;
  /** True during initial data fetch */
  isLoading: boolean;
  /** True during a manual `refresh()`. Distinct from `isLoading` — see `refresh`. */
  isRefreshing: boolean;
  /** True while an LTE lock/unlock operation is in progress */
  isLteLocking: boolean;
  /** True while an NR-SA lock/unlock operation is in progress */
  isNrLocking: boolean;
  /** True while a failover enable/disable save is in progress */
  isSavingFailover: boolean;
  /** Error message from the last operation */
  error: string | null;
  /**
   * Partial success from the last write, or null. See `TowerWarningCode`.
   * Cleared at the start of every subsequent write.
   */
  lastWarning: TowerWarningCode | null;
  /** Dismiss the current warning. */
  clearWarning: () => void;
  /**
   * `Date.now()` of the last successful full status read, or null before the
   * first one lands.
   *
   * This exists because `status.sh` is fetched ONCE on mount and never polled —
   * it costs three AT commands on the shared `/tmp/qmanager_at.lock` mutex the
   * poller already contends for, so putting it on an interval is a backend cost
   * decision, not a frontend one. The lock state on screen can therefore be
   * arbitrarily old, and three things change it out of band: the schedule
   * timers, the failover watcher, and a second browser tab. The surface prints
   * this timestamp rather than implying the number beside it is live.
   */
  lastSyncedAt: number | null;

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

  /** Quietly re-read all tower lock state. Raises `isRefreshing`, not `isLoading`. */
  refresh: () => Promise<void>;
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
  const [lastWarning, setLastWarning] = useState<TowerWarningCode | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const clearWarning = useCallback(() => setLastWarning(null), []);

  const mountedRef = useRef(true);
  const failoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * True while ANY lock/unlock request is in flight. A ref rather than state
   * because `sendLockRequest` reads it at call time and must not re-create
   * itself (and therefore every `useCallback` downstream) on each flip.
   */
  const lockInFlightRef = useRef(false);

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
      setLastSyncedAt(Date.now());
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
      // -----------------------------------------------------------------------
      // Anti-spam: block a second write while one is already in flight.
      //
      // THIS USED TO BLOCK ON `failoverState?.watcher_running`, AND THAT WAS A
      // LIVE BUG, not a conservative guard. It was copied from band locking,
      // where the watcher is bounded — `qmanager_band_failover` runs
      // MAX_CHECKS=5 at CHECK_INTERVAL=5 and exits after ~30s, so "wait for the
      // watcher" is a real, short wait.
      //
      // The TOWER watcher is `while true` (`qmanager_tower_failover`:
      // SETTLE=20, INTERVAL=20) and exits only once NO lock is active, which it
      // re-checks every sixth cycle (~120s). So with failover on and either leg
      // locked, `watcher_running` is permanently true — and this guard made
      // BOTH lock switches permanently dead behind a toast reading "Signal
      // quality check is running, please wait." It never stopped running.
      //
      // In-flight is the fact the guard actually wanted. Unlock still passes
      // freely: it is the recovery action, and the backend stops the watcher
      // before sending the AT command.
      if (body.action === "lock" && lockInFlightRef.current) {
        setError("Another tower lock operation is still in progress");
        return false;
      }

      setError(null);
      setLastWarning(null);
      lockInFlightRef.current = true;
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

        // The lock landed, but the persistence unit may not have. Reported as a
        // warning rather than an error: the write succeeded and the radio IS
        // locked — it just will not come back after a reboot.
        if (data.service_enable_failed) {
          setLastWarning("service_enable_failed");
        } else if (data.service_disable_failed) {
          // THE MIRROR CASE, ON THE UNLOCK BRANCHES. `lock.sh` used to answer
          // `success:false` here for an unlock whose AT write had landed; it now
          // answers honestly with `success:true` + this flag. Unread, that swap
          // would have turned a misleading error message into NO message: the
          // user is told the unlock worked while the persistence/failover unit
          // stays enabled and re-arms the lock at the next boot.
          setLastWarning("service_disable_failed");
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
        lockInFlightRef.current = false;
        if (mountedRef.current) {
          setLocking(false);
        }
      }
    },
    [fetchStatus, startFailoverPolling]
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
      setLastWarning(null);

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

        // Config was written but the modem rejected the `save_ctrl` AT write —
        // "Keep lock after reboot" did NOT take. Previously this flag came back
        // true and the switch simply stayed on, claiming a setting the modem
        // never accepted.
        if (data.persist_command_failed) {
          setLastWarning("persist_command_failed");
        } else if (data.service_enable_failed) {
          setLastWarning("service_enable_failed");
        } else if (data.service_disable_failed) {
          // Was folded into `service_enable_failed` while that was the only
          // declared code, which put "the lock will not survive a reboot" on a
          // failure to DISABLE — the opposite claim.
          setLastWarning("service_disable_failed");
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
  /**
   * A QUIET re-read: it does NOT raise `isLoading`.
   *
   * `isLoading` is the page's first-paint gate, so raising it here would drop
   * the whole surface back to skeletons — a jarring full-page flash in response
   * to a single "re-read the lock state" press, and it would throw away the
   * numbers already on screen to show placeholders in their place. `isRefreshing`
   * lets the rail spin its own glyph and leave the rest of the page standing.
   *
   * Nothing called `refresh` before this change, so there is no consumer relying
   * on the old skeleton behaviour.
   */
  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchStatus();
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [fetchStatus]);

  return {
    config,
    modemState,
    failoverState,
    isLoading,
    isRefreshing,
    isLteLocking,
    isNrLocking,
    isSavingFailover,
    isWatcherRunning,
    error,
    lastWarning,
    clearWarning,
    lastSyncedAt,
    lockLte,
    unlockLte,
    lockNrSa,
    unlockNrSa,
    updateSettings,
    updateSchedule,
    refresh,
  };
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  TowerLockConfig,
  TowerModemState,
  TowerFailoverState,
  TowerScheduleConfig,
  TowerStatusResponse,
  TowerLockResponse,
  TowerSettingsChange,
  TowerSettingsResponse,
  TowerScheduleResponse,
  TowerFailoverStatusResponse,
  TowerActionResult,
  TowerScheduleSaveResult,
  TowerWarningCode,
  LteLockCell,
  NrSaLockCell,
} from "@/types/tower-locking";

export type {
  TowerActionResult,
  TowerScheduleSaveResult,
  TowerWarningCode,
} from "@/types/tower-locking";

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
// Read and write failures are separate: `readError` is the `status.sh` read; each mutator RETURNS its own result,
// already resolved through `resolveErrorMessage`, so the page toasts it without reading hook state after an `await`.
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/tower/status.sh           → full state
//   GET  /cgi-bin/quecmanager/tower/failover_status.sh  → lightweight flag check
//   POST /cgi-bin/quecmanager/tower/lock.sh             → apply/clear lock
//   POST /cgi-bin/quecmanager/tower/settings.sh         → persist + failover config
//   POST /cgi-bin/quecmanager/tower/schedule.sh         → schedule config + systemd timers
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/tower";
const FAILOVER_POLL_INTERVAL = 3000; // 3s — watcher sleeps 20s then checks
const K = "tower_locking.errors";

const DEFAULT_FAILOVER_THRESHOLD = 20;
const DEFAULT_SCHEDULE: TowerScheduleConfig = {
  enabled: false,
  start_time: "08:00",
  end_time: "22:00",
  days: [1, 2, 3, 4, 5],
};

function normalizeTowerConfig(
  rawConfig: TowerStatusResponse["config"] | null | undefined,
  failoverEnabledFallback = false
): TowerLockConfig | null {
  if (!rawConfig) return null;

  const lteCells = Array.isArray(rawConfig.lte?.cells)
    ? rawConfig.lte.cells.slice(0, 3)
    : [];
  while (lteCells.length < 3) {
    lteCells.push(null);
  }

  const scheduleDays = Array.isArray(rawConfig.schedule?.days)
    ? rawConfig.schedule.days.filter(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6
      )
    : DEFAULT_SCHEDULE.days;

  return {
    lte: {
      enabled: rawConfig.lte?.enabled === true,
      cells: lteCells,
    },
    nr_sa: {
      enabled: rawConfig.nr_sa?.enabled === true,
      pci: rawConfig.nr_sa?.pci ?? null,
      arfcn: rawConfig.nr_sa?.arfcn ?? null,
      scs: rawConfig.nr_sa?.scs ?? null,
      band: rawConfig.nr_sa?.band ?? null,
    },
    persist: rawConfig.persist === true,
    failover: {
      enabled:
        rawConfig.failover?.enabled ?? failoverEnabledFallback,
      threshold:
        rawConfig.failover?.threshold ?? DEFAULT_FAILOVER_THRESHOLD,
    },
    schedule: {
      enabled: rawConfig.schedule?.enabled === true,
      start_time:
        rawConfig.schedule?.start_time || DEFAULT_SCHEDULE.start_time,
      end_time: rawConfig.schedule?.end_time || DEFAULT_SCHEDULE.end_time,
      days: scheduleDays.length > 0 ? scheduleDays : DEFAULT_SCHEDULE.days,
    },
  };
}

export interface UseTowerLockingReturn {
  /** Tower lock configuration from config file */
  config: TowerLockConfig | null;
  /** Live modem lock state (from AT+QNWLOCK queries) */
  modemState: TowerModemState | null;
  /** Failover watcher state (from flag files) */
  failoverState: TowerFailoverState | null;
  /** True during the INITIAL fetch only. A manual refresh sets `isRefreshing`. */
  isLoading: boolean;
  /** True while a manual `refresh()` is in flight; the loaded layout stays up. */
  isRefreshing: boolean;
  /** True while an LTE lock/unlock operation is in progress */
  isLteLocking: boolean;
  /** True while an NR-SA lock/unlock operation is in progress */
  isNrLocking: boolean;
  /** True while a persist / failover settings save is in flight */
  isSavingSettings: boolean;
  /**
   * Why the last `status.sh` read failed, or null; a failed read keeps the previous state, so this is the only signal
   * the figures are stale.
   */
  readError: string | null;

  /** Lock LTE to specific cells (1-3 EARFCN+PCI pairs). */
  lockLte: (cells: LteLockCell[]) => Promise<TowerActionResult>;
  /** Clear LTE tower lock. */
  unlockLte: () => Promise<TowerActionResult>;
  /** Lock NR-SA to a specific cell (PCI + ARFCN + SCS + Band). */
  lockNrSa: (cell: NrSaLockCell) => Promise<TowerActionResult>;
  /** Clear NR-SA tower lock. */
  unlockNrSa: () => Promise<TowerActionResult>;

  /**
   * Update persist (per radio) and failover settings. Failover is sent whole
   * (unchanged parts at their saved value); persistence only when asked.
   */
  updateSettings: (change: TowerSettingsChange) => Promise<TowerActionResult>;

  /** Update the schedule and arm its systemd timers; `armed` reports the arm. */
  updateSchedule: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;

  /** True while the failover watcher is running */
  isWatcherRunning: boolean;

  /** Quietly re-read all tower lock state. Resolves true on success. */
  refresh: () => Promise<boolean>;
}

export function useTowerLocking(): UseTowerLockingReturn {
  const { t } = useTranslation("cellular");
  const [config, setConfig] = useState<TowerLockConfig | null>(null);
  const [modemState, setModemState] = useState<TowerModemState | null>(null);
  const [failoverState, setFailoverState] =
    useState<TowerFailoverState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLteLocking, setIsLteLocking] = useState(false);
  const [isNrLocking, setIsNrLocking] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const failoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * True while ANY lock/unlock is in flight (a ref, read at call time). Replaces a `watcher_running` guard that made
   * re-targeting impossible, since the tower watcher only exits once no lock is active.
   */
  const lockInFlightRef = useRef(false);
  // A language switch changes `t`; through a ref it never re-runs the first read.
  const tRef = useRef(t);
  // The saved half of a settings body (see `updateSettings`).
  const configRef = useRef<TowerLockConfig | null>(null);
  useEffect(() => {
    tRef.current = t;
    configRef.current = config;
  });

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
  // Resolves whether the READ succeeded. Only the first-load path auto-retries.
  const MAX_RETRIES = 3;

  const fetchStatus = useCallback(
    async (autoRetry = false): Promise<boolean> => {
      const t = tRef.current;
      try {
        const resp = await authFetch(`${CGI_BASE}/status.sh?_t=${Date.now()}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: TowerStatusResponse = await resp.json();
        if (!mountedRef.current) return data.success === true;

        if (!data.success) {
          setReadError(
            resolveErrorMessage(t, data.error, data.detail, t(`${K}.read_failed`))
          );
          return false;
        }

        if (data.modem_state !== null && data.modem_state !== undefined) {
          setModemState(data.modem_state);
        }
        if (data.config !== null && data.config !== undefined) {
          setConfig(
            normalizeTowerConfig(
              data.config,
              data.failover_state?.enabled === true
            )
          );
        }
        if (data.failover_state !== null && data.failover_state !== undefined) {
          setFailoverState(data.failover_state);
        }
        setReadError(null);
        retryCountRef.current = 0;
        return true;
      } catch {
        if (!mountedRef.current) return false;
        setReadError(t(`${K}.read_failed`));

        // First load only: retry with exponential backoff (2s, 4s, 8s)
        if (autoRetry && retryCountRef.current < MAX_RETRIES) {
          const delay = Math.pow(2, retryCountRef.current + 1) * 1000;
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              void fetchStatus(true);
            }
          }, delay);
        }
        return false;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  // Initial fetch
  useEffect(() => {
    void fetchStatus(true);
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
    ): Promise<TowerActionResult> => {
      const fallback =
        body.action === "unlock" ? t(`${K}.unlock_failed`) : t(`${K}.lock_failed`);

      // Block a second write while one is in flight. Unlock always passes: it
      // is the recovery action, and the backend stops the watcher first.
      if (body.action === "lock" && lockInFlightRef.current) {
        return { ok: false, error: t(`${K}.in_flight`) };
      }

      lockInFlightRef.current = true;
      setLocking(true);

      try {
        const resp = await authFetch(`${CGI_BASE}/lock.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: TowerLockResponse = await resp.json();
        if (!mountedRef.current) return { ok: data.success === true };

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, fallback),
          };
        }

        // Wait for modem to reconnect after lock/unlock command (3-5s typical).
        // isLocking stays true so the spinner remains visible to the user.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!mountedRef.current) return { ok: true };

        // Re-fetch full state. A failed re-read lands on `readError`, never on
        // the write that succeeded.
        await fetchStatus();

        // On unlock, stop any active failover polling — the backend killed the
        // watcher before sending the AT command, so there's nothing to poll.
        if (body.action === "unlock" && failoverPollRef.current) {
          clearInterval(failoverPollRef.current);
          failoverPollRef.current = null;
        }

        // If failover is armed the backend spawned the watcher: update runtime state only (watcher_running /
        // activated); never force enabled=true, which is the user's explicit toggle in config.failover.
        if (data.failover_armed) {
          setFailoverState((prev) =>
            prev
              ? { ...prev, activated: false, watcher_running: true }
              : { enabled: true, activated: false, watcher_running: true }
          );
          startFailoverPolling();
        }

        // The AT write landed but the boot unit did not follow it.
        const warning: TowerWarningCode | undefined = data.service_enable_failed
          ? "service_enable_failed"
          : data.service_disable_failed
            ? "service_disable_failed"
            : undefined;
        return warning ? { ok: true, warning } : { ok: true };
      } catch {
        return { ok: false, error: fallback };
      } finally {
        lockInFlightRef.current = false;
        if (mountedRef.current) {
          setLocking(false);
        }
      }
    },
    [fetchStatus, startFailoverPolling, t]
  );

  // ---------------------------------------------------------------------------
  // LTE Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockLte = useCallback(
    async (cells: LteLockCell[]): Promise<TowerActionResult> => {
      if (cells.length === 0) {
        return { ok: false, error: t(`${K}.no_cells`) };
      }
      return sendLockRequest(
        { type: "lte", action: "lock", cells },
        setIsLteLocking
      );
    },
    [sendLockRequest, t]
  );

  const unlockLte = useCallback(
    async (): Promise<TowerActionResult> =>
      sendLockRequest({ type: "lte", action: "unlock" }, setIsLteLocking),
    [sendLockRequest]
  );

  // ---------------------------------------------------------------------------
  // NR-SA Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockNrSa = useCallback(
    async (cell: NrSaLockCell): Promise<TowerActionResult> =>
      sendLockRequest(
        {
          type: "nr_sa",
          action: "lock",
          pci: cell.pci,
          arfcn: cell.arfcn,
          scs: cell.scs,
          band: cell.band,
        },
        setIsNrLocking
      ),
    [sendLockRequest]
  );

  const unlockNrSa = useCallback(
    async (): Promise<TowerActionResult> =>
      sendLockRequest({ type: "nr_sa", action: "unlock" }, setIsNrLocking),
    [sendLockRequest]
  );

  // ---------------------------------------------------------------------------
  // Update Settings (persist + failover)
  // ---------------------------------------------------------------------------
  // Settings writes run one at a time, so each one merges with the result of the last.
  const settingsQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const sendSettings = useCallback(
    async (change: TowerSettingsChange): Promise<TowerActionResult> => {
      const fallback = t(`${K}.settings_failed`);
      const saved = configRef.current;
      if (!saved) return { ok: false, error: fallback };
      const { persist, persist_lte, persist_nr } = change;
      const failover = { ...saved.failover, ...change.failover };
      const asksPersist =
        persist !== undefined || persist_lte !== undefined || persist_nr !== undefined;
      setIsSavingSettings(true);

      try {
        const resp = await authFetch(`${CGI_BASE}/settings.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(persist !== undefined ? { persist } : null),
            ...(persist_lte !== undefined ? { persist_lte } : null),
            ...(persist_nr !== undefined ? { persist_nr } : null),
            failover_enabled: failover.enabled,
            failover_threshold: failover.threshold,
          }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: TowerSettingsResponse = await resp.json();
        if (!mountedRef.current) return { ok: data.success === true };

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, fallback),
          };
        }

        // A rejected `save_ctrl` leaves the modem as it was: report it, don't claim it.
        const persistTook = !data.persist_command_failed;
        const lteNow = data.persist_lte;
        const nrNow = data.persist_nr;
        if (asksPersist && persistTook) {
          setModemState((prev) =>
            prev
              ? {
                  ...prev,
                  persist_lte: typeof lteNow === "boolean" ? lteNow : prev.persist_lte,
                  persist_nr: typeof nrNow === "boolean" ? nrNow : prev.persist_nr,
                  persist_read_ok: true,
                }
              : prev
          );
        }
        const nextPersist =
          asksPersist && typeof data.persist === "boolean" ? data.persist : saved.persist;
        if (configRef.current) {
          configRef.current = { ...configRef.current, persist: nextPersist, failover };
        }
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                persist: nextPersist,
                failover: {
                  enabled: failover.enabled,
                  threshold: failover.threshold,
                },
              }
            : prev
        );

        // Keep failoverState in step. Disabling failover kills the watcher;
        // enabling it with an active lock spawns one.
        if (data.watcher_spawned) {
          setFailoverState((prev) =>
            prev
              ? { ...prev, enabled: true, activated: false, watcher_running: true }
              : { enabled: true, activated: false, watcher_running: true }
          );
          startFailoverPolling();
        } else {
          if (!failover.enabled && failoverPollRef.current) {
            clearInterval(failoverPollRef.current);
            failoverPollRef.current = null;
          }
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

        const warning: TowerWarningCode | undefined = !persistTook
          ? "persist_command_failed"
          : data.service_enable_failed
            ? "service_enable_failed"
            : data.service_disable_failed
              ? "service_disable_failed"
              : undefined;
        return warning ? { ok: true, warning } : { ok: true };
      } catch {
        return { ok: false, error: fallback };
      } finally {
        if (mountedRef.current) setIsSavingSettings(false);
      }
    },
    [startFailoverPolling, t]
  );
  const updateSettings = useCallback(
    (change: TowerSettingsChange): Promise<TowerActionResult> => {
      const run = settingsQueueRef.current.then(() => sendSettings(change));
      settingsQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [sendSettings]
  );

  // ---------------------------------------------------------------------------
  // Update Schedule
  // ---------------------------------------------------------------------------
  const updateSchedule = useCallback(
    async (schedule: TowerScheduleConfig): Promise<TowerScheduleSaveResult> => {
      const fallback = t(`${K}.schedule_failed`);
      try {
        const resp = await authFetch(`${CGI_BASE}/schedule.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(schedule),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data: TowerScheduleResponse = await resp.json();
        if (!mountedRef.current) return { ok: data.success === true };

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, fallback),
          };
        }

        setConfig((prev) => (prev ? { ...prev, schedule } : prev));
        // The on-device arm status, so the tile can warn on an unarmed save.
        return { ok: true, armed: data.armed, reason: data.reason };
      } catch {
        return { ok: false, error: fallback };
      }
    },
    [t]
  );

  // ---------------------------------------------------------------------------
  // Manual refresh — quiet: raises `isRefreshing`, never the skeleton
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async (): Promise<boolean> => {
    setIsRefreshing(true);
    try {
      return await fetchStatus();
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
    isSavingSettings,
    readError,
    isWatcherRunning,
    lockLte,
    unlockLte,
    lockNrSa,
    unlockNrSa,
    updateSettings,
    updateSchedule,
    refresh,
  };
}

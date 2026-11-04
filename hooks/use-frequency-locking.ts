"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  FreqLockModemState,
  FreqLockStatusResponse,
  FreqLockResponse,
  NrFreqLockEntry,
} from "@/types/frequency-locking";

// =============================================================================
// useFrequencyLocking — Frequency Lock State & Actions Hook
// =============================================================================
// Fetches frequency lock status from the modem and applies/clears LTE and NR5G
// frequency locks. No config file, no failover, no schedule: state lives
// entirely in the modem and is read back on demand.
//
// PERSISTENCE IS UNKNOWN. `AT+QNWCFG` has no save/persist key, and `save_ctrl`
// belongs to `AT+QNWLOCK` (the tower lock). `frequency/lock.sh` issues exactly
// one AT write per action. Whether an earfcn lock survives a reboot has never
// been tested, so no UI copy on this surface may claim that it does.
//
// THE GATE IS ONE-DIRECTIONAL. `frequency/lock.sh` refuses to run while a tower
// lock is active (or while its state cannot be read), so the tower flags gate
// this page's writes. `tower/lock.sh` has no reciprocal guard: a tower lock
// applied from the other page silently replaces a live frequency lock. This
// hook only sees that on the next `refresh()`.
//
// MUTATORS RETURN THEIR RESULT. A failed write is reported through the
// returned `{ ok, error, detail }`, never through shared state, so the card
// that fired it toasts the right reason (DESIGN.md > Confirmation Toasts).
// `error` below is the STATUS READ's failure only.
//
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/frequency/status.sh  -> full state + tower gate
//   POST /cgi-bin/quecmanager/frequency/lock.sh    -> lock/unlock LTE or NR
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/frequency";

/** Outcome of a lock or unlock write. `error` is the backend code, `detail`
 *  its English sentence (or a transport message when there is no code). */
export interface FreqLockResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface UseFrequencyLockingReturn {
  /** Current modem frequency lock state */
  modemState: FreqLockModemState | null;
  /** True during initial data fetch */
  isLoading: boolean;
  /** True during a refresh that is NOT the first load (keeps the layout). */
  isRefreshing: boolean;
  /** When `status.sh` last answered successfully (epoch ms), or null. */
  lastSyncedAt: number | null;
  /** True while an LTE freq lock/unlock is in progress */
  isLteLocking: boolean;
  /** True while an NR freq lock/unlock is in progress */
  isNrLocking: boolean;
  /** The last STATUS READ failure, or null. Writes report through their result. */
  error: string | null;

  /** Lock LTE to specific EARFCNs (1-2). */
  lockLte: (earfcns: number[]) => Promise<FreqLockResult>;
  /** Clear LTE frequency lock. */
  unlockLte: () => Promise<FreqLockResult>;
  /** Lock NR5G to specific ARFCN+SCS entries (1-32). */
  lockNr: (entries: NrFreqLockEntry[]) => Promise<FreqLockResult>;
  /** Clear NR frequency lock. */
  unlockNr: () => Promise<FreqLockResult>;

  /** Whether the LTE tower lock blocks LTE freq lock. An UNREADABLE tower
   *  state reports true here (fail safe). */
  towerLockLteActive: boolean;
  /** As above, for NR. */
  towerLockNrActive: boolean;
  /** Both tower flags are a reading rather than the fail-safe default. Copy
   *  must not claim a tower lock is active when nobody read one. */
  towerLockStateKnown: boolean;
  /** The LTE leg's tower read came back (false = fail-safe default). */
  towerLockLteReadOk: boolean;
  /** The NR leg's tower read came back (false = fail-safe default). */
  towerLockNrReadOk: boolean;

  /** Manually refresh state. */
  refresh: () => void;
}

export function useFrequencyLocking(): UseFrequencyLockingReturn {
  const [modemState, setModemState] = useState<FreqLockModemState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isLteLocking, setIsLteLocking] = useState(false);
  const [isNrLocking, setIsNrLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch frequency lock status (modem queries + tower lock gating)
  // ---------------------------------------------------------------------------
  const MAX_RETRIES = 3;

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/status.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: FreqLockStatusResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        // `cgi_error` answers with HTTP 200, so a rejected read is only
        // visible here, never through `resp.ok`.
        setError(data.error || "Failed to fetch frequency lock status");
        return;
      }

      if (data.modem_state) {
        setModemState(data.modem_state);
      }
      setError(null);
      // Stamped only on a SUCCESSFUL read, so the age keeps counting from the
      // last reading that actually happened.
      setLastSyncedAt(Date.now());
      retryCountRef.current = 0;
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch frequency lock status",
      );

      // Auto-retry with exponential backoff (2s, 4s, 8s)
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.pow(2, retryCountRef.current + 1) * 1000;
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            fetchStatus();
          }
        }, delay);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Generic lock/unlock helper
  // ---------------------------------------------------------------------------
  const sendLockRequest = useCallback(
    async (
      body: Record<string, unknown>,
      setLocking: (v: boolean) => void,
    ): Promise<FreqLockResult> => {
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

        const data: FreqLockResponse = await resp.json();
        if (!mountedRef.current) return { ok: false };

        if (!data.success) {
          // Same HTTP 200 caveat as the read: `success !== true` is the only
          // signal. `error` is the machine code, `detail` the English half.
          return { ok: false, error: data.error, detail: data.detail };
        }

        // Wait for the modem to reconnect after lock/unlock, then read back.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await fetchStatus();

        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          detail: err instanceof Error ? err.message : undefined,
        };
      } finally {
        if (mountedRef.current) {
          setLocking(false);
        }
      }
    },
    [fetchStatus],
  );

  // ---------------------------------------------------------------------------
  // LTE Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockLte = useCallback(
    async (earfcns: number[]): Promise<FreqLockResult> => {
      if (earfcns.length === 0 || earfcns.length > 2) {
        return { ok: false, error: "invalid_count" };
      }
      return sendLockRequest(
        { type: "lte", action: "lock", earfcns },
        setIsLteLocking,
      );
    },
    [sendLockRequest],
  );

  const unlockLte = useCallback(
    () => sendLockRequest({ type: "lte", action: "unlock" }, setIsLteLocking),
    [sendLockRequest],
  );

  // ---------------------------------------------------------------------------
  // NR Lock/Unlock
  // ---------------------------------------------------------------------------
  const lockNr = useCallback(
    async (entries: NrFreqLockEntry[]): Promise<FreqLockResult> => {
      if (entries.length === 0 || entries.length > 32) {
        return { ok: false, error: "invalid_count" };
      }
      return sendLockRequest(
        { type: "nr", action: "lock", entries },
        setIsNrLocking,
      );
    },
    [sendLockRequest],
  );

  const unlockNr = useCallback(
    () => sendLockRequest({ type: "nr", action: "unlock" }, setIsNrLocking),
    [sendLockRequest],
  );

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  // FAIL SAFE, NOT FAIL OPEN. The tower fields are tri-state: `null` means
  // `status.sh` could not read the tower lock state. An unreadable state blocks
  // exactly as an active one does, and so does a read that never answered.
  const towerLockLteActive = modemState?.tower_lock_lte_active ?? true;
  const towerLockNrActive = modemState?.tower_lock_nr_active ?? true;

  // The gate and the COPY are different questions: blocking on unknown is
  // right, saying "a tower lock is active" when nothing was read is not. The
  // `modemState != null` half is load-bearing (`undefined !== null` is true).
  const towerLockLteReadOk =
    modemState != null && modemState.tower_lock_lte_active !== null;
  const towerLockNrReadOk =
    modemState != null && modemState.tower_lock_nr_active !== null;
  const towerLockStateKnown = towerLockLteReadOk && towerLockNrReadOk;

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    // A refresh keeps the loaded layout and spins the control; it never drops
    // the page back to skeletons.
    setIsRefreshing(true);
    fetchStatus();
  }, [fetchStatus]);

  return {
    modemState,
    isLoading,
    isRefreshing,
    lastSyncedAt,
    isLteLocking,
    isNrLocking,
    error,
    lockLte,
    unlockLte,
    lockNr,
    unlockNr,
    towerLockLteActive,
    towerLockNrActive,
    towerLockStateKnown,
    towerLockLteReadOk,
    towerLockNrReadOk,
    refresh,
  };
}

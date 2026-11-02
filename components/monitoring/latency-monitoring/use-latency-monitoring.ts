"use client";

import { useLatencyHistory } from "@/hooks/use-latency-history";
import { useModemStatus } from "@/hooks/use-modem-status";
import type {
  ConnectivityStatus,
  PingHistoryEntry,
} from "@/types/modem-status";

// Latency Monitor: the live probe window (5 s) and the 24 h archived ring (30 s).

const STATUS_POLL_MS = 5000;
/** A snapshot older than this (modem clock vs browser clock) reads as unreachable. */
const UNREACHABLE_AGE_SEC = 60;

export interface UseLatencyMonitoringReturn {
  /** Live connectivity payload, or null before the first snapshot. */
  connectivity: ConnectivityStatus | null;
  /** Modem clock (epoch s) of the snapshot behind `connectivity`; null before the first one. */
  snapshotAt: number | null;
  statusLoading: boolean;
  /** The status read failed, or the last snapshot is over a minute old. */
  unreachable: boolean;
  refreshStatus: () => void;
  history: PingHistoryEntry[];
  historyLoading: boolean;
  historyError: string | null;
  refreshHistory: () => void;
}

export function useLatencyMonitoring(): UseLatencyMonitoringReturn {
  const status = useModemStatus({ pollInterval: STATUS_POLL_MS });
  const history = useLatencyHistory();

  // Not `modem_reachable`: one failed AT read flips it, and the ping data does not use the AT port.
  const snapshotAt = status.data?.timestamp ?? null;
  const tooOld =
    snapshotAt !== null &&
    status.receivedAtMs !== null &&
    status.receivedAtMs / 1000 - snapshotAt > UNREACHABLE_AGE_SEC;

  return {
    connectivity: status.data?.connectivity ?? null,
    snapshotAt,
    statusLoading: status.isLoading,
    unreachable: status.error !== null || tooOld,
    refreshStatus: status.refresh,
    history: history.data,
    historyLoading: history.isLoading,
    historyError: history.error,
    refreshHistory: history.refresh,
  };
}

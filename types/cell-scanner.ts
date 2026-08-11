// =============================================================================
// Cell Scanner — result and transport types
// =============================================================================
// These lived in `components/cellular/cell-scanner/scan-result.tsx`, and
// `hooks/use-cell-scanner.ts` imported them BACKWARDS — a data hook reaching
// into a table component for the shape of the data it fetches. That inversion is
// what made the table impossible to replace without touching the hook, and it is
// the reason the neighbour route forked rather than shared.
//
// The direction is now the usual one: the transport shape is declared here, and
// both the hook that fetches it and the components that render it import from
// this file. Nothing in `types/` imports from `components/`.
// =============================================================================

/** One cell reported by `AT+QSCAN=3,1`, as normalised by `cell_scan_status.sh`. */
export interface CellScanResult {
  /** Stable row key assigned by the worker. */
  id: string;
  /** `LTE` or `NR5G-SA`. Drives the radio-identity chip and the lock payload. */
  networkType: string;
  earfcn: number;
  pci: number;
  band: number;
  bandwidth: number;
  cellID: number;
  tac: number;
  /** RSRP in dBm. The worker emits 0 for an unreported reading — see `signalTier`. */
  signalStrength: number;
  mcc: number;
  mnc: number;
  provider: string;
  /**
   * Subcarrier spacing, kHz. NR only, and only when the modem reported one — a
   * tower lock on an NR cell needs it, so a missing value falls back to the
   * common 30 kHz at the point of use rather than being invented here.
   */
  scs?: number | null;
}

/**
 * The worker's own state machine, which is NOT the same vocabulary as the
 * surface's `RunPosture`. `shapes.ts > runPosture` is the one place the two are
 * mapped, so a new transport state cannot silently render untinted.
 */
export type ScanStatus = "idle" | "running" | "complete" | "error";

/** The envelope returned by `at_cmd/cell_scan_status.sh`. */
export interface CellScanStatusResponse {
  status: ScanStatus;
  results?: CellScanResult[];
  message?: string;
}

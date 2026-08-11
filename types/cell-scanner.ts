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

// -----------------------------------------------------------------------------
// The neighbour read
// -----------------------------------------------------------------------------
// A DIFFERENT SHAPE FROM `CellScanResult`, deliberately not merged with it. The
// two workers ask the modem different questions and get different answers back:
// a sweep reports a cell's full identity (operator, MCC/MNC, cell ID, TAC,
// bandwidth), a neighbour read reports a measurement of a cell the serving tower
// already knows about (RSRQ, RSSI, SINR, and whether it is on this frequency or
// another). Only `id`, `networkType`, `pci` and `signalStrength` genuinely
// overlap, and they even disagree on what to call the channel — `earfcn` here is
// `frequency`.
//
// Widening one type to cover both would make ten fields optional and push the
// "which of these is actually populated?" question into every call site. The
// SHELL is shared; the shapes are not.

/** How the neighbour was reported, relative to the serving cell's own frequency. */
export type NeighbourCellType = "intra" | "inter" | "nr5g";

/** One cell reported by `AT+QENG="neighbourcell"` / `AT+QNWCFG="nr5g_meas_info"`. */
export interface NeighbourCellResult {
  id: string;
  /** `LTE` or `NR5G`. Only LTE neighbours are lockable — see the actions column. */
  networkType: string;
  cellType: NeighbourCellType;
  /** EARFCN / NR-ARFCN. The worker emits 0 when the modem did not report one. */
  frequency: number;
  /** The worker emits 0 for an unreported PCI. */
  pci: number;
  /** RSRP in dBm. 0 means unmeasured, NOT 0 dBm — see `signalTier`. */
  signalStrength: number;
  /** These three are `null` when unreported. NR5G rows never carry RSSI by design. */
  rsrq: number | null;
  rssi: number | null;
  sinr: number | null;
}

/** The envelope returned by `at_cmd/neighbour_scan_status.sh`. */
export interface NeighbourScanStatusResponse {
  status: ScanStatus;
  results?: NeighbourCellResult[];
  message?: string;
}

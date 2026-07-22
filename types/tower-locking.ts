// =============================================================================
// tower-locking.ts — QManager Tower Locking Types
// =============================================================================
// TypeScript interfaces and utility functions for the Tower Locking feature.
// Tower locking controls which specific physical cell the modem connects to,
// independent of band locking (which controls frequencies).
//
// Backend contract:
//   Status:          GET  /cgi-bin/quecmanager/tower/status.sh
//   Lock/Unlock:     POST /cgi-bin/quecmanager/tower/lock.sh
//   Settings:        POST /cgi-bin/quecmanager/tower/settings.sh
//   Schedule:        POST /cgi-bin/quecmanager/tower/schedule.sh
//   Failover status: GET  /cgi-bin/quecmanager/tower/failover_status.sh
// =============================================================================

// --- Tower Lock Cell Targets -------------------------------------------------

/** A single LTE cell target for tower locking (EARFCN + PCI pair) */
export interface LteLockCell {
  earfcn: number;
  pci: number;
}

/** A single NR-SA cell target for tower locking */
export interface NrSaLockCell {
  pci: number;
  arfcn: number;
  scs: number; // kHz value: 15, 30, 60, 120, 240
  band: number; // NR band number (e.g., 41)
}

// --- Configuration -----------------------------------------------------------

/** Full tower lock configuration from /etc/qmanager/tower_lock.json */
export interface TowerLockConfig {
  lte: {
    enabled: boolean;
    cells: (LteLockCell | null)[]; // Fixed 3 slots
  };
  nr_sa: {
    enabled: boolean;
    pci: number | null;
    arfcn: number | null;
    scs: number | null;
    band: number | null;
  };
  persist: boolean;
  failover: {
    enabled: boolean;
    threshold: number; // 0-100 percentage
  };
  schedule: TowerScheduleConfig;
}

/** Schedule configuration for automated tower lock enable/disable */
export interface TowerScheduleConfig {
  enabled: boolean;
  start_time: string; // "HH:MM" format
  end_time: string;
  days: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
}

// --- Modem State (from AT+QNWLOCK queries) -----------------------------------

/** Live modem lock state queried from AT+QNWLOCK commands */
export interface TowerModemState {
  lte_locked: boolean;
  lte_cells: LteLockCell[];
  nr_locked: boolean;
  nr_cell: NrSaLockCell | null;
  persist_lte: boolean;
  persist_nr: boolean;
}

// --- Failover ----------------------------------------------------------------

/** Failover watcher state (from flag files, no modem contact) */
export interface TowerFailoverState {
  enabled: boolean;
  activated: boolean;
  watcher_running: boolean;
}

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/tower/status.sh */
export interface TowerStatusResponse {
  success: boolean;
  modem_state: TowerModemState;
  config: TowerLockConfig;
  failover_state: TowerFailoverState;
  error?: string;
}

/** Response from POST /cgi-bin/quecmanager/tower/lock.sh */
export interface TowerLockResponse {
  success: boolean;
  type?: string;
  action?: string;
  num_cells?: number;
  failover_armed?: boolean;
  error?: string;
  detail?: string;
}

/** Response from POST /cgi-bin/quecmanager/tower/settings.sh */
export interface TowerSettingsResponse {
  success: boolean;
  persist?: boolean;
  failover_enabled?: boolean;
  failover_threshold?: number;
  persist_command_failed?: boolean;
  /** True if the failover watcher was spawned during this settings update */
  watcher_spawned?: boolean;
  error?: string;
  detail?: string;
}

/** Response from POST /cgi-bin/quecmanager/tower/schedule.sh */
export interface TowerScheduleResponse {
  success: boolean;
  enabled?: boolean;
  start_time?: string;
  end_time?: string;
  days?: number[];
  /**
   * Whether the schedule was actually installed as a live systemd timer on THIS
   * device (vs. merely written to config). `armed:false` + a `reason` (e.g.
   * "unit_absent") means it persisted but won't fire until the timer unit ships
   * — the UI warns instead of flashing an unconditional success.
   */
  armed?: boolean;
  reason?: string;
  error?: string;
  detail?: string;
}

/**
 * Result surfaced to the schedule card after saving a tower schedule. `armed`
 * carries the on-device timer status so the card can warn honestly. Absent
 * `armed` (older backend that doesn't report it) is treated as "assume armed".
 */
export interface TowerScheduleSaveResult {
  success: boolean;
  armed?: boolean;
  reason?: string;
}

/** Response from GET /cgi-bin/quecmanager/tower/failover_status.sh */
export interface TowerFailoverStatusResponse {
  enabled: boolean;
  activated: boolean;
  watcher_running: boolean;
}

// --- Utility Functions -------------------------------------------------------

/**
 * Convert RSRP (dBm) to signal quality percentage (0-100).
 * Maps: -140 dBm → 0%, -80 dBm → 100%
 * Formula: clamp(0, 100, ((rsrp + 140) / 60) × 100)
 *
 * Shared with backend failover watcher (calc_signal_quality in tower_lock_mgr.sh)
 */
export function rsrpToQualityPercent(rsrp: number | null): number {
  if (rsrp === null || rsrp === undefined) return 0;
  const quality = ((rsrp + 140) / 60) * 100;
  return Math.max(0, Math.min(100, Math.round(quality)));
}

/** Quality level categories for badge coloring */
export type QualityLevel = "good" | "fair" | "poor" | "critical" | "none";

/**
 * Map a quality percentage to a semantic level for UI badges.
 *
 * ≥60% → green (good)
 * ≥40% → yellow (fair)
 * ≥20% → orange (poor)
 * <20% → red (critical)
 */
export function qualityLevel(percent: number): QualityLevel {
  if (percent >= 60) return "good";
  if (percent >= 40) return "fair";
  if (percent >= 20) return "poor";
  return "critical";
}

/** SCS dropdown options for NR-SA tower locking card (kHz values sent to modem) */
export const SCS_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 kHz" },
  { value: 30, label: "30 kHz" },
  { value: 60, label: "60 kHz" },
  { value: 120, label: "120 kHz" },
  { value: 240, label: "240 kHz" },
];

/** Day names for schedule UI (index matches days array: 0=Sun) */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

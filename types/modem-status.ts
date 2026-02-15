// =============================================================================
// modem-status.ts — QManager JSON Data Contract (TypeScript)
// =============================================================================
// This MUST stay in sync with the JSON produced by qmanager_poller.sh.
// Every field maps directly to a React component on the Home dashboard.
//
// See: QManager_Backend_Architecture.docx §6 "JSON Data Contract"
// =============================================================================

// --- Top-Level Status --------------------------------------------------------

export interface ModemStatus {
  /** Unix epoch (seconds) — updated every poll cycle */
  timestamp: number;
  /** Current system state */
  system_state: SystemState;
  /** Whether the modem responded to the last AT command */
  modem_reachable: boolean;
  /** Unix epoch of last successful modem response */
  last_successful_poll: number;
  /** Error codes (empty array = no errors) */
  errors: ErrorCode[];
  /** Network connection info */
  network: NetworkStatus;
  /** LTE (4G) serving cell data */
  lte: LteStatus;
  /** NR (5G) serving cell data */
  nr: NrStatus;
  /** Device hardware and identity info */
  device: DeviceStatus;
  /** Live traffic metrics */
  traffic: TrafficStatus;
  /** Internet connectivity and latency (from ping daemon) */
  connectivity: ConnectivityStatus;
}

// --- Enums & Unions ----------------------------------------------------------

export type SystemState =
  | "normal"
  | "degraded"
  | "scan_in_progress"
  | "recovery_in_progress"
  | "initializing";

export type ErrorCode =
  | "modem_timeout"
  | "sim_not_inserted"
  | "command_error"
  | "poller_not_started"
  | "ping_daemon_missing";

export type ServiceStatus =
  | "optimal"
  | "connected"
  | "limited"
  | "no_service"
  | "searching"
  | "sim_error"
  | "unknown";

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "searching"
  | "limited"
  | "inactive"
  | "unknown"
  | "error";

export type NetworkType = "LTE" | "5G-NSA" | "5G-SA" | "";

// --- Sub-Interfaces ----------------------------------------------------------

export interface NetworkStatus {
  /** Current access technology: LTE, 5G-NSA, 5G-SA */
  type: NetworkType;
  /** Active SIM slot (1 or 2) */
  sim_slot: number;
  /** Registered carrier/operator name */
  carrier: string;
  /** Overall service quality assessment */
  service_status: ServiceStatus;
  /** Whether LTE carrier aggregation is active (LTE SCC lines present in QCAINFO) */
  ca_active: boolean;
  /** Number of LTE secondary carriers (SCC count) */
  ca_count: number;
  /** Whether NR carrier aggregation is active (NR SCC lines present in QCAINFO) */
  nr_ca_active: boolean;
  /** Number of NR secondary carriers (NR SCC count) */
  nr_ca_count: number;
}

export interface LteStatus {
  /** Connection state */
  state: ConnectionState;
  /** Band name in 3GPP notation, e.g. "B3" */
  band: string;
  /** E-UTRA Absolute Radio Frequency Channel Number */
  earfcn: number | null;
  /** Downlink bandwidth in MHz */
  bandwidth: number | null;
  /** Physical Cell ID */
  pci: number | null;
  /** Reference Signal Received Power (dBm) — always a negative number */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) — always a negative number */
  rsrq: number | null;
  /** Signal to Interference plus Noise Ratio (dB) */
  sinr: number | null;
  /** Received Signal Strength Indicator (dBm) */
  rssi: number | null;
  /** Timing Advance index (0–1282). Used for cell distance estimation. */
  ta: number | null;
}

export interface NrStatus {
  /** Connection state */
  state: ConnectionState;
  /** Band name in 3GPP notation, e.g. "N41" */
  band: string;
  /** NR Absolute Radio Frequency Channel Number */
  arfcn: number | null;
  /** Physical Cell ID */
  pci: number | null;
  /** Reference Signal Received Power (dBm) */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) */
  rsrq: number | null;
  /** Signal to Interference plus Noise Ratio (dB) */
  sinr: number | null;
  /** Subcarrier Spacing in kHz (15, 30, 60, 120) */
  scs: number | null;
  /** NR Timing Advance (NTA value). Used for cell distance estimation. */
  ta: number | null;
}

export interface DeviceStatus {
  /** Average modem temperature in °C across all available sensors (null if unavailable) */
  temperature: number | null;
  /** CPU usage percentage (0–100), calculated from /proc/stat delta between poll cycles */
  cpu_usage: number;
  /** Used memory in MB */
  memory_used_mb: number;
  /** Total memory in MB */
  memory_total_mb: number;
  /** Device uptime in seconds */
  uptime_seconds: number;
  /** Active connection uptime in seconds */
  conn_uptime_seconds: number;
  /** Firmware version string (from AT+CVERSION) */
  firmware: string;
  /** Firmware build date, e.g. "Jun 25 2025" (from AT+CVERSION) */
  build_date: string;
  /** Modem manufacturer, e.g. "Quectel" (from AT+CVERSION) */
  manufacturer: string;
  /** Device IMEI (15-digit) */
  imei: string;
  /** SIM IMSI */
  imsi: string;
  /** SIM ICCID */
  iccid: string;
  /** Phone number (MSISDN) */
  phone_number: string;
  /** LTE UE Category, e.g. "20" (from AT+QGETCAPABILITY) */
  lte_category: string;
  /** MIMO layers string, e.g. "LTE 1x4" (from AT+QNWCFG="lte_mimo_layers") */
  mimo: string;
}

export interface TrafficStatus {
  /** Current download speed in bytes/second */
  rx_bytes_per_sec: number;
  /** Current upload speed in bytes/second */
  tx_bytes_per_sec: number;
  /** Total downloaded bytes since boot */
  total_rx_bytes: number;
  /** Total uploaded bytes since boot */
  total_tx_bytes: number;
}

// --- Utility Types -----------------------------------------------------------

/** Signal quality thresholds for UI indicators */
export interface SignalThresholds {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

/** RSRP thresholds (dBm) — higher (less negative) is better */
export const RSRP_THRESHOLDS: SignalThresholds = {
  excellent: -80,
  good: -100,
  fair: -110,
  poor: -140,
};

/** RSRQ thresholds (dB) — higher (less negative) is better */
export const RSRQ_THRESHOLDS: SignalThresholds = {
  excellent: -5,
  good: -10,
  fair: -15,
  poor: -20,
};

/** SINR thresholds (dB) — higher is better */
export const SINR_THRESHOLDS: SignalThresholds = {
  excellent: 20,
  good: 13,
  fair: 0,
  poor: -20,
};

/**
 * Categorizes a signal value into a quality level based on thresholds.
 * Works for any metric where higher = better.
 */
export function getSignalQuality(
  value: number | null,
  thresholds: SignalThresholds
): "excellent" | "good" | "fair" | "poor" | "none" {
  if (value === null || value === undefined) return "none";
  if (value >= thresholds.excellent) return "excellent";
  if (value >= thresholds.good) return "good";
  if (value >= thresholds.fair) return "fair";
  return "poor";
}

export type ConnectivityState =
  | "connected"
  | "degraded"
  | "disconnected"
  | "recovery"
  | "unknown";

export interface ConnectivityStatus {
  /** Whether internet is reachable based on ping results. null = ping daemon not running. */
  internet_available: boolean | null;
  /** Derived connectivity status */
  status: ConnectivityState;
  /** Most recent RTT in milliseconds. null if last ping failed. */
  latency_ms: number | null;
  /** Rolling average RTT from history window */
  avg_latency_ms: number | null;
  /** Minimum RTT in history window */
  min_latency_ms: number | null;
  /** Maximum RTT in history window */
  max_latency_ms: number | null;
  /** Average inter-packet RTT variation */
  jitter_ms: number | null;
  /** Percentage of failed pings in history window (0-100) */
  packet_loss_pct: number;
  /** Currently active ping target IP */
  ping_target: string;
  /** Ring buffer of last N RTT values. null entries = failed pings. */
  latency_history: (number | null)[];
  /** Seconds between history samples */
  history_interval_sec: number;
  /** Maximum entries in history array */
  history_size: number;
  /** Whether watchcat recovery is currently active */
  during_recovery: boolean;
}

// --- Connectivity Utility Functions ------------------------------------------

/** Latency quality thresholds (ms) — lower is better */
export const LATENCY_THRESHOLDS = {
  excellent: 30,
  good: 60,
  fair: 100,
  poor: Infinity,
} as const;

/**
 * Categorizes a latency value into a quality level.
 * Lower latency = better quality.
 */
export function getLatencyQuality(
  latencyMs: number | null
): "excellent" | "good" | "fair" | "poor" | "none" {
  if (latencyMs === null || latencyMs === undefined) return "none";
  if (latencyMs <= LATENCY_THRESHOLDS.excellent) return "excellent";
  if (latencyMs <= LATENCY_THRESHOLDS.good) return "good";
  if (latencyMs <= LATENCY_THRESHOLDS.fair) return "fair";
  return "poor";
}

/**
 * Formats a latency value for display.
 * e.g., 34.2 → "34ms", null → "-"
 */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null || latencyMs === undefined) return "-";
  if (latencyMs < 1) return "< 1ms";
  return `${Math.round(latencyMs)}ms`;
}

/**
 * Formats jitter for display.
 * e.g., 4.8 → "4.8ms"
 */
export function formatJitter(jitterMs: number | null): string {
  if (jitterMs === null || jitterMs === undefined) return "-";
  return `${jitterMs.toFixed(1)}ms`;
}

// --- Formatting Utilities ----------------------------------------------------

/**
 * Formats bytes per second into a human-readable string.
 * e.g., 1562500 → "12.5 Mbps"
 */
export function formatBytesPerSec(bytesPerSec: number): string {
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1_000_000) {
    return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bitsPerSec >= 1_000) {
    return `${(bitsPerSec / 1_000).toFixed(0)} Kbps`;
  }
  return `${bitsPerSec} bps`;
}

/**
 * Formats total bytes into a human-readable string.
 * e.g., 1073741824 → "1.0 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

// --- Cell Distance Calculations (3GPP) --------------------------------------

/**
 * Calculates LTE cell distance from Timing Advance index.
 * Based on 3GPP TS 36.213: NTA = 16 × TA, TS = 1/(2048×15000).
 * Distance = (c × NTA × TS) / 2.
 * @param ta - LTE TA index (0–1282)
 * @returns distance in km, or null if TA is unavailable/invalid
 */
export function calculateLteDistance(ta: number | null): number | null {
  if (ta === null || ta === undefined || ta < 0 || ta > 1282) return null;
  const NTA = 16 * ta;
  const TS = 1 / 30720000; // 1/(2048×15000)
  const SPEED_OF_LIGHT = 3e8;
  return (SPEED_OF_LIGHT * NTA * TS) / 2 / 1000;
}

/**
 * Calculates NR cell distance from NTA value.
 * Based on 3GPP TS 38.213: TC = 1/(480×10³×4096).
 * Distance = (c × NTA × TC) / 2.
 * @param nta - NR NTA value (already NTA, not TA index)
 * @returns distance in km, or null if NTA is unavailable/invalid
 */
export function calculateNrDistance(nta: number | null): number | null {
  if (nta === null || nta === undefined || nta < 0) return null;
  const TC = 1 / (480 * 1000 * 4096);
  const SPEED_OF_LIGHT = 3e8;
  return (SPEED_OF_LIGHT * nta * TC) / 2 / 1000;
}

/**
 * Formats a distance in km to a human-readable string.
 * e.g., 0.156 → "156 m", 1.234 → "1.23 km"
 */
export function formatDistance(km: number | null): string {
  if (km === null) return "-";
  if (km < 0.01) return "< 10 m";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

/**
 * Formats seconds into a human-readable uptime string (no seconds shown).
 * e.g., 45910 → "12h 45m", 30 → "0m", 3661 → "1h 1m"
 */
export function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0m";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

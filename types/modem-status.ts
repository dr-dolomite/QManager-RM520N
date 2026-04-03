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
  /** Per-antenna signal values (from AT+QRSRP/QRSRQ/QSINR, Tier 1.5) */
  signal_per_antenna: SignalPerAntenna;
  /** Watchcat state machine data */
  watchcat: WatchcatStatus;
  /** SIM failover state (active when running on backup SIM) */
  sim_failover: SimFailoverStatus;
  /** SIM swap detection (physical SIM card change at boot) */
  sim_swap: SimSwapStatus;
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
  /** Radio functionality level from AT+CFUN? (0=off, 1=normal, 4=RF off) */
  cfun?: number;
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
  /** Total aggregated bandwidth in MHz (PCC + all SCCs, from AT+QCAINFO) */
  total_bandwidth_mhz: number;
  /** Per-band bandwidth breakdown for tooltip, e.g. "B3: 15 MHz + N41: 100 MHz" */
  bandwidth_details: string;
  /** Active APN name from AT+CGCONTRDP (first non-IMS profile) */
  apn: string;
  /** WAN IPv4 address from AT+QMAP="WWAN" */
  wan_ipv4: string;
  /** WAN IPv6 address from AT+QMAP="WWAN" (empty string if not assigned) */
  wan_ipv6: string;
  /** Primary DNS server from AT+CGCONTRDP */
  primary_dns: string;
  /** Secondary DNS server from AT+CGCONTRDP */
  secondary_dns: string;
  /** Per-carrier component details from AT+QCAINFO (PCC + all SCCs) */
  carrier_components: CarrierComponent[];
}

/** A single carrier component from AT+QCAINFO (PCC or SCC) */
export interface CarrierComponent {
  /** Carrier type: PCC (primary) or SCC (secondary) */
  type: "PCC" | "SCC";
  /** Radio technology */
  technology: "LTE" | "NR";
  /** Band name in 3GPP notation, e.g. "B3" or "N41" */
  band: string;
  /** E-UTRA/NR ARFCN */
  earfcn: number | null;
  /** Bandwidth in MHz */
  bandwidth_mhz: number;
  /** Physical Cell ID */
  pci: number | null;
  /** Reference Signal Received Power (dBm) */
  rsrp: number | null;
  /** Reference Signal Received Quality (dB) */
  rsrq: number | null;
  /** Received Signal Strength Indication (dBm). LTE only, null for NR. */
  rssi: number | null;
  /** Signal to Interference plus Noise Ratio (dB). NR values are already converted (raw/100). */
  sinr: number | null;
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
  /** Cell ID (28-bit E-UTRAN Cell Identity) as decimal */
  cell_id: number | null;
  /** eNodeB ID — top 20 bits of Cell ID (cell_id >> 8) */
  enodeb_id: number | null;
  /** Sector ID — bottom 8 bits of Cell ID (cell_id & 0xFF) */
  sector_id: number | null;
  /** Tracking Area Code as decimal */
  tac: number | null;
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
  /** Cell ID (36-bit NR Cell Identity) as decimal. Only populated in SA mode. */
  cell_id: number | null;
  /** gNodeB ID — top 22 bits of Cell ID (cell_id >> 14). Only populated in SA mode. */
  enodeb_id: number | null;
  /** Sector ID — bottom 14 bits of Cell ID (cell_id & 0x3FFF). Only populated in SA mode. */
  sector_id: number | null;
  /** Tracking Area Code as decimal. Only populated in SA mode. */
  tac: number | null;
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
  /** Modem model name, e.g. "RM551E-GL" (from AT+CGMM) */
  model: string;
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
  /** Active MIMO layers, e.g. "LTE 1x4" or "LTE 1x4 | NR 2x4" (Tier 2, updates with signal conditions) */
  mimo: string;
  /** Hardware-supported LTE bands, colon-delimited (boot-only, from AT+QNWPREFCFG="policy_band") */
  supported_lte_bands: string;
  /** Hardware-supported NSA NR5G bands, colon-delimited (boot-only) */
  supported_nsa_nr5g_bands: string;
  /** Hardware-supported SA NR5G bands, colon-delimited (boot-only) */
  supported_sa_nr5g_bands: string;
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

// --- Watchcat State (from /tmp/qmanager_watchcat.json via poller) ------------

export type WatchcatState =
  | "monitor"
  | "suspect"
  | "recovery"
  | "cooldown"
  | "locked"
  | "disabled";

export interface WatchcatStatus {
  enabled: boolean;
  state: WatchcatState;
  current_tier: number;
  failure_count: number;
  last_recovery_time: number | null;
  last_recovery_tier: number | null;
  total_recoveries: number;
  cooldown_remaining: number;
  reboots_this_hour: number;
}

export interface SimFailoverStatus {
  active: boolean;
  original_slot: number | null;
  current_slot: number | null;
  switched_at: number | null;
}

export interface SimSwapStatus {
  detected: boolean;
  matching_profile_id: string | null;
  matching_profile_name: string | null;
}

// --- Per-Antenna Signal Data -------------------------------------------------

/**
 * Metadata for each of the 4 antenna ports (ANT0–ANT3).
 * Shared across antenna-statistics, antenna-alignment, and any future per-port UI.
 */
export const ANTENNA_PORTS = [
  { name: "Main", rx: "PRX", description: "Main transmit/receive antenna (ANT0)" },
  { name: "Diversity", rx: "DRX", description: "Diversity / receive antenna (ANT1)" },
  { name: "MIMO 3", rx: "RX2", description: "MIMO spatial stream 1 (ANT2)" },
  { name: "MIMO 4", rx: "RX3", description: "MIMO spatial stream 2 (ANT3)" },
] as const;

/**
 * Per-antenna signal values from AT+QRSRP, AT+QRSRQ, AT+QSINR.
 * Each array has 4 elements [ant0, ant1, ant2, ant3].
 * null entries indicate inactive/unavailable antenna ports (sentinel -32768).
 */
export interface SignalPerAntenna {
  lte_rsrp: (number | null)[];
  lte_rsrq: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_rsrq: (number | null)[];
  nr_sinr: (number | null)[];
}

/**
 * A single entry from the signal history NDJSON file.
 * One line is appended every 10 seconds (Tier 1.5 interval).
 */
export interface SignalHistoryEntry {
  /** Unix epoch (seconds) */
  ts: number;
  lte_rsrp: (number | null)[];
  lte_rsrq: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_rsrq: (number | null)[];
  nr_sinr: (number | null)[];
}

/**
 * A single entry from the ping history NDJSON file.
 * One line is appended every 10 seconds (Tier 1.5 interval).
 * Short field names match the backend NDJSON output for minimal transfer size.
 */
export interface PingHistoryEntry {
  /** Unix epoch (seconds) */
  ts: number;
  /** Last RTT in ms, or null if ping failed at that sample */
  lat: number | null;
  /** Rolling average RTT in ms */
  avg: number | null;
  /** Minimum RTT in ms over ping daemon's history window */
  min: number | null;
  /** Maximum RTT in ms over ping daemon's history window */
  max: number | null;
  /** Packet loss percentage (0-100) */
  loss: number;
  /** Jitter in ms, or null if insufficient data */
  jit: number | null;
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

// --- Network Events (Recent Activities) --------------------------------------

/** Event types emitted by the poller's change detection */
export type NetworkEventType =
  | "network_mode"        // Network mode changed (LTE → 5G-NSA, etc.)
  | "band_change"         // LTE or NR band changed
  | "pci_change"          // PCC cell handoff (PCI changed)
  | "scc_pci_change"      // SCC cell handoff (secondary carrier PCI changed)
  | "ca_change"           // Carrier Aggregation activated/deactivated/count changed
  | "nr_anchor"           // 5G NR anchor gained or lost
  | "signal_lost"         // Modem became unreachable
  | "signal_restored"     // Modem signal restored
  | "internet_lost"       // Internet connectivity lost
  | "internet_restored"   // Internet connectivity restored
  | "high_latency"        // Latency exceeded 90ms threshold
  | "latency_recovered"   // Latency returned below threshold
  | "high_packet_loss"    // Packet loss exceeded 20% threshold
  | "packet_loss_recovered" // Packet loss returned below threshold
  | "watchcat_recovery"   // Watchcat executed a recovery action (Tier 1-4)
  | "sim_failover"        // SIM failover event (Tier 3 switch/fallback)
  | "sim_swap_detected"   // Physical SIM card swap detected at boot
  | "airplane_mode";      // Airplane mode enabled/disabled (CFUN changed)

/** Severity level for UI icon coloring */
export type EventSeverity = "info" | "warning" | "error";

/** A single network event from the poller's NDJSON events file */
export interface NetworkEvent {
  /** Unix epoch (seconds) when the event was detected */
  timestamp: number;
  /** Event classification */
  type: NetworkEventType;
  /** Human-readable description of the event */
  message: string;
  /** Severity for UI indicator (info = green, warning = amber) */
  severity: EventSeverity;
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
 * Formats bits per second into a human-readable string.
 * Unlike formatBytesPerSec (which takes bytes and converts to bits),
 * this takes raw bits per second directly (e.g., from WebSocket bandwidth data).
 * e.g., 12500000 → "12.5 Mbps"
 */
export function formatBitsPerSec(bitsPerSec: number): string {
  if (bitsPerSec >= 1_000_000_000) {
    return `${(bitsPerSec / 1_000_000_000).toFixed(2)} Gbps`;
  }
  if (bitsPerSec >= 1_000_000) {
    return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bitsPerSec >= 1_000) {
    return `${(bitsPerSec / 1_000).toFixed(0)} Kbps`;
  }
  return `${Math.round(bitsPerSec)} bps`;
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
 * When unit is "miles", converts to imperial (feet/miles).
 */
export function formatDistance(
  km: number | null,
  unit?: "km" | "miles",
): string {
  if (km === null) return "-";
  if (unit === "miles") {
    const miles = km * 0.621371;
    if (miles < 0.01) return "< 50 ft";
    if (miles < 1) return `${Math.round(miles * 5280)} ft`;
    return `${miles.toFixed(2)} mi`;
  }
  if (km < 0.01) return "< 10 m";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

/**
 * Formats a temperature for display.
 * Backend always returns Celsius; converts to Fahrenheit when requested.
 */
export function formatTemperature(
  celsius: number | null,
  unit?: "celsius" | "fahrenheit",
): string {
  if (celsius === null) return "-";
  if (unit === "fahrenheit") {
    return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  }
  return `${celsius}°C`;
}

/**
 * Converts a signal value to a 0–100 percentage for progress bars.
 * Maps the value linearly within its quality range.
 */
export function signalToProgress(
  value: number | null,
  thresholds: SignalThresholds
): number {
  if (value === null || value === undefined) return 0;
  // Map from [poor, excellent] → [0, 100]
  const range = thresholds.excellent - thresholds.poor;
  if (range === 0) return 50;
  const pct = ((value - thresholds.poor) / range) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Formats a Unix timestamp into a relative time string.
 * e.g., (now - 120) → "2m ago", (now - 3700) → "1h ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 0) return "just now";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// --- Cell ID / TAC Display Utilities -----------------------------------------

/**
 * Formats a nullable number for display, returning "-" for null/undefined.
 * Used for Cell ID, eNodeB ID, Sector ID, TAC, and similar numeric fields.
 */
export function formatNumericField(value: number | null | undefined): string {
  return value != null ? value.toString() : "-";
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

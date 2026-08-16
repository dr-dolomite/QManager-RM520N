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
  /** Persistent data-usage counter (optional — absent on older firmware or before first poller write) */
  data_used?: DataUsedBlock;
  /**
   * SIM readiness snapshot (optional — a device OTA-upgraded from an older
   * poller will not emit this block, so every consumer must tolerate `undefined`
   * rather than assuming a card is present).
   */
  sim?: SimBlock;
}

/** SIM readiness block published by the poller from AT+CPIN?. */
export interface SimBlock {
  /** Classified readiness state */
  status: SimStatus;
  /** Whether a card is physically present (false when `status` is "not_inserted") */
  inserted: boolean;
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

/**
 * Access technology the poller could positively identify.
 *
 * `""` means "not determined" — it is NOT a synonym for LTE. The poller used to
 * fall back to `"LTE"` for any technology it could not parse (GSM, WCDMA, no
 * service), which made an unparsed reading indistinguishable from a real 4G
 * attach. That fallback is now `""`; treat it as unknown and render it as such.
 */
export type NetworkType = "LTE" | "5G-NSA" | "5G-SA" | "";

/** Display label for a {@link NetworkType}. */
export type NetworkTypeLabel = "LTE" | "5G NSA" | "5G SA" | "Unknown";

/**
 * Map an access technology to its display label.
 *
 * Never invents a technology: an empty/unrecognised value returns `"Unknown"`
 * rather than guessing LTE.
 */
export function networkTypeLabel(type: NetworkType): NetworkTypeLabel {
  switch (type) {
    case "LTE":
      return "LTE";
    case "5G-NSA":
      return "5G NSA";
    case "5G-SA":
      return "5G SA";
    default:
      return "Unknown";
  }
}

/**
 * SIM readiness from AT+CPIN? as classified by `parse_at.sh`.
 * These are the exact strings the poller emits — do not add synonyms.
 */
export type SimStatus =
  | "ready"
  | "pin_required"
  | "puk_required"
  | "not_inserted"
  | "error"
  | "unknown";

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
  /**
   * Raw QENG downlink bandwidth ENUM, not MHz: 0-5 maps to 1.4/3/5/10/15/20 MHz.
   * The poller stores field 12 of AT+QENG="servingcell" undecoded, so a 20 MHz
   * channel arrives here as `5`. For a real MHz figure use
   * `NetworkStatus.carrier_components[].bandwidth_mhz`, which AT+QCAINFO
   * reports as resource blocks and the poller decodes.
   */
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

/**
 * Persistent data-usage counter maintained by the poller across modem
 * reboots and interface flaps. Sourced from the kernel rmnet interface
 * byte counters (/proc/net/dev) — the kernel labels rx/tx identically on
 * every firmware, so no AT-counter orientation calibration is needed.
 * Served by /cgi-bin/quecmanager/network/data_used.sh
 */
export interface DataUsedBlock {
  /** Cumulative received bytes (download), persisted across reboots */
  accumulated_rx_bytes: number;
  /** Cumulative transmitted bytes (upload), persisted across reboots */
  accumulated_tx_bytes: number;
  /** Counter source — the kernel interface name (e.g. "rmnet_ipa0"). */
  selected_counter: string;
  /** Unix epoch (seconds) of the last poller write to this block */
  last_update_ts: number;
  /**
   * Unix epoch (seconds) of the last user-triggered reset.
   * 0 means never reset (fresh install).
   */
  last_reset_ts: number;
  /**
   * Times the kernel interface counter reset (modem reboot / interface
   * re-creation) since the last user reset. Each reset rebases the
   * baseline without accumulating the in-flight bytes.
   */
  modem_reset_count: number;
  /**
   * True when the poller has not updated this block recently (cache is
   * stale). CGI sets this when the on-disk file is older than expected.
   */
  stale: boolean;
}

// --- Utility Types -----------------------------------------------------------

/**
 * Serving-cell / per-carrier metrics. The per-antenna arrays use `SignalMetric`
 * below instead — that set has no RSSI, because AT+QRSRP/QRSRQ/QSINR report
 * none.
 */
export type ServingMetric = "rsrp" | "rsrq" | "sinr" | "rssi";

/**
 * The 3GPP REPORTED range for each metric — the interval a real measurement can
 * physically fall in. Anything outside it is not a bad reading, it is not a
 * reading: an unavailable marker, a raw field in the wrong unit, or a parse
 * that grabbed the wrong CSV column.
 *
 * WHY THIS EXISTS. `AT+QCAINFO`'s LTE line reports RSSNR in field 10 as a RAW
 * value, while `AT+QENG="servingcell"` reports the same measurement in dB. The
 * poller's NR branch rescales and rejects `-32768`; its LTE branch
 * (`parse_at.sh:632`) takes the field verbatim. Live capture, one poll, one
 * cell (B28 / EARFCN 9485 / PCI 407): `lte.sinr` = 8 while
 * `carrier_components[0].sinr` = 251. RSRP and RSRQ agreed across the two
 * sources to within 1; only SINR diverged — and 251 is outside RSSNR's reported
 * range entirely, so it is not a scaled 8 either.
 *
 * That alone was survivable. What made it dangerous is that the ladder below
 * used to have no CEILING: `value >= thresholds.excellent` scored 251 dB
 * "excellent", so the page painted a full green bar and an Excellent chip next
 * to a genuinely poor -115 dBm RSRP. On the surface a technician opens to
 * diagnose exactly that, a fabricated healthy verdict is the worst available
 * failure mode — strictly worse than showing nothing.
 *
 * Ranges are the reported ranges, not the comfortable ones: RSRP spans NR's
 * extended -156…-31 because an NR carrier is read through the same path.
 */
export const METRIC_RANGES: Record<ServingMetric, { min: number; max: number }> = {
  rsrp: { min: -156, max: -31 }, // 36.133 / 38.133 RSRP reporting range
  rsrq: { min: -43, max: 20 },   // 36.133 extended RSRQ range
  sinr: { min: -23, max: 40 },   // 36.133 RS-SINR reporting range
  rssi: { min: -120, max: -25 },
};

/**
 * The single read boundary for a serving-cell / per-carrier value, and the
 * sibling of `normalizeSignalValue()` below (which does the same job for the
 * per-antenna arrays, against a sentinel SET rather than a range).
 *
 * Returns `null` for anything outside the physical range, so the value, its
 * bar and its quality verdict all resolve through the one already-correct
 * "not reported" path instead of disagreeing with each other.
 */
export function normalizeMetricValue(
  value: number | null | undefined,
  metric: ServingMetric
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const { min, max } = METRIC_RANGES[metric];
  return value < min || value > max ? null : value;
}

/**
 * Signal quality thresholds for UI indicators.
 *
 * Every named member except `floor` is a CUT: the lowest value that still
 * earns that level. `floor` is not a cut — it is the bottom of the 0–100
 * scale `signalToProgress()` maps into, and no value is ever classified by
 * comparing against it.
 *
 * That distinction used to be invisible: the field now called `floor` was
 * called `poor`, while `getSignalQuality()` never read it at all — `poor` was
 * the fallthrough return. Adding a real `poor` cut beside a `poor` floor would
 * have left two different meanings sharing one name, so the floor was renamed
 * first. Keep them distinct if you add a metric.
 */
export interface SignalThresholds {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
  /** Bottom of the progress scale — NOT a classification cut. See above. */
  floor: number;
  /** Physical range for this metric — see METRIC_RANGES. */
  range: { min: number; max: number };
}

/**
 * RSRP thresholds (dBm) — higher (less negative) is better.
 *
 * The `poor` cut at −120 is a product call, not a measurement: −110 to −120 is
 * cell edge, a weak link that aiming, a band lock or a different antenna can
 * plausibly recover. Below −120 the cell is effectively not being received and
 * the honest message is "not this cell", not "try a bit harder". That is the
 * distinction the alignment meter exists to draw, and it could not draw it
 * while everything under −110 shared one bucket.
 */
export const RSRP_THRESHOLDS: SignalThresholds = {
  excellent: -80,
  good: -100,
  fair: -110,
  poor: -120,
  floor: -140,
  range: METRIC_RANGES.rsrp,
};

/** RSRQ thresholds (dB) — higher (less negative) is better */
export const RSRQ_THRESHOLDS: SignalThresholds = {
  excellent: -5,
  good: -10,
  fair: -15,
  poor: -18,
  floor: -20,
  range: METRIC_RANGES.rsrq,
};

/** SINR thresholds (dB) — higher is better */
export const SINR_THRESHOLDS: SignalThresholds = {
  excellent: 20,
  good: 13,
  fair: 0,
  poor: -10,
  floor: -20,
  range: METRIC_RANGES.sinr,
};

/**
 * Categorizes a signal value into a quality level based on thresholds.
 * Works for any metric where higher = better.
 *
 * The range check is deliberately INSIDE this function rather than left to
 * every caller. Carrying the range on the thresholds object means the twelve
 * existing call sites are covered without touching any of them, and a future
 * surface cannot opt out of it by forgetting to normalize first — which is the
 * exact way the per-antenna sentinel policy fragmented before
 * `normalizeSignalValue()` centralized it.
 */
export function getSignalQuality(
  value: number | null,
  thresholds: SignalThresholds
): "excellent" | "good" | "fair" | "poor" | "bad" | "none" {
  if (value === null || value === undefined || !Number.isFinite(value)) return "none";
  // Out of physical range is "we have no reading", never the top of the ladder.
  if (value < thresholds.range.min || value > thresholds.range.max) return "none";
  if (value >= thresholds.excellent) return "excellent";
  if (value >= thresholds.good) return "good";
  if (value >= thresholds.fair) return "fair";
  if (value >= thresholds.poor) return "poor";
  return "bad";
}

export type SignalQuality = ReturnType<typeof getSignalQuality>;

const SIGNAL_QUALITY_RANK: Record<SignalQuality, number> = {
  excellent: 5,
  good: 4,
  fair: 3,
  poor: 2,
  bad: 1,
  none: 0,
};

/**
 * Returns the worst quality across the supplied metrics. "none" entries
 * (missing/null values) are skipped; if every input is "none", returns "none".
 * Used by the public overview "Overall" verdict so a strong RSRP can't mask
 * a poor SINR.
 */
export function worstSignalQuality(...qualities: SignalQuality[]): SignalQuality {
  const known = qualities.filter((q): q is Exclude<SignalQuality, "none"> => q !== "none");
  if (known.length === 0) return "none";
  return known.reduce<SignalQuality>(
    (worst, q) => (SIGNAL_QUALITY_RANK[q] < SIGNAL_QUALITY_RANK[worst] ? q : worst),
    known[0],
  );
}

/** Daemon's authoritative tri-state connectivity outcome (from qmanager_ping.json's `connectivity` field).
    Post ICMP-port there is no "limited" (carrier-intercept) outcome — an ICMP ping either answers or it doesn't. */
export type PingTriState = "connected" | "disconnected" | "unknown";

/** User-selectable preset for high_latency / high_packet_loss event thresholds. */
export type QualityPreset = "standard" | "tolerant" | "very-tolerant";

/** Display-order list of quality presets. */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  "standard",
  "tolerant",
  "very-tolerant",
] as const;

/** Persisted shape of /etc/qmanager/quality_thresholds.json (also the GET response settings field). */
export interface QualityThresholdsSettings {
  latency: { preset: QualityPreset };
  loss: { preset: QualityPreset };
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
  /** Phase 2 — daemon's tri-state connectivity outcome. null means the field is missing
      from status.json (rolling-upgrade fallback). */
  state: PingTriState | null;
  /** Address family of the daemon's most recent successful probe. "ipv6" means the IPv4
      leg failed and the fallback carried the connection. "none" when nothing answered.
      null on a poller that predates the ICMP port (rolling-upgrade fallback). */
  last_family: "ipv4" | "ipv6" | "none" | null;
  /** Legacy HTTP-probe field. Always null post ICMP-port (kept typed for rolling-upgrade
      safety so a status.json emitted by an older poller still parses). */
  limited_reason: number | null;
  /** When state == "disconnected", the failure reason: "timeout" | "refused"
      | "reset" | "dns" | "malformed". null otherwise. */
  down_reason: string | null;
  /** Legacy HTTP-probe field. Always 0 post ICMP-port (kept typed for rolling-upgrade
      safety so a status.json emitted by an older poller still parses). */
  streak_limited: number;
  /** Daemon's runtime profile string. A named preset, "custom" (env-var override),
      or "unknown" (daemon dead/stale). Typed as string to admit all three. */
  profile: string;
  /** Runtime fail-threshold in seconds (active in the daemon). 0 if daemon dead/stale. */
  fail_secs: number;
  /** Runtime recover-threshold in seconds. 0 if daemon dead/stale. */
  recover_secs: number;
  /** Runtime intercept-threshold in seconds. 0 if daemon dead/stale. */
  intercept_secs: number;
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
 *
 * A `null` entry means the poller recognised an inactive port. It does NOT mean
 * every inactive port arrives as null — the poller only translates `-32768`, and
 * the modem has two other ways of saying "not measured" that arrive as plain
 * numbers. Read every value through `normalizeSignalValue()` rather than testing
 * it against null directly; see SIGNAL_SENTINELS below.
 */
export interface SignalPerAntenna {
  lte_rsrp: (number | null)[];
  lte_rsrq: (number | null)[];
  lte_sinr: (number | null)[];
  nr_rsrp: (number | null)[];
  nr_rsrq: (number | null)[];
  nr_sinr: (number | null)[];
}

/** The three per-antenna metrics, used to select a sentinel set. */
export type SignalMetric = "rsrp" | "rsrq" | "sinr";

/**
 * Values that mean "this port did not measure anything", per metric.
 *
 * These are NOT thresholds and they are NOT interchangeable across metrics — the
 * set is deliberately different for each one, because the hazard is that a
 * sentinel sits exactly on that metric's `poor` floor. `getSignalQuality()` then
 * scores it "poor" and `signalToProgress()` returns 0, so an unused antenna
 * renders as a legible, plausible, wrong reading — an empty red bar labelled
 * "-140 dBm" — which is worse than a blank, because it looks like a signal
 * problem the user should go and fix.
 *
 * Verified against 117 live samples on RM520NGLAAR03A03M4G_A0.303:
 *
 * - `-32768` is the documented sentinel and is handled by the poller
 *   (`parse_at.sh:20-23`). It occurred ZERO times. It stays here for firmware
 *   that does emit it, but it is not the case that bites.
 * - `-140` (RSRP) is the 3GPP floor, and it lands in the same sample and the
 *   same port index as `null` in that port's RSRQ and SINR — the modem saying
 *   "port off" three ways at once, of which the poller understands one.
 * - `-20` (SINR) appears WITHOUT a corroborating null, so it is the only signal
 *   available that an NR chain is idle. A genuine -20 dB SINR is unusable by
 *   definition (it is the bottom of the scale), so suppressing the real value
 *   costs nothing a user could act on.
 * - `-20` is NOT a sentinel for RSRQ even though it is RSRQ's `poor` floor: the
 *   same capture contains a legitimate `-19` dB RSRQ, so that region of the
 *   range is genuinely reachable by real data. Only `-32768` is suppressed there.
 */
const SIGNAL_SENTINELS: Record<SignalMetric, ReadonlySet<number>> = {
  rsrp: new Set([-140, -32768]),
  rsrq: new Set([-32768]),
  sinr: new Set([-20, -32768]),
};

/**
 * The single read boundary for a per-antenna value. Returns `null` for anything
 * the radio did not actually measure, so downstream quality, progress and
 * "is this port live" logic all agree.
 *
 * Every per-antenna surface goes through this. Two pages reading one field
 * through two different sentinel policies is what let antenna-statistics call a
 * dead chain "poor" while antenna-alignment called the same chain "—".
 */
export function normalizeSignalValue(
  value: number | null | undefined,
  metric: SignalMetric
): number | null {
  if (value === null || value === undefined) return null;
  return SIGNAL_SENTINELS[metric].has(value) ? null : value;
}

/**
 * Whether a given antenna port is reporting anything at all for one radio.
 *
 * Port liveness has to be asked per RAT, not per port: in EN-DC a chain can be
 * carrying LTE while reporting nothing for NR, and the answer "is MIMO 3 live?"
 * is then genuinely different for each leg.
 */
export function isPortReporting(
  signal: SignalPerAntenna | undefined,
  index: number,
  prefix: "lte" | "nr"
): boolean {
  if (!signal) return false;
  return (
    normalizeSignalValue(signal[`${prefix}_rsrp`][index], "rsrp") !== null ||
    normalizeSignalValue(signal[`${prefix}_rsrq`][index], "rsrq") !== null ||
    normalizeSignalValue(signal[`${prefix}_sinr`][index], "sinr") !== null
  );
}

/** Whether a radio has any reporting port at all. */
export function hasAntennaData(
  signal: SignalPerAntenna | undefined,
  prefix: "lte" | "nr"
): boolean {
  if (!signal) return false;
  return ANTENNA_PORTS.some((_, i) => isPortReporting(signal, i, prefix));
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
  | "airplane_mode"       // Airplane mode enabled/disabled (CFUN changed)
  | "profile_applied"     // Custom SIM Profile applied (complete or partial)
  | "profile_failed"      // Custom SIM Profile apply failed (all steps)
  | "profile_deactivated" // Custom SIM Profile deactivated by user
  | "tower_failover";     // Tower lock failover activated (signal below threshold)

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
 * Formats bits per second into a human-readable string.
 * Takes raw bits per second directly (e.g., from WebSocket bandwidth data).
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
  // Defense in depth — a negative value would slip through every magnitude
  // branch below and render as raw "-12345 B". Clamp to 0 so any future
  // counter wrap (or fresh post-reset state) renders cleanly. See the
  // BusyBox-sh overflow fix in qmanager_poller for the original case that
  // produced negatives in v0.1.9.
  if (bytes < 0) return "0 B";
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
 *
 * NOTE: TA=0 is treated as "no data" rather than "zero distance". The modem
 * reports 0 both when the radio isn't connected (e.g., no 5G link) and when
 * TA reporting is unavailable — a genuine TA of 0 is physically meaningless
 * at any real-world cell distance, so null is the correct signal for the UI.
 *
 * @param ta - LTE TA index (0–1282)
 * @returns distance in km, or null if TA is unavailable/invalid/zero
 */
export function calculateLteDistance(ta: number | null): number | null {
  if (ta === null || ta === undefined || ta <= 0 || ta > 1282) return null;
  const NTA = 16 * ta;
  const TS = 1 / 30720000; // 1/(2048×15000)
  const SPEED_OF_LIGHT = 3e8;
  return (SPEED_OF_LIGHT * NTA * TS) / 2 / 1000;
}

/**
 * Calculates NR cell distance from NTA value.
 * Based on 3GPP TS 38.213: TC = 1/(480×10³×4096).
 * Distance = (c × NTA × TC) / 2.
 *
 * NOTE: NTA=0 is treated as "no data" — see calculateLteDistance for rationale.
 * This is especially important for NR: when there's no 5G connection at all,
 * the modem still reports nr_ta=0 (stale initial value).
 *
 * @param nta - NR NTA value (already NTA, not TA index)
 * @returns distance in km, or null if NTA is unavailable/invalid/zero
 */
export function calculateNrDistance(nta: number | null): number | null {
  if (nta === null || nta === undefined || nta <= 0) return null;
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
  // Map from [floor, excellent] → [0, 100]. `floor`, never `poor`: `poor` is a
  // classification cut partway up the ladder, and scaling from it would report
  // 0% for every reading at or below cell edge.
  const range = thresholds.excellent - thresholds.floor;
  if (range === 0) return 50;
  const pct = ((value - thresholds.floor) / range) * 100;
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

// =============================================================================
// cellular-settings.ts — QManager Cellular Basic Settings Types
// =============================================================================
// TypeScript interfaces for the Cellular Basic Settings feature.
//
// Backend contract:
//   GET/POST /cgi-bin/quecmanager/cellular/settings.sh
// =============================================================================

// --- Field Value Unions ------------------------------------------------------
// Every literal the CGI's `case` validators accept, and nothing more. These are
// the single source of truth for both the option lists the UI renders and the
// payload the hook POSTs — a value that does not appear here fails the build.

/** Active SIM slot (AT+QUIMSLOT). */
export type SimSlot = 1 | 2;

/**
 * Radio functionality level (AT+CFUN).
 * 0 = radio off and SIM deselected, 1 = normal, 4 = airplane (SIM stays powered).
 */
export type CfunMode = 0 | 1 | 4;

/**
 * Network mode preference (AT+QNWPREFCFG="mode_pref").
 * Colon-joined values are multi-RAT selections — `"LTE:NR5G"` is a common,
 * fully supported setting, not a degenerate form of `"AUTO"`.
 */
export type ModePref =
  | "AUTO"
  | "LTE"
  | "NR5G"
  | "LTE:NR5G"
  | "WCDMA"
  | "LTE:WCDMA"
  | "NR5G:LTE:WCDMA";

/**
 * NR5G access mode (AT+QNWPREFCFG="nr5g_disable_mode").
 * 0 = auto (NSA + SA), 1 = NSA only (SA disabled), 2 = SA only (NSA disabled).
 */
export type Nr5gMode = 0 | 1 | 2;

/**
 * Roaming preference (AT+QNWPREFCFG="roam_pref").
 * 255 = any network, 1 = home only, 3 = partner/affiliate.
 */
export type RoamPref = 255 | 1 | 3;

/** SIM hot-swap detection (AT+QSIMDET enable flag). 0 = off, 1 = on. */
export type SimDetect = 0 | 1;

// --- Settings ----------------------------------------------------------------

/** Current cellular settings read from the modem */
export interface CellularSettings {
  /** Active SIM slot (1 or 2) */
  sim_slot: SimSlot;
  /** CFUN mode: 0=radio off, 1=full, 4=airplane */
  cfun: CfunMode;
  /** Network mode preference: "AUTO", "LTE", "NR5G", "LTE:NR5G", … */
  mode_pref: ModePref;
  /** NR5G access mode: 0=auto, 1=NSA only, 2=SA only */
  nr5g_mode: Nr5gMode;
  /** Roaming preference: 1=home only, 3=affiliate, 255=any network */
  roam_pref: RoamPref;
  /** SIM hot-swap detection enable flag (writable) */
  sim_detect: SimDetect;
  /**
   * SIM-detect trigger level from AT+QSIMDET (0 = low, 1 = high).
   * Read-only in this change — reported by the backend, never written by the UI,
   * and therefore deliberately absent from {@link WRITABLE_SETTING_KEYS}.
   */
  sim_detect_level: number;
}

/**
 * The fields the UI is allowed to write. `sim_detect_level` is intentionally
 * excluded: it is display-only, so it can never enter the dirty set or a POST
 * payload.
 */
export const WRITABLE_SETTING_KEYS = [
  "sim_slot",
  "cfun",
  "mode_pref",
  "nr5g_mode",
  "roam_pref",
  "sim_detect",
] as const;

/** Key of a writable cellular setting. */
export type WritableSettingKey = (typeof WRITABLE_SETTING_KEYS)[number];

/** The writable subset of {@link CellularSettings}. */
export type WritableCellularSettings = Pick<
  CellularSettings,
  WritableSettingKey
>;

/** A set of pending, not-yet-saved edits keyed by writable field. */
export type CellularSettingsPatch = Partial<WritableCellularSettings>;

/** Narrowing guard for field names arriving from the backend as bare strings. */
export function isWritableSettingKey(key: string): key is WritableSettingKey {
  return (WRITABLE_SETTING_KEYS as readonly string[]).includes(key);
}

// --- AMBR Data ---------------------------------------------------------------

/** LTE AMBR entry (one per APN) */
export interface LteAmbrEntry {
  /** APN name */
  apn: string;
  /** Downlink AMBR in Kbps */
  dl_kbps: number;
  /** Uplink AMBR in Kbps */
  ul_kbps: number;
}

/** NR5G AMBR entry (one per DNN) */
export interface Nr5gAmbrEntry {
  /** DNN (Data Network Name) */
  dnn: string;
  /** Downlink AMBR in Kbps (already converted from unit*session) */
  dl_kbps: number;
  /** Uplink AMBR in Kbps (already converted from unit*session) */
  ul_kbps: number;
}

/** Combined AMBR data */
export interface AmbrData {
  lte: LteAmbrEntry[];
  nr5g: Nr5gAmbrEntry[];
}

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/cellular/settings.sh */
export interface CellularSettingsResponse {
  success: boolean;
  settings: CellularSettings;
  ambr: AmbrData;
  error?: string;
}

/** Response from POST /cgi-bin/quecmanager/cellular/settings.sh */
export interface CellularSettingsApplyResponse {
  success: boolean;
  error?: string;
  /** Fields that failed to apply (only on partial failure) */
  failed_fields?: string[];
  /** Fields that were successfully applied */
  applied_fields?: string[];
}

/**
 * Normalised outcome of one apply, with the backend's loose `string[]` field
 * lists narrowed to real setting keys. A save bar that reported "3 changes
 * pending" reports partial outcomes from this: which of the three landed, and
 * which are still dirty.
 */
export interface CellularSettingsApplyResult {
  /** True only when every attempted field applied. */
  success: boolean;
  /** Fields the modem accepted — cleared from the dirty set. */
  appliedFields: WritableSettingKey[];
  /** Fields the modem rejected — kept dirty so the user can retry or discard. */
  failedFields: WritableSettingKey[];
  /** Error text from the backend or transport, null on full success. */
  error: string | null;
}

// --- Display Helpers ---------------------------------------------------------

/**
 * Format Kbps to human-readable string.
 * Examples: 500 -> "500 Kbps", 150000 -> "150 Mbps", 2008640 -> "2.01 Gbps"
 */
export function formatBitrate(kbps: number): string {
  if (kbps >= 1000000) {
    return `${(kbps / 1000000).toFixed(2)} Gbps`;
  }
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(0)} Mbps`;
  }
  return `${kbps} Kbps`;
}

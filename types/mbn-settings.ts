// =============================================================================
// mbn-settings.ts — MBN Configuration Types
// =============================================================================
// TypeScript interfaces for the MBN Configuration CGI endpoint.
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/mbn.sh
// =============================================================================

/** A single MBN profile entry from AT+QMBNCFG="list" */
export interface MbnProfile {
  /** Profile index (0-31) */
  index: number;
  /** Whether this profile is currently selected */
  selected: boolean;
  /** Whether this profile is currently activated */
  activated: boolean;
  /** Profile name (e.g. "ROW_Commercial", "Commercial-TMO") */
  name: string;
  /** Version hex string (metadata) */
  version: string;
  /** Date string (metadata) */
  date: string;
}

/** Response from GET /cgi-bin/quecmanager/cellular/mbn.sh */
export interface MbnSettingsResponse {
  success: boolean;
  /** Current auto-select status: 1 = enabled, 0 = disabled */
  auto_sel: number;
  /** All available MBN profiles */
  profiles: MbnProfile[];
  error?: string;
}

/** POST body for /cgi-bin/quecmanager/cellular/mbn.sh */
export interface MbnSaveRequest {
  /** "apply_profile" to select a profile, "auto_sel" to toggle, "reboot" to restart */
  action: "apply_profile" | "auto_sel" | "reboot";
  /** Profile name — required when action is "apply_profile" */
  profile_name?: string;
  /** Auto-select value — required when action is "auto_sel" (0 or 1) */
  auto_sel?: number;
}

/** Response from POST /cgi-bin/quecmanager/cellular/mbn.sh */
export interface MbnSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
  /** Whether a reboot is required for changes to take effect */
  reboot_required?: boolean;
}

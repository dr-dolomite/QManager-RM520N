// =============================================================================
// sim-profile.ts — QManager Custom SIM Profile Types
// =============================================================================
// TypeScript interfaces for the SIM Profile CRUD, apply lifecycle, and
// current modem settings query.
//
// Backend contract:
//   Profile storage: /etc/qmanager/profiles/<id>.json
//   Apply state:     /tmp/qmanager_profile_state.json
//   Active profile:  /etc/qmanager/active_profile
//
// See: CUSTOM_SIM_PROFILE_ARCHITECTURE_v2.md
// =============================================================================

// --- Profile Data Model ------------------------------------------------------

/** A saved SIM profile with all modem/system settings */
export interface SimProfile {
  /** Unique ID: p_<unix_ts>_<3-char-hex> */
  id: string;
  /** User-defined profile name */
  name: string;
  /** Mobile Network Operator name (informational) */
  mno: string;
  /** SIM ICCID this profile was created for (informational, not enforced) */
  sim_iccid: string;
  /** Unix epoch (seconds) — when profile was first created */
  created_at: number;
  /** Unix epoch (seconds) — last update time */
  updated_at: number;
  /** All configurable modem/system settings */
  settings: ProfileSettings;
  /**
   * Connection-scenario binding. Always present — the backend normalizes a
   * read-time default ({@link DEFAULT_SCENARIO_BINDING}) onto legacy profiles.
   */
  scenario: ProfileScenarioBinding;
}

// --- Scenario Binding & Schedule ---------------------------------------------

/** 0=Sun … 6=Sat (matches JS Date.getDay() and the device cron). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One scheduled time window that maps to a connection scenario. */
export interface ScenarioScheduleBlock {
  /** "HH:MM" 24h. Inclusive. */
  start: string;
  /** "HH:MM" 24h. Exclusive. end <= start means the window wraps past midnight. */
  end: string;
  /**
   * Days this block is active (0=Sun … 6=Sat). Empty = block inert.
   *
   * Optional in the type because the editor no longer exposes per-day
   * scheduling: it always writes all seven days ([0,1,2,3,4,5,6]) so a block is
   * simply "this time window, every day". The field is retained on the wire for
   * backend-resolver compatibility — `scenario_mgr.sh::scenario_block_for_now`
   * and `lib/scenario-schedule.ts` both still filter on `days`, and
   * `validateSchedule` still rejects an empty-days block. Legacy profiles that
   * carry a narrower day set keep resolving correctly; only the editor's input
   * surface changed.
   */
  days?: DayOfWeek[];
  /** Scenario id to apply during this window. */
  scenario: string;
  /**
   * Client-only React key; never persisted. Seeded in the form so list
   * reorder/delete keep stable identity, and stripped before save so the
   * device JSON stays byte-clean.
   */
  _key?: string;
}

/** Optional time-of-day schedule overlaid on the profile's default scenario. */
export interface ScenarioSchedule {
  enabled: boolean;
  blocks: ScenarioScheduleBlock[];
}

/**
 * Binds a profile to a connection scenario + optional schedule.
 * `default` is BOTH the on-activate scenario AND the schedule fallback
 * ("all other times"). The backend normalizes this onto every profile at read
 * time, so it is always present on profiles returned by list.sh / get.sh.
 */
export interface ProfileScenarioBinding {
  /** On-activate scenario AND schedule fallback. */
  default: string;
  schedule: ScenarioSchedule;
}

/** Read-time default the backend injects for legacy profiles. */
export const DEFAULT_SCENARIO_BINDING: ProfileScenarioBinding = {
  default: "balanced",
  schedule: { enabled: false, blocks: [] },
};

/** The configurable settings bundle within a profile */
export interface ProfileSettings {
  /** APN configuration */
  apn: ApnSettings;
  /** Preferred IMEI (15 digits). Empty string = don't change. */
  imei: string;
  /** IPv4 TTL value (0-255). 0 = don't set. */
  ttl: number;
  /** IPv6 Hop Limit value (0-255). 0 = don't set. */
  hl: number;
  /**
   * Connection Scenario ID this profile binds to. When set, applying the
   * profile also activates this scenario (network mode + band locks), and the
   * standalone Scenarios / Band Locking pages are gated while the profile is
   * active. Empty string or null = profile does not manage radio config.
   *
   * Valid values: "" | "balanced" | "gaming" | "streaming" | "custom-<ts>"
   *
   * Kept for compat — mirrors `scenario.default` server-side (single
   * chokepoint in profile_save()). Prefer reading `scenario.default` /
   * `scenario.schedule` on the top-level profile for new code.
   */
  scenario_id: string | null;
}

/** APN connection settings */
export interface ApnSettings {
  /** PDP context ID (1-15), defaults to 1 for primary data */
  cid: number;
  /** APN name, e.g. "internet" */
  name: string;
  /** PDP type */
  pdp_type: PdpType;
}

export type PdpType = "IP" | "IPV6" | "IPV4V6";

// --- Profile List Response ---------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/profiles/list.sh */
export interface ProfileListResponse {
  /** Array of profile summaries */
  profiles: ProfileSummary[];
  /** Currently active profile ID, or null if none */
  active_profile_id: string | null;
}

/** Profile summary (subset of full profile, used in list view) */
export interface ProfileSummary {
  id: string;
  name: string;
  mno: string;
  sim_iccid: string;
  created_at: number;
  updated_at: number;
  /**
   * Scenario binding — included on every summary by profiles/list.sh (the
   * backend `profile_list` injects a normalized block). Drives the
   * locked-while-scheduled UI off the active profile.
   */
  scenario: ProfileScenarioBinding;
}

// --- Profile Apply Lifecycle -------------------------------------------------

/** State of a profile application in progress */
export interface ProfileApplyState {
  /** Current apply status */
  status: ApplyStatus;
  /** Profile being applied */
  profile_id: string;
  /** Profile name (for display) */
  profile_name: string;
  /** Unix epoch when apply started */
  started_at: number;
  /** Current step number (1-indexed) */
  current_step: number;
  /** Total number of steps */
  total_steps: number;
  /** Per-step status details */
  steps: ApplyStep[];
  /** Whether the modem needs a reboot (IMEI change) */
  requires_reboot: boolean;
  /** Error message if status is "failed" */
  error: string | null;
}

export type ApplyStatus = "idle" | "applying" | "complete" | "partial" | "failed";

/** Status of a single step in the apply sequence */
export interface ApplyStep {
  /** Step name: apn, network_mode, lte_bands, nsa_nr_bands, sa_nr_bands, ttl_hl, imei */
  name: string;
  /** Current step status */
  status: ApplyStepStatus;
  /** Human-readable detail or progress message */
  detail: string;
}

export type ApplyStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

// --- Current Modem Settings (for form pre-fill) ------------------------------

/** Response from GET /cgi-bin/quecmanager/profiles/current_settings.sh */
export interface CurrentModemSettings {
  /** All configured APN/CID pairs from AT+CGDCONT? */
  apn_profiles: CurrentApnProfile[];
  /** Current IMEI from AT+CGSN */
  imei: string;
  /** Current SIM ICCID from AT+QCCID */
  iccid: string;
  /** Active data CID (detected via QMAP/CGPADDR cross-reference) */
  active_cid: number;
}

/** A single APN/CID pair from AT+CGDCONT? */
export interface CurrentApnProfile {
  /** PDP context ID */
  cid: number;
  /** PDP type (IP, IPV6, IPV4V6) */
  pdp_type: string;
  /** APN name */
  apn: string;
}

// --- API Response Types ------------------------------------------------------

/** Generic success response from save/delete operations */
export interface ProfileApiResponse {
  success: boolean;
  /** Profile ID (present on success) */
  id?: string;
  /** Error code (present on failure) */
  error?: string;
  /** Human-readable error detail */
  detail?: string;
}

// --- Display Helpers ---------------------------------------------------------

/** Human-readable labels for PDP types */
export const PDP_TYPE_LABELS: Record<PdpType, string> = {
  IP: "IPv4 Only",
  IPV6: "IPv6 Only",
  IPV4V6: "IPv4 + IPv6 (Dual Stack)",
};

/** Human-readable labels for apply step statuses */
export const APPLY_STEP_STATUS_LABELS: Record<ApplyStepStatus, string> = {
  pending: "Pending",
  running: "In Progress",
  done: "Complete",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * Formats a Unix timestamp into a locale-appropriate date string.
 */
export function formatProfileDate(timestamp: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

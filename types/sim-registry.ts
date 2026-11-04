// =============================================================================
// SIM Registry — the persistent record of every SIM QManager has seen.
// =============================================================================
// Backed by `system/sim_registry.sh`. The registry is the single source of
// truth for "have we alerted about this SIM yet": the poller's `sim_swap`
// block in status.json derives `detected` from it, so dismissing a SIM here
// silences the banner, and un-dismissing genuinely brings it back.
// =============================================================================

/** One remembered SIM, as returned by `GET system/sim_registry.sh`. */
export interface SimRegistryEntry {
  /**
   * The SIM's identity, exactly as the backend stores it: normalized by
   * `sim_db_normalize` (space/CR/LF stripped only), so it is byte-identical to
   * the SIM's line in `known_iccids`. A trailing BCD pad `F` is **kept** — do
   * not strip it before POSTing back, or the device answers 404.
   */
  iccid: string;
  /** Network/operator name recorded when the SIM was first seen. */
  carrier: string;
  /**
   * MSISDN. **Empty string when the carrier never provisioned one** — common
   * on prepaid and M2M SIMs. Render an explicit "not provisioned" state, never
   * a blank value.
   */
  phone_number: string;
  /**
   * ISO-8601 UTC timestamp of first sighting, or `null` for records backfilled
   * from a device that predates the registry. Never fabricate a date for null.
   */
  first_seen: string | null;
  /** True when the new-SIM alert has been silenced for this SIM. */
  dismissed: boolean;
  /** True for the SIM currently in the modem. The backend sorts active first. */
  active: boolean;
}

/** Envelope returned by both the GET and the dismiss/undismiss POSTs. */
export interface SimRegistryResponse {
  success: boolean;
  sims?: SimRegistryEntry[];
  dismissed?: boolean;
  error?: string;
  detail?: string;
}

/** POST actions the registry endpoint accepts. */
export type SimRegistryAction = "dismiss" | "undismiss";

// =============================================================================
// apn-settings.ts — QManager APN Settings Types  (single-APN model)
// =============================================================================
// TypeScript interfaces for the single-APN model. The backend stores one
// APN setting (apn + pdp_type + cid) and the modem's live PDP contexts are
// surfaced separately so the CID picker can badge and confirm IMS/SOS slots.
//
// Backend contract:
//   CGI endpoint: /cgi-bin/quecmanager/cellular/apn.sh
//
//   GET  returns active, active_cid, internet_cid, apn (stored setting), cids[]
//   POST save:       { action:"save", apn, pdp_type, cid } → writes + COPS cycle
//   POST deactivate: { action:"deactivate" }               → carrier default, active=0
// =============================================================================

// --- Core Types --------------------------------------------------------------

/** Carrier classification of a modem PDP context. */
export type ApnType = "" | "ims" | "emergency";

/** The single stored APN setting. */
export interface ApnSetting {
  /** Access Point Name. */
  apn: string;
  /** PDP context type: ipv4, ipv6, ipv4v6. */
  pdp_type: string;
  /** Target modem PDP context (1-6). */
  cid: number;
}

/** A live modem PDP context — drives the CID picker badges and confirmation. */
export interface CidContext {
  /** PDP context id (1-6). */
  cid: number;
  /** Live APN string on this context ("" if undefined on the modem). */
  apn: string;
  /** Carrier classification: "" data, "ims" VoLTE, "emergency" SOS. */
  apn_type: ApnType;
  /** Whether this CID currently bears the WAN (the live Internet context). */
  is_internet: boolean;
}

// --- API Response Types ------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/cellular/apn.sh */
export interface ApnSettingsResponse {
  success: boolean;
  /** 1 = custom APN is live, 0 = carrier default. */
  active: number;
  /** The live WAN-bearing CID. */
  active_cid: number;
  /** The CID the ISP uses for data (== active_cid). */
  internet_cid: number;
  /** The stored single APN setting. Pre-fills the form even when active===0. */
  apn: ApnSetting;
  /** The modem's live PDP contexts (1-6), each tagged for the CID picker. */
  cids: CidContext[];
  error?: string;
}

/** Response from POST save / deactivate operations. */
export interface ApnSaveResponse {
  success: boolean;
  active?: number;
  error?: string;
}

/**
 * What a write to this endpoint actually resolved to.
 *
 * A BOOLEAN CANNOT CARRY THE THIRD CASE, which is why this type exists. Every
 * write here runs a full attach cycle (`AT+COPS=2` … `AT+COPS=0`), and on this
 * hardware that drops the `eth0` link for about four seconds — so a CGI that
 * brackets the cycle inline finishes its work and then loses its HTTP response
 * on the way back. The fetch rejects at the transport layer for a write that
 * LANDED. Reporting that as `false` made the card toast "Failed to save APN
 * settings" over a successful save, which is the one thing this surface must
 * never do.
 *
 *   "saved"        the modem answered, and it answered yes
 *   "reconciling"  no answer came back. The write probably landed; the delayed
 *                  re-read is what will say. Not an error, and not a success
 *                  to announce either
 *   "failed"       the modem answered, and it answered no (or HTTP said no)
 */
export type ApnSaveOutcome = "saved" | "reconciling" | "failed";

// --- API Request Types -------------------------------------------------------

/** Request body for saving the APN configuration. */
export interface ApnSaveRequest {
  /** Access Point Name. */
  apn: string;
  /** PDP context type: ipv4, ipv6, ipv4v6. */
  pdp_type: string;
  /** Target modem PDP context (1-6). */
  cid: number;
}

// --- Display Helpers ---------------------------------------------------------

/** PDP type display options */
export const PDP_TYPE_OPTIONS = [
  { value: "ipv4", label: "IPv4" },
  { value: "ipv6", label: "IPv6" },
  { value: "ipv4v6", label: "IPv4v6" },
] as const;

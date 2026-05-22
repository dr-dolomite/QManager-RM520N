// =============================================================================
// custom-dns.ts — QManager Custom DNS Settings Types
// =============================================================================
// TypeScript interfaces for the Custom DNS feature.
//
// Backend contract:
//   GET/POST /cgi-bin/quecmanager/network/custom_dns.sh
//
// Backend writes a sentinel-delimited block into /etc/data/dnsmasq.conf and
// reloads dnsmasq via SIGHUP. The runtime DNS proxy is gated by <DNSMode>
// in /etc/data/mobileap_cfg.xml — when not "PROXY", the feature is unavailable.
// =============================================================================

/** Source of the live upstream resolvers dnsmasq is currently forwarding to. */
export type CustomDnsCurrentSource = "custom" | "carrier" | "unknown";

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/network/custom_dns.sh */
export interface CustomDnsSettingsResponse {
  /** True when QManager's sentinel block is active in /etc/data/dnsmasq.conf */
  enabled: boolean;
  /** True when `no-resolv` is set inside the QManager block */
  ignoreCarrier: boolean;
  /** User-configured upstream resolvers (max 4) */
  servers: string[];
  /** Value of <DNSMode> from /etc/data/mobileap_cfg.xml (typically "PROXY") */
  dnsMode: string;
  /** True when dnsMode === "PROXY"; gates all writes */
  available: boolean;
  /** Live nameservers dnsmasq is forwarding to right now */
  currentUpstream: string[];
  /** Where the live upstream came from */
  currentSource: CustomDnsCurrentSource;
  /** True when IP Passthrough is on with DNS Proxy off — dnsmasq is bypassed for the passthrough host */
  passthroughBypass: boolean;
  /** True when the sentinel block in dnsmasq.conf is malformed (BEGIN without END or vice versa). Frontend offers a recovery action. */
  blockCorrupt?: boolean;
}

// --- API Requests ------------------------------------------------------------

/** POST body for action=save on /cgi-bin/quecmanager/network/custom_dns.sh */
export interface CustomDnsSaveRequest {
  action: "save";
  enabled: boolean;
  ignore_carrier: boolean;
  /** Comma-separated server list (e.g. "1.1.1.1,1.0.0.1") */
  servers: string;
}

/** POST body for action=clear — removes the QManager block entirely */
export interface CustomDnsClearRequest {
  action: "clear";
}

/** Response from a successful POST */
export interface CustomDnsSaveSuccess {
  ok: true;
  /** Full GET payload reflecting the applied state */
  applied: CustomDnsSettingsResponse;
}

/** Response from a failed POST */
export interface CustomDnsSaveError {
  ok: false;
  error: string;
  /** Identifies the offending field, if applicable */
  field?: string;
}

export type CustomDnsSaveResponse = CustomDnsSaveSuccess | CustomDnsSaveError;

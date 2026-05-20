// =============================================================================
// wan-profiles.ts — QManager WAN Profile Management Types
// =============================================================================
// TypeScript interfaces for the Casa RDB-backed WAN profile system (6 slots).
// Profiles combine link.profile (configuration) and link.policy (runtime state)
// from the Casa RDB key-value store.
//
// Backend contract:
//   CGI endpoint:  /cgi-bin/quecmanager/cellular/apn.sh
//   RDB namespace: link.profile.{1-6}.* (config), link.policy.{1-6}.* (runtime)
//   Profile slots: 1-6 (fixed, Casa-managed)
//
// See: docs/casa-gui/rdb-reference.md, docs/casa-gui/status-data-sources.md
// =============================================================================

// --- Profile Data Model ------------------------------------------------------

/** A single WAN connection profile (Casa link.profile + link.policy combined) */
export interface WanProfile {
  /** Profile slot index (1-6) */
  index: number;
  /** User-defined profile name */
  name: string;
  /** Access Point Name */
  apn: string;
  /** PDP context type: ipv4, ipv6, ipv4v6 */
  pdp_type: string;
  /** Authentication type: none, pap, chap */
  auth_type: string;
  /** Authentication username */
  username: string;
  /** Whether a PDP authentication password is stored (the password itself
   *  is never sent to the client) */
  has_password: boolean;
  /** Configured MTU (null = default 1500) */
  mtu: number | null;
  /** Whether this profile is enabled */
  enabled: boolean;
  /** Whether this profile is the default route */
  default_route: boolean;
  /** Whether IP passthrough is enabled for this profile */
  ip_passthrough: boolean;
  /** Modem CID this profile maps to (1-6) */
  modem_profile: number;
  /** Carrier-provisioned APN type: default, ims, emergency */
  apn_type: string;
  /** VLAN index for LAN mapping (empty = bridge0 default) */
  vlan_index: string;

  // --- Runtime state (from link.policy, read-only) ---------------------------

  /** IPv4 connection status: up, down */
  status_ipv4: string;
  /** IPv6 connection status: up, down */
  status_ipv6: string;
  /** Connection progress: connected, connecting, connecting fail, disconnected */
  connect_progress: string;
  /** Assigned IPv4 address */
  ipv4_address: string;
  /** IPv4 gateway */
  ipv4_gateway: string;
  /** Primary DNS server */
  dns1: string;
  /** Secondary DNS server */
  dns2: string;
  /** Assigned IPv6 address */
  ipv6_address: string;
  /** Negotiated MTU from network */
  mtu_negotiated: number | null;
  /** Kernel network interface name (e.g. rmnet_data0) */
  interface: string;
  /** PDP activation error message (empty on success) */
  pdp_error: string;
}

// --- API Response Types ------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/cellular/apn.sh */
export interface WanProfilesResponse {
  success: boolean;
  max_profiles: number;
  /** Backend data source: "rdb" (Casa wmmd) or "at" (AT-only, e.g. RM520N-GL).
   *  On "at", wmmd-only controls (default route, IP passthrough, VLAN
   *  mapping) have no equivalent and are hidden by the UI. */
  data_source: "rdb" | "at";
  profiles: WanProfile[];
  error?: string;
}

/** Response from POST save/toggle operations */
export interface WanProfileSaveResponse {
  success: boolean;
  error?: string;
}

// --- API Request Types -------------------------------------------------------

/** Request body for saving a WAN profile */
export interface WanProfileSaveRequest {
  name: string;
  apn: string;
  pdp_type: string;
  auth_type: string;
  username: string;
  password: string;
  mtu: number | null;
  ip_passthrough: boolean;
  modem_profile: number;
  default_route: boolean;
  vlan_index: string;
}

/** Request body for toggling a profile's enabled state */
export interface WanProfileToggleRequest {
  index: number;
  enabled: boolean;
}

// --- Display Helpers ---------------------------------------------------------

/** PDP type display labels */
export const PDP_TYPE_OPTIONS = [
  { value: "ipv4", label: "IPv4" },
  { value: "ipv6", label: "IPv6" },
  { value: "ipv4v6", label: "IPv4v6" },
] as const;

/** Authentication type display labels */
export const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "pap", label: "PAP" },
  { value: "chap", label: "CHAP" },
] as const;

/** VLAN mapping options */
export const VLAN_OPTIONS = [
  { value: "", label: "Default (bridge0)" },
  { value: "1", label: "VLAN 1" },
  { value: "2", label: "VLAN 2" },
  { value: "3", label: "VLAN 3" },
  { value: "4", label: "VLAN 4" },
] as const;

// --- Utility Functions -------------------------------------------------------

/** Check if a profile is carrier-provisioned (read-only, not user-editable) */
export function isCarrierProfile(profile: WanProfile): boolean {
  return profile.apn_type === "ims" || profile.apn_type === "emergency";
}

/** Check if a profile has an active data connection */
export function isProfileConnected(profile: WanProfile): boolean {
  return profile.status_ipv4 === "up" || profile.status_ipv6 === "up";
}

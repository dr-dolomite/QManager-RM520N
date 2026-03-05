// =============================================================================
// ip-passthrough.ts — QManager IP Passthrough (IPPT) Settings Types
// =============================================================================
// TypeScript interfaces for the IP Passthrough feature.
//
// Backend contract:
//   GET/POST /cgi-bin/quecmanager/network/ip_passthrough.sh
// =============================================================================

/** Passthrough bridge mode */
export type PassthroughMode = "disabled" | "eth" | "usb";

/** USB modem protocol: 0=rmnet, 1=ecm, 2=mbim, 3=rndis */
export type UsbMode = "0" | "1" | "2" | "3";

/** DNS offloading via DHCPV4DNS */
export type DnsProxy = "enabled" | "disabled";

/** IPPT NAT mode: 0=WithoutNAT (public IP only to passthrough device), 1=WithNAT */
export type IpptNat = "0" | "1";

// --- API Responses -----------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/network/ip_passthrough.sh */
export interface IpPassthroughSettingsResponse {
  success: boolean;
  /** Current passthrough mode */
  passthrough_mode: PassthroughMode;
  /** Target device MAC/hostname — empty string when mode is disabled or no filter set */
  target_mac: string;
  /** IPPT NAT working mode: 0=WithoutNAT, 1=WithNAT */
  ippt_nat: IpptNat;
  /** Current USB modem protocol index */
  usb_mode: UsbMode;
  /** DNS offloading status */
  dns_proxy: DnsProxy;
  /** MAC address of the browser's device (from ARP lookup, may be empty) */
  client_mac: string;
  error?: string;
}

// --- API Requests ------------------------------------------------------------

/** POST body for /cgi-bin/quecmanager/network/ip_passthrough.sh */
export interface IpPassthroughSaveRequest {
  /** Only "apply" — settings are applied and reboot is triggered in one shot */
  action: "apply";
  passthrough_mode: PassthroughMode;
  /** Required when passthrough_mode is "eth" or "usb" */
  target_mac: string;
  ippt_nat: IpptNat;
  usb_mode: UsbMode;
  dns_proxy: DnsProxy;
}

/** Response from POST /cgi-bin/quecmanager/network/ip_passthrough.sh */
export interface IpPassthroughSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

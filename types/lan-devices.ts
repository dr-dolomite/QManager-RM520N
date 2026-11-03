// =============================================================================
// lan-devices.ts — Connected LAN Device List Types
// =============================================================================
// TypeScript interfaces for the read-only connected-devices endpoint that backs
// the IP Passthrough MAC picker (and any future "pick a LAN device" surface).
//
// Backend contract:
//   GET /cgi-bin/quecmanager/network/lan_devices.sh
//   → { "success": true, "devices": [ { "mac", "ip", "hostname" } ] }
// =============================================================================

/** A single device seen on the modem's LAN (DHCP lease merged with ip neigh/ARP). */
export interface LanDevice {
  /** Lowercase colon-separated MAC, e.g. "94:83:c4:a6:ff:8b". Always a valid 6-octet MAC. */
  mac: string;
  /** IPv4 address, e.g. "192.168.225.129". May be empty if only known from neigh. */
  ip: string;
  /** DHCP-lease hostname, e.g. "GL-MT6000". Empty string when unknown. */
  hostname: string;
}

/** Response from GET /cgi-bin/quecmanager/network/lan_devices.sh */
export interface LanDevicesResponse {
  success: boolean;
  devices: LanDevice[];
  error?: string;
}

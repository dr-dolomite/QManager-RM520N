// LAN gateway/subnet editor contract. "Gateway" is bridge0's own IPv4 address;
// "subnet" is its netmask, chosen in the UI as a CIDR prefix.
// Endpoint: GET/POST /cgi-bin/quecmanager/network/lan_config.sh

export interface LanConfigStatus {
  success: true;
  /** Bridge device, e.g. "bridge0" */
  device: string;
  /** Current LAN IPv4 address (the gateway) */
  ipaddr: string;
  /** Current subnet mask, e.g. "255.255.255.0" */
  netmask: string;
  /** CIDR prefix derived from the netmask, e.g. 24 */
  prefix: number;
}

export interface LanConfigSaveRequest {
  ipaddr: string;
  prefix: number;
}

export interface LanConfigSaveResponse {
  success: boolean;
  /** True once the change is committed and the deferred reboot is armed; false on a no-change save */
  apply_in_progress?: boolean;
  /** Seconds the device is expected to be unreachable (about one reboot) */
  disconnect_window_seconds?: number;
  /** Always true on RM520N (the reboot drops the link); kept for RM551E contract parity */
  carrier_bounce?: boolean;
  /** The address the device will be reachable at after the reboot */
  new_ipaddr?: string;
  netmask?: string;
  prefix?: number;
  error?: string;
  detail?: string;
}

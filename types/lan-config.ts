// GET/POST /cgi-bin/quecmanager/network/lan_config.sh

export interface LanInterfaceStatus {
  state: string;
  ipv4_cidr: string;
}

export interface LanConfigResponse {
  success: boolean;
  error?: string;
  detail?: string;
  mode: "read_only_discovery" | "read_write";
  config_file: string;
  tools: {
    xmlstarlet_available: boolean;
  };
  lan: {
    ip_address: string;
    assign_ip_address: boolean;
    subnet_mask: string;
    bridge0: LanInterfaceStatus;
    eth0: LanInterfaceStatus;
  };
  dhcp: {
    enabled: boolean;
    start_ip: string;
    end_ip: string;
    lease_time_seconds: number | null;
  };
  ip_passthrough_xml: {
    enabled: boolean;
    device_type: string;
    host_name: string;
    mac_address: string;
    nat_pdn: string;
  };
  modem_lanip_at: {
    command: string;
    dhcp_start_ip: string;
    dhcp_end_ip: string;
    gateway_ip: string;
  };
  supported_future_writes: string[];
  apply_notes: string[];
}

export interface LanConfigSaveRequest {
  action: "save";
  lan_ip: string;
  subnet_mask: string;
  dhcp_enabled: boolean;
  dhcp_start: string;
  dhcp_end: string;
  lease_time_seconds: number;
}

export interface LanConfigSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
  reboot_required?: boolean;
  at_lanip_applied?: boolean;
  at_lanip_warning?: string;
}

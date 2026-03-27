export interface VideoOptimizerSettings {
  enabled: boolean;
  status: "running" | "stopped" | "restarting" | "error";
  uptime: string;
  packets_processed: number;
  domains_loaded: number;
  binary_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface VideoOptimizerResponse {
  success: boolean;
  enabled: boolean;
  status: "running" | "stopped" | "restarting" | "error";
  uptime: string;
  packets_processed: number;
  domains_loaded: number;
  binary_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface VerifyResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  timestamp?: string;
  without_bypass?: {
    speed_mbps: number;
    throttled: boolean;
  };
  with_bypass?: {
    speed_mbps: number;
    throttled: boolean;
  };
  improvement?: string;
  error?: string;
}

export interface VideoOptimizerSavePayload {
  action: "save";
  enabled: boolean;
}

export interface VideoOptimizerVerifyPayload {
  action: "verify";
}

export interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
}

export interface TrafficMasqueradeSettings {
  enabled: boolean;
  status: "running" | "stopped" | "error";
  uptime: string;
  packets_processed: number;
  sni_domain: string;
  binary_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface TrafficMasqueradeResponse extends TrafficMasqueradeSettings {
  success: boolean;
}

export interface HostlistResponse {
  success: boolean;
  domains: string[];
  count: number;
}

export interface MasqueradeTestResult {
  status: "idle" | "running" | "complete" | "error";
  injected?: boolean;
  packets?: number;
  message?: string;
  error?: string;
}

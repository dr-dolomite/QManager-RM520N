// =============================================================================
// Traffic Engine shared types — Local Network → Traffic Engine
// =============================================================================
// Mirrors the DPI Settings contract in docs/API-REFERENCE.md (the RM551E
// contract, re-architected around the tpws engine). The backend endpoint is
// /cgi-bin/quecmanager/network/video_optimizer.sh for both modes.

export type DpiEngineStatus = "running" | "stopped" | "restarting" | "error";

/** One of the two mutually exclusive engine modes the config selects. */
export type DpiMode = "video_optimizer" | "masquerade" | "none";

/** GET /network/video_optimizer.sh (and ?section=masquerade) response. */
export interface VideoOptimizerStatus {
  success: boolean;
  /** Config intent — the engine may be stopped (e.g. binary not installed). */
  enabled: boolean;
  status: DpiEngineStatus;
  /** Human uptime of the engine unit, e.g. "2h 34m". */
  uptime: string;
  /** Packet counter of the REDIRECT rule. */
  packets_processed: number;
  /** Hostlist line count (Video Optimizer mode only). */
  domains_loaded: number;
  /** tpws binary present on the modem. */
  binary_installed: boolean;
  /** REDIRECT rule currently applied (tpws needs no kernel module). */
  kernel_module_loaded: boolean;
  /** QUIC Force-TCP config intent — standalone, independent of the engine. */
  force_tcp: boolean;
  /** QUIC Force-TCP rule currently applied on bridge0 FORWARD. */
  force_tcp_active: boolean;
}

/** ?section=masquerade adds the spoofed SNI domain. */
export interface MasqueradeStatus extends VideoOptimizerStatus {
  sni_domain: string;
}

export type InstallPhase = "idle" | "running" | "complete" | "error" | "already";

/** GET ?action=install_status response. */
export interface InstallStatus {
  success: boolean;
  status: InstallPhase;
  message?: string;
  detail?: string;
}

export interface SpeedSample {
  speed_mbps: number;
  throttled: boolean;
}

/** "3rd opinion" reference sample: the raw connection, not the CDN. */
export interface VerifyReference {
  speed_mbps: number;
  source: "speedtest" | "cloudflare";
}

export type VerifyPhase = "idle" | "running" | "complete" | "error";

/** GET ?action=verify_status response. */
export interface VerifyResult {
  success: boolean;
  status: VerifyPhase;
  timestamp?: string;
  without_bypass?: SpeedSample;
  with_bypass?: SpeedSample;
  reference?: VerifyReference | null;
  improvement?: string;
  message?: string;
  detail?: string;
}

/** GET ?action=hostlist response. */
export interface HostlistResponse {
  success: boolean;
  domains: string[];
}
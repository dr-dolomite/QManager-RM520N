// =============================================================================
// speedtest.ts — Speedtest Data Contract (TypeScript)
// =============================================================================
// Types for Ookla speedtest-cli JSON output with -f json -p yes.
// Used by useSpeedtest hook and SpeedtestDialog component.
//
// Bandwidth values from the CLI are in BYTES per second.
// Conversion: Mbps = bandwidth * 8 / 1_000_000
// =============================================================================

// --- Progress Types (from -p yes output) ------------------------------------

/** First line emitted — contains server/ISP info before any test phase */
export interface SpeedtestTestStart {
  type: "testStart";
  timestamp: string;
  isp: string;
  interface: SpeedtestInterface;
  server: SpeedtestServer;
}

/** Ping measurement progress */
export interface SpeedtestPingProgress {
  type: "ping";
  timestamp: string;
  ping: {
    jitter: number;
    latency: number;
    progress: number; // 0.0 – 1.0
  };
}

/** Download measurement progress */
export interface SpeedtestDownloadProgress {
  type: "download";
  timestamp: string;
  download: {
    bandwidth: number; // bytes/sec
    bytes: number;
    elapsed: number; // ms
    latency?: { iqm: number };
    progress: number; // 0.0 – 1.0
  };
}

/** Upload measurement progress */
export interface SpeedtestUploadProgress {
  type: "upload";
  timestamp: string;
  upload: {
    bandwidth: number; // bytes/sec
    bytes: number;
    elapsed: number; // ms
    latency?: { iqm: number };
    progress: number; // 0.0 – 1.0
  };
}

/** Union of all progress line types */
export type SpeedtestProgressLine =
  | SpeedtestTestStart
  | SpeedtestPingProgress
  | SpeedtestDownloadProgress
  | SpeedtestUploadProgress
  | SpeedtestFinalResult;

// --- Final Result (last line of output) -------------------------------------

export interface SpeedtestFinalResult {
  type: "result";
  timestamp: string;
  ping: {
    jitter: number;
    latency: number;
    low: number;
    high: number;
  };
  download: {
    bandwidth: number; // bytes/sec
    bytes: number;
    elapsed: number;
    latency: {
      iqm: number;
      low: number;
      high: number;
      jitter: number;
    };
  };
  upload: {
    bandwidth: number; // bytes/sec
    bytes: number;
    elapsed: number;
    latency: {
      iqm: number;
      low: number;
      high: number;
      jitter: number;
    };
  };
  /**
   * Percentage, 0–100, as a full float (`0.33003300330033003` on the wire —
   * round it before display).
   *
   * OPTIONAL, and verified so against the live device: Ookla omits the field
   * entirely for servers that do not measure loss. The render site has always
   * guarded it; the type is what disagreed, and the type was the one that was
   * wrong.
   */
  packetLoss?: number;
  isp: string;
  interface: SpeedtestInterface;
  server: SpeedtestServer;
  result: {
    id: string;
    url: string;
    persisted: boolean;
  };
}

// --- Shared Sub-Types -------------------------------------------------------

export interface SpeedtestInterface {
  internalIp: string;
  name: string;
  macAddr: string;
  isVpn: boolean;
  externalIp: string;
}

export interface SpeedtestServer {
  id: number;
  host: string;
  port: number;
  name: string;
  location: string;
  country: string;
  ip: string;
}

// --- Server List Types -------------------------------------------------------

/** A nearby server from `speedtest --servers -f json` */
export interface SpeedtestServerEntry {
  id: number;
  host: string;
  port: number;
  name: string;
  location: string;
  country: string;
}

// --- CGI Response Types -----------------------------------------------------

/** GET /cgi-bin/.../speedtest_check.sh */
export interface SpeedtestCheckResponse {
  available: boolean;
}

/** GET /cgi-bin/.../speedtest_servers.sh */
export interface SpeedtestServersResponse {
  success: boolean;
  servers?: SpeedtestServerEntry[];
  error?: string;
  detail?: string;
}

/** POST /cgi-bin/.../speedtest_start.sh */
export interface SpeedtestStartResponse {
  success: boolean;
  pid?: number;
  error?: string;
  detail?: string;
}

/** GET /cgi-bin/.../speedtest_status.sh */
export type SpeedtestStatusResponse =
  | { status: "idle" }
  | { status: "running"; phase: string; progress: SpeedtestProgressLine }
  | { status: "complete"; result: SpeedtestFinalResult }
  | { status: "error"; error: string; detail?: string };

// --- Utility Functions -------------------------------------------------------

/** Convert bytes/sec to Mbps */
export function bytesToMbps(bytesPerSec: number): number {
  return (bytesPerSec * 8) / 1_000_000;
}

/** Format Mbps for display (e.g. "485.4 Mbps") */
export function formatSpeed(bytesPerSec: number): string {
  const mbps = bytesToMbps(bytesPerSec);
  if (mbps >= 100) return `${mbps.toFixed(1)}`;
  if (mbps >= 10) return `${mbps.toFixed(2)}`;
  return `${mbps.toFixed(2)}`;
}

/** Format bytes for data transferred display */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

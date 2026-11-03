// Web port: the HTTP / HTTPS ports lighttpd serves QManager on.
// Backend: /cgi-bin/quecmanager/system/web_port.sh; SSH: qmanager_web_port. Doc: docs/reference/web-port.md

export type WebPortResultStatus =
  | "pending"
  | "applied"
  | "unchanged"
  | "rolled_back"
  | "failed";

export interface WebPortLastResult {
  status: WebPortResultStatus;
  http_port: number;
  https_port: number;
  /** Epoch seconds. */
  at: number;
}

export interface WebPortState {
  httpPort: number;
  httpsPort: number;
  listening: { http: boolean; https: boolean };
  lastResult: WebPortLastResult | null;
}

export interface WebPortResponse {
  success: boolean;
  http_port?: number;
  https_port?: number;
  listening?: { http?: boolean; https?: boolean };
  last_result?: WebPortLastResult | null;
  apply_in_progress?: boolean;
  error?: string;
  detail?: string;
}

export interface WebPortSaveResult {
  ok: boolean;
  /** True when the server is restarting on the new ports. */
  moving?: boolean;
  httpPort?: number;
  httpsPort?: number;
  error?: string;
}

export const DEFAULT_HTTP_PORT = 80;
export const DEFAULT_HTTPS_PORT = 443;

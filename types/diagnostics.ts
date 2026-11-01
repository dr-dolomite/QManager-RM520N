// Response shapes for POST system/diagnostics.sh {"action":"capture"}.
// Errors: report_tool_missing | capture_failed | unknown_action | method_not_allowed

export interface DiagnosticsCaptureSuccess {
  success: true;
  /** The report's path on the device; only its basename names the download. */
  filename: string;
  content: string;
}

export interface DiagnosticsCaptureError {
  success: false;
  error: string;
  detail?: string;
}

export type DiagnosticsCaptureResponse =
  | DiagnosticsCaptureSuccess
  | DiagnosticsCaptureError;

/** What one capture returned, so the caller's toast reads THIS call's reason. */
export type DiagnosticsCaptureResult =
  | { ok: true }
  | { ok: false; reason: string };

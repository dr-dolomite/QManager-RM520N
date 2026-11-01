// types/diagnostics.ts
//
// Response shapes for the debug-report capture endpoint.
// Backend: POST /cgi-bin/quecmanager/system/diagnostics.sh  body {"action":"capture"}
//   success → { success: true, filename, content }
//   error   → { success: false, error: CODE, detail?: MSG }
//   codes: report_tool_missing | capture_failed | unknown_action | method_not_allowed

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

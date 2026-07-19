// =============================================================================
// sms-forwarding.ts — SMS Forwarding Types
// =============================================================================
// TypeScript interfaces for the SMS Forwarding CGI endpoint.
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh
//
// The forwarding daemon is the server-side inbox reader: it relays incoming
// SMS to a configured target, and when it abandons a message after repeated
// failed sends it appends to a persistent failure list surfaced here.
// =============================================================================

/** Forwarding relay configuration */
export interface SmsForwardingSettings {
  /** Whether the relay daemon is enabled */
  enabled: boolean;
  /** Destination phone number that receives forwarded messages */
  target_phone: string;
}

/** A single abandoned-delivery record kept by the daemon */
export interface SmsForwardingFailure {
  /** Original inbound sender (may be empty/unknown) */
  sender: string;
  /** When the failure was recorded */
  timestamp: string;
  /** Last error the daemon saw before giving up */
  last_error: string;
}

/** Normalized shape the UI renders from */
export interface SmsForwardingData {
  settings: SmsForwardingSettings;
  failures: SmsForwardingFailure[];
  failure_count: number;
}

/** Payload for the save_settings action */
export interface SmsForwardingSavePayload {
  enabled: boolean;
  target_phone: string;
}

/** Response from GET /cgi-bin/quecmanager/cellular/sms_forwarding.sh */
export interface SmsForwardingResponse {
  success: boolean;
  settings?: Partial<SmsForwardingSettings>;
  failures?: SmsForwardingFailure[];
  failure_count?: number;
  error?: string;
  detail?: string;
}

/** Generic POST response (save_settings / send_test / clear_failures) */
export interface SmsForwardingActionResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

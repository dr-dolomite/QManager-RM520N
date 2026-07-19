// =============================================================================
// sms.ts — SMS Center Types
// =============================================================================
// TypeScript interfaces for the SMS Center CGI endpoint.
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
//
// Note: The SmsMessage shape matches the JSON output of `sms_tool -j recv`.
// Verify field names against actual device output and adjust if needed.
// =============================================================================

/** A single (possibly merged multi-part) SMS message */
export interface SmsMessage {
  /** Storage indexes for all parts of this message (used for deletion) */
  indexes: number[];
  /** Sender phone number or alphanumeric ID */
  sender: string;
  /** Message content (concatenated if multi-part) */
  content: string;
  /** Timestamp string (format: "MM/DD/YY HH:MM:SS") */
  timestamp: string;
  /**
   * Which modem memory this message lives in:
   *   "ME" — modem memory (where new incoming messages are routed)
   *   "SM" — SIM card (legacy storage; incoming used to land here)
   * Required so deletion targets the correct storage (AT+CPMS).
   */
  storage: "ME" | "SM";
}

/** Storage status info */
export interface SmsStorage {
  /** Number of messages currently stored */
  used: number;
  /** Maximum storage capacity */
  total: number;
}

/** Response from GET /cgi-bin/quecmanager/cellular/sms.sh */
export interface SmsInboxResponse {
  success: boolean;
  messages: SmsMessage[];
  storage: SmsStorage;
  error?: string;
  detail?: string;
}

/** Generic POST response */
export interface SmsActionResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

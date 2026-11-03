// =============================================================================
// sms.ts — SMS Center Types
// =============================================================================
// TypeScript interfaces for the SMS Center CGI endpoint.
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
//
// sms.sh builds SmsMessage from `qsms list all` (the qmanager_atd SMS client),
// merging multi-part messages per storage, and appends the browser's own sent
// messages from a small sent log (storage "SENT").
// =============================================================================

// -----------------------------------------------------------------------------
// Sender identity — `addr` is THE KEY, never the label
// -----------------------------------------------------------------------------
// `addr` is the sender exactly as the modem reported it. It is simultaneously
// the thread-fetch key (`sms.sh?addr=…`), the delete key, the reply destination
// and the thread's React key, so it may never be replaced with a human-readable
// name. The backend emits three ADDITIVE fields beside it and the UI renders
// those instead.
//
// All three are OPTIONAL: the surface must degrade to `addr` when a backend
// build predates them.
// -----------------------------------------------------------------------------

/** Where a rendered sender name came from. Drives the provenance marker. */
export type SmsDisplaySource =
  /** The stored value was already clean alphanumeric text from the network. */
  | "network"
  /** Recovered from a mangled string by the backend. */
  | "decoded"
  /** Matched by the frontend-bundled short-code table (`lib/sms-directory.ts`). */
  | "directory"
  /** Nothing resolved: `display_name` equals `addr`. */
  | "raw";

/** Shape of the stored address. Drives disc glyph vs initials and formatting. */
export type SmsAddrKind = "alphanumeric" | "shortcode" | "msisdn";

/** The three additive identity fields, shared by messages and threads. */
export interface SmsSenderIdentityFields {
  /**
   * The title to render. Equals `addr` when nothing resolved.
   * **Never pass this to fetch, delete, reply, mark-read or the fingerprint.**
   */
  display_name?: string;
  /** Provenance of `display_name`. The frontend may upgrade `raw` -> `directory`. */
  display_source?: SmsDisplaySource;
  /** Classification of the raw `addr`. */
  addr_kind?: SmsAddrKind;
}

/** Which memory a message lives in. `SENT` is the browser-side sent log. */
export type SmsStorageName = "ME" | "SM" | "SENT";

/** A single (possibly merged multi-part) SMS message */
export interface SmsMessage extends SmsSenderIdentityFields {
  /** Storage indexes for all parts of this message (empty for a sent record). */
  indexes: number[];
  /** Single primary message index */
  index?: number;
  /**
   * Sender phone number or alphanumeric ID, exactly as the modem stored it.
   * **A key, never a label.**
   */
  sender: string;
  /**
   * Address (phone number or short code), byte-identical to the modem's store.
   * **A key, never a label.** Render `display_name`; key everything else off
   * this.
   */
  addr?: string;
  /**
   * Stable per-message key: `"<storage><firstIndex>:<time>"` for a received
   * message, `"S<seq>:<time>"` for a sent record. A sent record is deleted by
   * this value.
   */
  identity?: string;
  /** Message content (concatenated if multi-part) */
  content: string;
  /** Timestamp string (format: "MM/DD/YY HH:MM:SS", device local time) */
  timestamp: string;
  /** Unix timestamp in seconds */
  time?: number;
  /** Direction: inbound (received) or outbound (sent) */
  direction?: "inbound" | "outbound";
  /** Status: success or failed */
  status?: "success" | "failed";
  /** Type code: 1 = inbound, 0 = outbound */
  type?: number;
  /** Result code: 1 = success, 0 = failed */
  result?: number;
  /** Truthy = unread. Never sent by the backend; overlaid from the browser read set. */
  unread?: number;
  /** Which memory this message lives in. */
  storage: SmsStorageName;
}

/** Conversation thread overview (grouped by contact/phone number) */
export interface SmsThread extends SmsSenderIdentityFields {
  /**
   * Contact phone number or alphanumeric ID, byte-identical to the modem's
   * store. **A key, never a label.** Render `display_name` instead.
   */
  addr: string;
  /** Sender identifier. Equals `addr`. Also a key, never a label. */
  sender?: string;
  /** Latest message preview text */
  latestMessage: string;
  /** Full content of the latest message */
  content?: string;
  /** Formatted timestamp string */
  timestamp: string;
  /** Unix timestamp in seconds */
  timestampSec: number;
  /** Number of unread messages in this thread (overlaid client-side) */
  unreadCount: number;
  /** Storage index of the latest message */
  latestIndex: number;
  /** Direction of latest message */
  direction?: "inbound" | "outbound";
  /** Type code: 1 = inbound, 0 = outbound */
  type?: number;
  /** Delivery status */
  status?: "success" | "failed";
}

/** SMS Service Center (SMSC) Configuration */
export interface SmscConfig {
  /** Phone number of the SMS Service Center */
  addr: string;
  status?: string;
  time?: string;
}

/** Storage status info */
export interface SmsStorage {
  /** Number of messages currently stored */
  used: number;
  /** Maximum storage capacity */
  total: number;
  /** Modem (ME) store. Optional: a device on an older backend sends only the sum. */
  me?: { used: number; total: number };
  /** SIM (SM) store. Optional for the same reason. */
  sm?: { used: number; total: number };
}

/** Response from GET /cgi-bin/quecmanager/cellular/sms.sh */
export interface SmsInboxResponse {
  success: boolean;
  messages: SmsMessage[];
  threads?: SmsThread[];
  storage: SmsStorage;
  /** Null when the provider number could not be read this time. */
  smsc?: SmscConfig | null;
  unread_total?: number;
  /** Stores whose read failed this time, keyed "ME" | "SM". */
  storage_errors?: Partial<Record<"ME" | "SM", string>>;
  error?: string;
  detail?: string;
}

/** Response from GET /cgi-bin/quecmanager/cellular/sms.sh?addr=<phone> */
export interface SmsThreadDetailResponse {
  success: boolean;
  addr: string;
  count: number;
  /** Oldest first. */
  messages: SmsMessage[];
  has_more?: boolean;
  error?: string;
  detail?: string;
}

/** Generic POST response */
export interface SmsActionResponse {
  success: boolean;
  /** Send: the number the backend filed the message under (normalized). */
  addr?: string;
  code?: string;
  error?: string;
  detail?: string;
  smsc?: SmscConfig | null;
  /** Send failure only: total parts, and how many went out before the failure. */
  parts?: number;
  sent_parts?: number;
  /** Send failure only: true when the failing part may have reached the network. */
  ambiguous?: boolean | null;
}

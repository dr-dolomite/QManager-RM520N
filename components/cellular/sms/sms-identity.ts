// =============================================================================
// sms-identity — the sender resolution ladder, as one pure function
// =============================================================================
// The sender-identity ladder: four tiers tried in order, and the address the
// device stored is always still on screen.
//
//   1. network   — the stored value was already clean text from the network.
//   2. decoded   — the backend un-mangled a GSM-7-packed sender ID that the
//                  vendor's BCD decoder had turned into `43:=<070`.
//   3. directory — the frontend-bundled short-code table filled a gap the
//                  device left (`lib/sms-directory.ts`).
//   4. raw       — nothing resolved. The address is shown exactly as stored.
//
// ## The invariant this module exists to protect
//
// `addr` is a KEY: the on-disk store path, the thread-fetch query, the delete
// payload, the reply destination, and the mark-unread payload. Every field
// below that could be mistaken for it is named `title` or `formattedAddr`, and
// `addr` is passed through byte-for-byte so a caller that needs the key has it
// without reaching back for the original object.
//
// ## Honesty rules
//
//   * A name we inferred wears a different marker from one the network sent.
//   * No guessing: an address that does not provably resolve is shown as stored.
//   * The disc hue is HASHED from the raw address across this system's own
//     container roles — never a carrier's real brand colour, which would be an
//     implied endorsement of a sender ID anyone can spoof.
//   * The stored address is no longer printed alongside a resolved name — a
//     resolved title already tells the user what they need, and the raw value
//     stays one tap away via the header's copy-address action (2026-09-22).
//
//   2026-09-24 — this rule was narrowed, on explicit product decision, to
//   cover ONLY the disc's hashed HUE. `logoDomain` below may now put the
//   sender's REAL logo image on that same disc when `lib/sms-logos.ts`
//   resolves one, because subscribers already recognize these marks and
//   initials-only discs made legitimate bank/government SMS harder to tell
//   apart from spam. The spoofability problem itself did not go away — the
//   mitigation moved to a phishing warning row under any inbound message
//   containing a link (`sms-conversation.tsx`, `sms-format.ts::
//   containsSuspiciousLink`), which spells out that a sender name (and, by
//   the same logic, a logo) can be faked. A name we inferred still gets no
//   logo lookup advantage over one the network sent; both go through the same
//   `lookupSmsLogoDomain(title)` call below.
// =============================================================================

import { classifyAddr, lookupSmsDirectory } from "@/lib/sms-directory";
import { lookupSmsLogoDomain } from "@/lib/sms-logos";
import type {
  SmsAddrKind,
  SmsDisplaySource,
  SmsSenderIdentityFields,
} from "@/types/sms";

/**
 * The disc palette. Five functional container roles plus neutral — the same
 * five the rest of the product already ships, so a thread disc can never
 * introduce a colour the design system does not own.
 */
export type SmsIdentityTone =
  | "primary"
  | "lte"
  | "success"
  | "warning"
  | "destructive"
  | "neutral";

const HASHED_TONES: readonly SmsIdentityTone[] = [
  "primary",
  "lte",
  "success",
  "warning",
  "destructive",
];

export interface SmsIdentity {
  /**
   * THE KEY. The raw stored address, byte-for-byte. Fetch, delete, reply,
   * mark-read and mark-unread all take this and never `title`.
   */
  addr: string;
  /** What to render as the thread title. Equals `addr` when nothing resolved. */
  title: string;
  /** Which tier produced `title`. Drives the provenance marker. */
  source: SmsDisplaySource;
  /** Shape of the raw address. Drives disc glyph vs initials. */
  kind: SmsAddrKind;
  /**
   * The address, formatted for reading. Grouped only when it is unambiguous to
   * group (see `formatMsisdn`); otherwise identical to `addr`.
   */
  formattedAddr: string;
  /**
   * True when `title` is a NAME rather than the address itself. Drives the
   * provenance tag (network name / matched) in the conversation header.
   */
  resolved: boolean;
  /** Disc fill role, hashed from `addr`. */
  tone: SmsIdentityTone;
  /** Disc initials, or null when the disc should render the person glyph. */
  initials: string | null;
  /**
   * Curated logo domain for the sender disc's brand mark, or `null` when
   * `lib/sms-logos.ts` has no exact match for `title`. Always `null` for a
   * plain MSISDN (`kind === "msisdn"`) — a bare phone number is never a
   * brand. The disc still falls back to `initials`/the person glyph whenever
   * the mark has not loaded yet or the favicon proves to be no icon.
   */
  logoDomain: string | null;
}

/**
 * djb2 over the RAW address. Hashing the title instead would re-colour a whole
 * conversation the day a short code lands in the directory, which reads as a
 * different sender rather than the same one better named.
 */
function hashAddr(addr: string): number {
  let h = 5381;
  for (let i = 0; i < addr.length; i++) {
    h = ((h << 5) + h + addr.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Group an international number for reading: `+639175550142` renders as
 * `+63 917 555 0142`.
 *
 * Only `+`-prefixed values are grouped. Without the leading `+` the country
 * code length is unknowable, and a wrong grouping of a real number is the same
 * class of defect as a wrong name — so a local-format number is returned
 * verbatim and simply set in tabular figures.
 */
export function formatMsisdn(addr: string): string {
  if (!addr.startsWith("+")) return addr;
  const digits = addr.slice(1);
  if (/\D/.test(digits) || digits.length < 8) return addr;

  // Chunk from the RIGHT — 4, then 3, then 3 — leaving the country code and any
  // remainder as the head. That is stable for E.164 regardless of CC length.
  const tail: string[] = [];
  let rest = digits;
  for (const size of [4, 3, 3]) {
    if (rest.length <= size) break;
    tail.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  return `+${[rest, ...tail].join(" ")}`;
}

/** Two-letter disc initials derived from the resolved title. */
function initialsFor(title: string): string | null {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return words[0].slice(0, 2).toUpperCase();
}

/**
 * Resolve one sender to everything the surface needs to draw it.
 *
 * Accepts the identity fields straight off an `SmsThread` or `SmsMessage`, all
 * of which are optional: against a backend build that predates the three new
 * keys this degrades to tier 4 (or tier 3, where the directory can fill in) and
 * the surface still works.
 */
export function resolveSmsIdentity(
  rawAddr: string,
  fields: SmsSenderIdentityFields = {},
): SmsIdentity {
  const addr = rawAddr;
  const supplied = fields.display_name?.trim();
  const kind: SmsAddrKind = fields.addr_kind ?? classifyAddr(addr);

  let title = supplied && supplied.length > 0 ? supplied : addr;
  // An envelope with no `display_source` is inferred: a name that differs from
  // the stored address can only have come from the network.
  let source: SmsDisplaySource =
    fields.display_source ?? (title === addr ? "raw" : "network");

  // Tier 3. THE ONE GATE: the directory only ever fills a gap. A `network` or
  // `decoded` name is the carrier's own word and a local lookup table never
  // overrides it — see the header of `lib/sms-directory.ts`.
  //
  // The lookup runs on `title`, not on `addr`, and at this point the two differ
  // only in the one case the backend documents: an odd-digit numeric address
  // whose GSM 03.40 `0xF` filler nibble rendered as a trailing `?`, which it
  // strips while still reporting `raw`. Looking up the stripped digits is what
  // lets `8080?` resolve; `lookupSmsDirectory` rejects any non-numeric input,
  // so a name can never reach the table.
  if (source === "raw") {
    const hit = lookupSmsDirectory(title);
    if (hit) {
      title = hit.name;
      source = "directory";
    }
  }

  const resolved = title !== addr;
  const numeric = kind === "msisdn";

  return {
    addr,
    title,
    source,
    kind,
    formattedAddr: numeric ? formatMsisdn(addr) : addr,
    resolved,
    // A plain mobile number gets the neutral disc and a glyph; a named or
    // short-code sender gets a hashed role and its initials.
    tone: numeric ? "neutral" : HASHED_TONES[hashAddr(addr) % HASHED_TONES.length],
    initials: numeric ? null : initialsFor(title),
    // Looked up on the RESOLVED title, not the raw address, so a directory-
    // tier short-code name (e.g. "GCash" for 2882) gets a logo too. Never for
    // a plain MSISDN — see the field's own doc comment above.
    logoDomain: numeric ? null : lookupSmsLogoDomain(title),
  };
}

/** Disc fill + ink per tone. Container layer only — never a raw brand colour. */
export const IDENTITY_DISC_CLASS: Record<SmsIdentityTone, string> = {
  primary: "bg-primary-container text-on-primary-container",
  lte: "bg-lte-container text-on-lte-container",
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

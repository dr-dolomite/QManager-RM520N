// =============================================================================
// sms-format — time, segment and one-time-code helpers for the SMS surface
// =============================================================================
// Pure functions only, so the conversation and the thread list agree on what
// "Yesterday" means and on where a date divider belongs.
// =============================================================================

import { smsSegments } from "@/lib/sms-segments";
import type { SmsMessage } from "@/types/sms";

/**
 * Parse an SMS timestamp into epoch millis. Two shapes are understood, tried in
 * order:
 *
 *   1. `"MM/DD/YY HH:MM:SS"`, the modem's own format (device local time).
 *   2. `"YYYY-MM-DD HH:MM:SS"`.
 *
 * Returns 0 on any malformed value so a bad timestamp sorts last rather than
 * throwing mid-render.
 */
export function parseSmsTimestamp(ts: string): number {
  const legacy = ts.match(
    /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (legacy) {
    const [, mo, dy, yr, hh, mm, ss] = legacy;
    // 2-digit year: SMS dates are contemporary, so 20YY is correct.
    return new Date(
      2000 + Number(yr),
      Number(mo) - 1,
      Number(dy),
      Number(hh),
      Number(mm),
      Number(ss),
    ).getTime();
  }

  const iso = ts.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (iso) {
    const [, yr, mo, dy, hh, mm, ss] = iso;
    return new Date(
      Number(yr),
      Number(mo) - 1,
      Number(dy),
      Number(hh),
      Number(mm),
      Number(ss),
    ).getTime();
  }

  return 0;
}

/**
 * Epoch millis for a message, tried in order of trustworthiness:
 *
 *   1. `time`: the backend's unix seconds, already corrected for the device's
 *      UTC offset.
 *   2. `timestamp` in either shape `parseSmsTimestamp` understands.
 *   3. `timestamp` parsed as a bare ISO string, as a last resort.
 *
 * Returns 0 for anything unparseable, so a bad value sorts last instead of
 * throwing mid-render.
 */
export function smsEpochMs(msg: {
  time?: number;
  timestamp?: string;
}): number {
  if (typeof msg.time === "number" && msg.time > 0) return msg.time * 1000;
  const ts = msg.timestamp;
  if (!ts) return 0;
  const parsed = parseSmsTimestamp(ts);
  if (parsed) return parsed;
  const iso = Date.parse(ts.replace(" ", "T"));
  return Number.isNaN(iso) ? 0 : iso;
}

/** Local midnight for an epoch, used to bucket messages into day groups. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Stable day key for date dividers. */
export function smsDayKey(ms: number): number {
  return startOfDay(ms);
}

export type SmsDayRelation = "today" | "yesterday" | "older";

export function dayRelation(ms: number, now = Date.now()): SmsDayRelation {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return "today";
  if (day === today - 86_400_000) return "yesterday";
  return "older";
}

/** `9:41 AM` in the user's locale. */
export function formatClock(ms: number, locale: string): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

/** `Sep 18`, or `Sep 18, 2025` once the year differs from now. */
export function formatDay(ms: number, locale: string, now = Date.now()): string {
  if (!ms) return "";
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(ms);
}

// -----------------------------------------------------------------------------
// Segments
// -----------------------------------------------------------------------------

export interface SmsSegmentInfo {
  /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
  chars: number;
  /** True when a character outside the GSM-7 alphabet forces UCS-2. */
  ucs2: boolean;
  /** Units in a single-part message at this encoding. */
  singleLimit: number;
  /** Number of parts this body would be submitted as. */
  segments: number;
  /** Units remaining in the current part. */
  remaining: number;
  /** On screen from the first boundary: the body is no longer one plain GSM-7 part. */
  visible: boolean;
}

/** Part counting from `lib/sms-segments.ts`, which mirrors the device's own encoder. */
export function segmentInfo(text: string): SmsSegmentInfo {
  const seg = smsSegments(text);
  const ucs2 = seg.encoding === "ucs2";
  const singleLimit = ucs2 ? 70 : 160;
  const segments = text.length === 0 ? 0 : seg.parts;
  return {
    chars: seg.units,
    ucs2,
    singleLimit,
    segments,
    remaining: Math.max(0, seg.perPart * Math.max(1, segments) - seg.units),
    visible: seg.units > 0 && (ucs2 || seg.parts > 1),
  };
}

// -----------------------------------------------------------------------------
// One-time codes
// -----------------------------------------------------------------------------

/**
 * Patterns for the "copy the code" chip. Every one requires a KEYWORD next to
 * the digits: a bare 6-digit run in a bank alert is a reference number or an
 * amount, and offering to copy it as a login code would be the interface
 * asserting something the message never said.
 */
const CODE_PATTERNS: RegExp[] = [
  /(?:code|pin|otp|passcode|password|verification|one[-\s]?time)[^0-9]{0,24}?(\d{4,8})(?!\d)/i,
  // `\b` on both sides rather than a lookbehind: inside a longer digit run
  // there is no word boundary, so a reference number cannot be sliced into a
  // "code".
  /\b(\d{4,8})\b[^0-9]{0,24}?(?:is your (?:code|pin|otp|password|verification)|as your (?:code|pin|otp))/i,
];

/** The one-time code in an inbound message body, or null. */
export function extractOneTimeCode(content: string): string | null {
  for (const re of CODE_PATTERNS) {
    const m = re.exec(content);
    if (m?.[1]) return m[1];
  }
  return null;
}

// -----------------------------------------------------------------------------
// Link detection (phishing warning)
// -----------------------------------------------------------------------------

/**
 * An explicit URI scheme: `http://` or `https://` followed by any non-space
 * run.
 */
const LINK_SCHEME_RE = /\bhttps?:\/\/\S+/i;

/** A `www.` prefix, the second most explicit "this is a link" signal. */
const LINK_WWW_RE = /\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i;

/**
 * A bare `<label>.<tld>` (optionally multi-label, e.g. `bdo.com.ph`) with no
 * scheme or `www.` prefix, gated to a closed list of TLDs: the common ones plus
 * the link-shortener and cheap-registration TLDs seen in smishing traffic
 * (`bit.ly`, `.icu`, `.cfd`, `.vip`...).
 *
 * - The label must START WITH A LETTER, so an amount or a clock reading (a
 *   digit run before the dot) never matches: "5.00", "10.30".
 * - The lookbehind/lookahead reject a match inside an email address, so
 *   `support@bdo.com.ph` is NOT reported: the warning says "Contains a link",
 *   and an email address is not one.
 *
 * Built from a string inside a try/catch rather than written as a literal: a
 * regex literal with a lookbehind is a SyntaxError on older Safari, and a
 * literal that fails to parse would take the whole module (and the SMS page)
 * down with it. Without lookbehind support the bare-domain check is simply off.
 */
const LINK_BARE_TLD_RE: RegExp | null = (() => {
  try {
    return new RegExp(
      "(?<![@\\w.-])[a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:com|ph|net|org|info|biz|co|io|me|ly|cc|link|xyz|top|site|online|shop|vip|click|icu|app|live|win|cfd|sbs|club|store)\\b(?![\\w.-]*@)\\S*",
      "i",
    );
  } catch {
    return null;
  }
})();

/**
 * Whether an inbound message body contains a link-shaped substring, for the
 * phishing warning row (`sms-conversation.tsx`).
 *
 * Examples:
 *   containsSuspiciousLink("Verify at http://bit.ly/xyz")        -> true
 *   containsSuspiciousLink("Visit www.gcash.com to claim")       -> true
 *   containsSuspiciousLink("claim your prize at bit.ly/win")     -> true
 *   containsSuspiciousLink("Pay at gcash-rewards.icu now")       -> true
 *   containsSuspiciousLink("Go to gcash.com.")                   -> true
 *   containsSuspiciousLink("Email support@bdo.com.ph for help")  -> false
 *   containsSuspiciousLink("You have 1.5GB left. Dial *123#")    -> false
 *   containsSuspiciousLink("Your balance is 5.00 as of 10.30")   -> false
 *   containsSuspiciousLink("Thanks for your payment of 100.00")  -> false
 */
export function containsSuspiciousLink(content: string): boolean {
  if (!content) return false;
  return (
    LINK_SCHEME_RE.test(content) ||
    LINK_WWW_RE.test(content) ||
    (LINK_BARE_TLD_RE?.test(content) ?? false)
  );
}

// -----------------------------------------------------------------------------
// Direction
// -----------------------------------------------------------------------------

/**
 * Outbound detection. `direction` is authoritative when present; `type` is the
 * numeric form (1 = inbound, 0 = outbound) and is the fallback.
 */
export function isOutbound(msg: SmsMessage): boolean {
  if (msg.direction) return msg.direction === "outbound";
  if (typeof msg.type === "number") return msg.type === 0;
  return false;
}

/**
 * A backend-recorded failed send: `direction:"outbound"`, `status:"failed"`.
 * Unlike a client-side pending send (`PendingSmsSend`, `hooks/use-sms.ts`), this
 * survives a reload because it lives in the sent log, not React state.
 *
 * The ONE predicate both the bubble-styling path and the pending/server dedupe
 * path (`sms-conversation.tsx`) key off, so "what counts as a failed send" can
 * never drift between the two.
 */
export function isServerFailed(msg: SmsMessage): boolean {
  return isOutbound(msg) && msg.status === "failed";
}

/** Digits with an optional leading `+`, spaces and dashes, at least 3 digits. */
export function isDialableSender(addr: string): boolean {
  const trimmed = addr.trim();
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 3;
}

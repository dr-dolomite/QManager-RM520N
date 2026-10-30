// Mirrors encode_submit in native/qmanager_atd/src/sms/pdu.rs; keep the tables and limits in step.

const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM7_EXTENSION = new Set("\f^{}\\[~]|€");

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsSegments {
  encoding: SmsEncoding;
  /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
  units: number;
  parts: number;
  /** Units one part holds: the single-part limit, or the per-part limit once split. */
  perPart: number;
}

function gsm7Units(ch: string): number | null {
  if (GSM7_BASIC.has(ch)) return 1;
  if (GSM7_EXTENSION.has(ch)) return 2;
  return null;
}

// A character's units are never split across parts, as in pdu.rs `chunk`.
function countParts(units: number[], single: number, multi: number): number {
  const total = units.reduce((a, b) => a + b, 0);
  if (total <= single) return 1;
  let parts = 1;
  let used = 0;
  for (const u of units) {
    if (used + u > multi) {
      parts += 1;
      used = 0;
    }
    used += u;
  }
  return parts;
}

export function smsSegments(text: string): SmsSegments {
  const chars = Array.from(text);
  const gsm = chars.map(gsm7Units);
  if (gsm.every((u): u is number => u !== null)) {
    const units = gsm.reduce((a, b) => a + b, 0);
    const parts = countParts(gsm, 160, 153);
    return { encoding: "gsm7", units, parts, perPart: parts > 1 ? 153 : 160 };
  }
  const ucs = chars.map((c) => c.length);
  const units = ucs.reduce((a, b) => a + b, 0);
  const parts = countParts(ucs, 70, 67);
  return { encoding: "ucs2", units, parts, perPart: parts > 1 ? 67 : 70 };
}

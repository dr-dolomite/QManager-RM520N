// =============================================================================
// ipv6.ts — IPv6 normalisation for Quectel-reported addresses
// =============================================================================
// Extracted VERBATIM from components/cellular/cell-data.tsx during the
// /cellular/ radio-information redesign, which deletes that file. The algorithm
// below is hard-won domain logic and is moved unchanged on purpose — behaviour
// on every input must stay byte-identical to the shipped version.
//
// Why the dotted-decimal input shape exists: the modem reports an IPv6 address
// through AT+CGCONTRDP as SIXTEEN dot-separated DECIMAL octets ("253.0.151.106.
// 0.0.…"), not as eight hex groups. That is a perfectly valid way to write 128
// bits and a completely unreadable way to show one to a person, so the octets
// are paired back into hex groups and then compressed per RFC 5952. A 4-octet
// dotted value is a real IPv4 address and is returned untouched.
// =============================================================================

/** Convert decimal to hex string for TAC tooltip, e.g. 49026 → "BF82" */
export function decToHex(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return value.toString(16).toUpperCase();
}

/**
 * Normalize an IPv6 address to RFC 5952 compressed form.
 * Handles both standard colon notation and Quectel's dotted-decimal
 * octet format (16 dot-separated bytes from AT+CGCONTRDP).
 *
 * Examples:
 *   "253.0.151.106.0.0.0.0.0.0.0.0.0.0.0.9" → "fd00:9b6a::9"
 *   "2607:fb90:0000:0000:0000:0000:0000:c505" → "2607:fb90::c505"
 *   "10.151.151.44" (IPv4, 4 octets) → returned as-is
 */
export function compressIPv6(ip: string): string {
  if (!ip) return "-";

  let groups: string[];

  // Detect Quectel dotted-decimal IPv6: exactly 16 dot-separated decimal octets
  const dotParts = ip.split(".");
  if (dotParts.length === 16 && dotParts.every((p) => /^\d{1,3}$/.test(p))) {
    // Pair octets into 8 hex groups
    groups = [];
    for (let i = 0; i < 16; i += 2) {
      const hi = parseInt(dotParts[i], 10);
      const lo = parseInt(dotParts[i + 1], 10);
      groups.push(((hi << 8) | lo).toString(16));
    }
  } else if (ip.includes(":")) {
    // Standard colon notation — expand :: to full 8 groups first
    const halves = ip.split("::");
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves[1] ? halves[1].split(":") : [];
      const fill = 8 - left.length - right.length;
      groups = [...left, ...Array(fill).fill("0"), ...right];
    } else {
      groups = ip.split(":");
    }
    // Strip leading zeros from each group
    groups = groups.map((g) => (parseInt(g, 16) || 0).toString(16));
  } else {
    // IPv4 or unknown — return as-is
    return ip;
  }

  // Find longest run of consecutive "0" groups (RFC 5952: use :: for first longest)
  let bestStart = -1,
    bestLen = 0,
    curStart = -1,
    curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  // Collapse the longest zero run into ::
  if (bestLen >= 2) {
    const left = groups.slice(0, bestStart).join(":");
    const right = groups.slice(bestStart + bestLen).join(":");
    if (!left && !right) return "::";
    if (!left) return "::" + right;
    if (!right) return left + "::";
    return left + "::" + right;
  }

  return groups.join(":");
}

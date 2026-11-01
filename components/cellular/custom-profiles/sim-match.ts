import { canonicalizeIccid, iccidMatches } from "@/lib/carrier-match";

/**
 * Bound to a SIM other than the live one. Both sides must be known: an empty
 * binding is SIM-agnostic and an unread live ICCID is "don't know".
 */
export function iccidMismatch(
  profileIccid: string | null | undefined,
  currentIccid: string | null | undefined,
): boolean {
  if (!canonicalizeIccid(profileIccid) || !canonicalizeIccid(currentIccid)) {
    return false;
  }
  return !iccidMatches(profileIccid, currentIccid);
}

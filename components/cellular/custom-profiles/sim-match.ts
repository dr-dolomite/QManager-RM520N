import { canonicalizeIccid, iccidMatches } from "@/lib/carrier-match";

/** Bound to a SIM other than the live one; both sides must be known (empty binding is SIM-agnostic, unread
 * ICCID is unknown). */
export function iccidMismatch(
  profileIccid: string | null | undefined,
  currentIccid: string | null | undefined,
): boolean {
  if (!canonicalizeIccid(profileIccid) || !canonicalizeIccid(currentIccid)) {
    return false;
  }
  return !iccidMatches(profileIccid, currentIccid);
}

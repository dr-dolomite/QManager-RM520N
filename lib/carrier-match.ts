// =============================================================================
// carrier-match.ts — PLMN → profile-suggestion matching (pure)
// =============================================================================
// Deliberately pure: no React, no fetch, no module-level state. The only live
// test device runs a GLOBE SIM (MCC 515), so the T-Mobile path can never be
// exercised end-to-end on hardware. Keeping this a plain function of (mcc, mnc)
// is what makes it verifiable off-device.
//
// A PLMN is the carrier's numeric identity broadcast by the network: MCC
// (mobile country code, always 3 digits, 310 = USA) plus MNC (mobile network
// code, 2 or 3 digits, which network within that country). AT+QSPN reports it
// as one concatenated string, so the MNC arrives with inconsistent width and
// sometimes a leading zero.
// =============================================================================

import {
  PROFILE_SUGGESTIONS,
  type ProfileSuggestion,
} from "@/constants/profile-suggestions";

/** USA. */
export const MCC_US = "310";

/**
 * T-Mobile US network codes under MCC 310.
 *
 * Kept exported and flat so it can be inspected and asserted against directly.
 * Stored canonically (leading zeros stripped) — compare via
 * {@link normalizeMnc}, never with a raw string equality check.
 */
export const TMOBILE_US_MNCS: readonly string[] = [
  "260",
  "160",
  "200",
  "210",
  "220",
  "230",
  "240",
  "250",
  "270",
  "310",
  "490",
  "660",
  "800",
];

/**
 * Canonicalize an MNC for comparison.
 *
 * AT+QSPN can hand back `"02"`, `"2"`, or `"002"` for the same network
 * depending on firmware and PLMN width, so a literal compare produces false
 * negatives. Digits only; leading zeros dropped; `""` for anything unusable.
 */
export function normalizeMnc(mnc: string): string {
  const digits = (mnc ?? "").trim().replace(/\D/g, "");
  if (digits === "") return "";
  const stripped = digits.replace(/^0+/, "");
  // All-zero input ("000") collapses to empty above; keep a single "0".
  return stripped === "" ? "0" : stripped;
}

/** Canonicalize an MCC: digits only, trimmed. MCCs are fixed-width, no strip. */
export function normalizeMcc(mcc: string): string {
  return (mcc ?? "").trim().replace(/\D/g, "");
}

/** True when the PLMN identifies a T-Mobile US network. */
export function isTMobileUs(mcc: string, mnc: string): boolean {
  if (normalizeMcc(mcc) !== MCC_US) return false;
  const n = normalizeMnc(mnc);
  if (n === "") return false;
  return TMOBILE_US_MNCS.some((allowed) => normalizeMnc(allowed) === n);
}

/**
 * Return the profile suggestions that apply to a PLMN.
 *
 * Returns `[]` for every carrier we have no recipe for — an unmatched SIM
 * simply renders no suggestions section, never a guess.
 */
export function matchCarrierSuggestions(
  mcc: string,
  mnc: string,
): ProfileSuggestion[] {
  if (isTMobileUs(mcc, mnc)) {
    return PROFILE_SUGGESTIONS.filter(
      (s) => s.id === "tmobile" || s.id === "tmobile_home",
    );
  }
  return [];
}

// --- ICCID canonicalization --------------------------------------------------

/**
 * Canonicalize an ICCID the way the backend does (`sim_db.sh::iccid_canonicalize`).
 *
 * SIM ICCIDs are stored on the card in BCD (binary-coded decimal), which packs
 * two digits per byte. An odd-length ICCID therefore gets a padding nibble,
 * which surfaces as a trailing `F`. Different AT paths strip it inconsistently,
 * so the same card can read back as `8901…12` or `8901…12F`.
 *
 * Trim whitespace/CR/LF, then drop a single trailing `F`/`f`. This must stay in
 * lockstep with the shell implementation — a divergence would make the client
 * think a SIM has no profile when the backend knows it does.
 */
export function canonicalizeIccid(iccid: string | null | undefined): string {
  const trimmed = (iccid ?? "").replace(/[\s\r\n]/g, "");
  return trimmed.replace(/[Ff]$/, "");
}

/** True when two ICCIDs refer to the same SIM. Empty never matches. */
export function iccidMatches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = canonicalizeIccid(a);
  const cb = canonicalizeIccid(b);
  return ca !== "" && ca === cb;
}

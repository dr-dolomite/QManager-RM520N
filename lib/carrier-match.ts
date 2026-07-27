// =============================================================================
// carrier-match.ts — PLMN → profile-suggestion matching (pure)
// =============================================================================
// Deliberately pure: no React, no fetch, no module-level state. The only live
// test device runs a GLOBE SIM (MCC 515), so the US branches can never be
// exercised end-to-end on hardware. Keeping this a plain function of
// (mcc, mnc, spn, networkName) is what makes it verifiable off-device.
//
// A PLMN is the carrier's numeric identity broadcast by the network: MCC
// (mobile country code, always 3 digits — 310/311 = USA, 515 = Philippines)
// plus MNC (mobile network code, 2 or 3 digits, which network within that
// country). AT+QSPN reports it as one concatenated string, so the MNC arrives
// with inconsistent width and sometimes a leading zero.
//
// -----------------------------------------------------------------------------
// Why PLMN alone is not enough: MVNOs
// -----------------------------------------------------------------------------
// An MVNO (Mobile Virtual Network Operator — Mint, Google Fi, Visible, Cricket)
// owns no towers. It resells a host network's radio access. So every
// NETWORK-broadcast identifier truthfully reports the host: a Mint SIM really
// is on T-Mobile's network and really does broadcast T-Mobile's PLMN. No
// amount of network-side probing can separate them.
//
// The one identity the reseller controls is on the SIM itself. AT+QSPN returns
// two SIM-provisioned names:
//
//   network_name (EF_PNN) — names the NETWORK. Usually the host's name.
//   spn          (EF_SPN) — names the SERVICE PROVIDER, i.e. who sold the SIM.
//                           This is where an MVNO brands itself.
//
// So the model is: PLMN is the GATE (it establishes the match), and the SPN
// denylist is a REFINEMENT (it can only remove a match, never create one).
// That asymmetry is deliberate — EF_SPN is an optional file, and plenty of
// legitimate SIMs leave it blank or copy the network name into it. Requiring a
// positive SPN match would silently kill suggestions for all of those.
// =============================================================================

import {
  PROFILE_SUGGESTIONS,
  type ProfileSuggestion,
} from "@/constants/profile-suggestions";

/** USA. Retained as a named constant — but it is not the only US MCC (see 311). */
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
 *
 * This does NOT make `"26"` and `"260"` equivalent — those are genuinely
 * different networks. Only LEADING zeros are insignificant.
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

// -----------------------------------------------------------------------------
// PLMN table
// -----------------------------------------------------------------------------

/** One carrier's PLMN footprint and the suggestions it unlocks. */
export interface PlmnEntry {
  /** Mobile country code. */
  mcc: string;
  /** Network codes under that MCC. Compared via normalizeMnc. */
  mncs: readonly string[];
  /** Suggestion ids from PROFILE_SUGGESTIONS to offer for this carrier. */
  suggestionIds: readonly string[];
}

/**
 * Carrier PLMN table.
 *
 * Every entry whose PLMN matches contributes its suggestion ids, so two
 * entries sharing a PLMN (Globe/GOMO) simply both apply. Only PLMNs we are
 * confident about are listed — a carrier's secondary or legacy codes are
 * omitted rather than guessed, because a wrong entry shows a real user the
 * wrong APN, while a missing one merely shows nothing.
 */
export const PLMN_TABLE: readonly PlmnEntry[] = [
  // --- T-Mobile US -----------------------------------------------------------
  {
    mcc: "310",
    mncs: TMOBILE_US_MNCS,
    suggestionIds: ["tmobile", "tmobile_home"],
  },

  // --- AT&T ------------------------------------------------------------------
  // 410 is the primary; the rest are long-established AT&T/Cingular codes.
  {
    mcc: "310",
    mncs: ["410", "150", "170", "280", "380", "560", "680", "090", "980"],
    suggestionIds: ["att"],
  },
  { mcc: "311", mncs: ["180"], suggestionIds: ["att"] },

  // --- Verizon ---------------------------------------------------------------
  // Verizon's PRIMARY PLMN is 311-480 — MCC 311, not 310. That is precisely
  // why the matcher had to stop being a function of MCC_US.
  // 311-270..289 is Verizon's contiguous allocation block.
  {
    mcc: "311",
    mncs: [
      "480",
      "110",
      "270",
      "271",
      "272",
      "273",
      "274",
      "275",
      "276",
      "277",
      "278",
      "279",
      "280",
      "281",
      "282",
      "283",
      "284",
      "285",
      "286",
      "287",
      "288",
      "289",
    ],
    suggestionIds: ["verizon"],
  },
  { mcc: "310", mncs: ["004", "010", "012", "013"], suggestionIds: ["verizon"] },

  // --- Philippines -----------------------------------------------------------
  // Smart: 515-03 is Smart Communications; 515-05 is Sun Cellular, Smart-owned
  // and sharing the same data APN.
  { mcc: "515", mncs: ["03", "05"], suggestionIds: ["smart"] },
  // Globe: 515-02 is Globe Telecom, 515-01 is Islacom (a Globe subsidiary).
  // GOMO is Globe's digital brand on the SAME PLMN, so both suggestions ride
  // this single entry and the user chooses between them.
  { mcc: "515", mncs: ["02", "01"], suggestionIds: ["globe", "gomo"] },
  // DITO Telecommunity.
  { mcc: "515", mncs: ["66"], suggestionIds: ["dito"] },
];

// -----------------------------------------------------------------------------
// MVNO denylist
// -----------------------------------------------------------------------------

/**
 * Normalize a carrier name for denylist comparison: lowercase, then strip
 * everything that is not a letter or digit. `"US Mobile"`, `"us-mobile"` and
 * `"USMobile"` all collapse to `"usmobile"`.
 */
export function normalizeCarrierName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * SIM-provisioned names that identify a reseller rather than the host network.
 *
 * Matched by EXACT normalized equality — never substring or prefix. A
 * substring test would be actively dangerous here: `"mobile"` occurs inside
 * `"tmobile"`, so a loose match against any `*mobile*` reseller would suppress
 * suggestions for the host carrier itself. Exact matching means a name we have
 * never seen falls through and is treated as the host, which is the safe
 * direction to fail — the worst case is today's behaviour.
 *
 * These are brands whose APN differs from their host's. Some are host-owned
 * sub-brands rather than true MVNOs (Metro, Cricket, Visible); the distinction
 * does not matter here — what matters is that the host's APN is wrong for them.
 */
export const MVNO_SPN_DENYLIST: ReadonlySet<string> = new Set([
  // On T-Mobile
  "mint",
  "mintmobile",
  "googlefi",
  "finetwork",
  "usmobile",
  "metro",
  "metropcs",
  "metrobytmobile",
  "ultra",
  "ultramobile",
  "tello",
  "connectbytmobile",
  "simplemobile",
  "lycamobile",
  "familymobile",
  "walmartfamilymobile",
  "genmobile",
  "teltik",
  "boost",
  "boostmobile",
  // On Verizon
  "visible",
  "totalwireless",
  "totalbyverizon",
  "tracfone",
  "xfinity",
  "xfinitymobile",
  "spectrum",
  "spectrummobile",
  // On AT&T
  "cricket",
  "cricketwireless",
  "h2o",
  "h2owireless",
  "puretalk",
  "consumercellular",
  "redpocket",
  // Multi-host
  "straighttalk",
  "net10",
]);

/**
 * True when either SIM-provisioned name identifies a known reseller.
 *
 * Both names are checked because EF_SPN is optional — some resellers brand
 * only via EF_PNN, which surfaces as `network_name`.
 */
export function isKnownMvno(
  spn: string | null | undefined,
  networkName: string | null | undefined,
): boolean {
  const s = normalizeCarrierName(spn);
  const n = normalizeCarrierName(networkName);
  if (s !== "" && MVNO_SPN_DENYLIST.has(s)) return true;
  if (n !== "" && MVNO_SPN_DENYLIST.has(n)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

/** True when the PLMN identifies a T-Mobile US network. */
export function isTMobileUs(mcc: string, mnc: string): boolean {
  if (normalizeMcc(mcc) !== MCC_US) return false;
  const n = normalizeMnc(mnc);
  if (n === "") return false;
  return TMOBILE_US_MNCS.some((allowed) => normalizeMnc(allowed) === n);
}

/** Suggestion ids the PLMN table yields for a PLMN, in table order. */
export function matchPlmn(mcc: string, mnc: string): string[] {
  const m = normalizeMcc(mcc);
  const n = normalizeMnc(mnc);
  if (m === "" || n === "") return [];

  const ids: string[] = [];
  for (const entry of PLMN_TABLE) {
    if (entry.mcc !== m) continue;
    if (!entry.mncs.some((candidate) => normalizeMnc(candidate) === n)) continue;
    for (const id of entry.suggestionIds) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Return the profile suggestions that apply to a SIM.
 *
 * @param mcc         Mobile country code from current_settings.sh.
 * @param mnc         Mobile network code from current_settings.sh.
 * @param spn         EF_SPN service-provider name. Optional.
 * @param networkName EF_PNN full network name. Optional.
 *
 * Returns `[]` for every carrier we have no recipe for — an unmatched SIM
 * renders no suggestions section, never a guess — and `[]` when the SIM names
 * a known reseller, whose APN would differ from its host's.
 *
 * Results come back in PROFILE_SUGGESTIONS order rather than table order, so
 * display ordering stays a property of the recipe list.
 */
export function matchCarrierSuggestions(
  mcc: string,
  mnc: string,
  spn?: string | null,
  networkName?: string | null,
): ProfileSuggestion[] {
  const ids = matchPlmn(mcc, mnc);
  if (ids.length === 0) return [];
  // Applied AFTER the PLMN gate, so an unrecognized SIM name on an unmatched
  // network costs nothing — and so the denylist can never be the reason a
  // suggestion appears, only a reason one disappears.
  if (isKnownMvno(spn, networkName)) return [];
  return PROFILE_SUGGESTIONS.filter((s) => ids.includes(s.id));
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

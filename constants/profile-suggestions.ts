// =============================================================================
// profile-suggestions.ts — Carrier-Recommended SIM Profile Suggestions
// =============================================================================
// Suggestions are *not* saved profiles. They are recommended starting
// configurations surfaced when the inserted SIM's PLMN matches a carrier we
// have a known-good recipe for, and they only ever become real state when the
// user presses Create (see hooks/use-profile-suggestions.ts).
//
// Relationship to MNO_PRESETS (constants/mno-presets.ts): deliberately none.
// The presets feed the profile form's carrier dropdown and carry their own
// (sometimes intentionally zeroed) TTL/HL values. Suggestions carry the values
// we actually recommend for the carrier, independently. Do not couple them.
//
// To add a carrier: append a suggestion here AND add its MCC/MNC to the
// allowlist in lib/carrier-match.ts. Both halves are required — a suggestion no
// matcher returns is dead code, and a match with no suggestion renders nothing.
// =============================================================================

/**
 * One recommended profile configuration.
 *
 * Bands are plain numbers here. Conversion to the backend's colon-delimited
 * string form (`"25:41:66:71"`) happens once, at the write boundary in
 * `useProfileSuggestions`, after intersecting against the bands the modem
 * actually reports as supported.
 */
export interface ProfileSuggestion {
  /** Stable suggestion key. NOT a profile id — nothing with this id exists. */
  id: string;
  /** i18n-independent carrier/plan label used as the created profile's name. */
  label: string;
  /** Carrier name written to the profile's `mno` field. */
  mno: string;
  /** APN to configure. */
  apn_name: string;
  /** PDP type for the APN context. */
  pdp_type: "IP" | "IPV6" | "IPV4V6";
  /** APN context id. */
  cid: number;
  /** IPv4 TTL to set (0 = leave unchanged). */
  ttl: number;
  /** IPv6 hop limit to set (0 = leave unchanged). */
  hl: number;
  /** Recommended NR5G NSA bands. Intersected with modem support before use. */
  nsa_nr_bands: number[];
  /** Recommended NR5G SA bands. Intersected with modem support before use. */
  sa_nr_bands: number[];
}

/** T-Mobile US mid-band + low-band 5G set shared by both suggestions. */
const TMOBILE_NR_BANDS = [25, 41, 66, 71];

/**
 * Name of the shared connection scenario the T-Mobile suggestions bind to.
 * Matched by exact name so a second Create reuses the scenario instead of
 * minting a duplicate (scenarios are capped at 20 on the device).
 */
export const TMOBILE_SCENARIO_NAME = "T-Mobile Recommended Bands";

export const PROFILE_SUGGESTIONS: ProfileSuggestion[] = [
  {
    id: "tmobile",
    label: "T-Mobile",
    mno: "T-Mobile",
    apn_name: "fast.t-mobile.com",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: TMOBILE_NR_BANDS,
    sa_nr_bands: TMOBILE_NR_BANDS,
  },
  {
    id: "tmobile_home",
    label: "T-Mobile Home Internet (TMHI)",
    mno: "T-Mobile",
    apn_name: "fbb.home",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: TMOBILE_NR_BANDS,
    sa_nr_bands: TMOBILE_NR_BANDS,
  },
];

/** Look up a suggestion by its key. */
export function getProfileSuggestion(
  id: string,
): ProfileSuggestion | undefined {
  return PROFILE_SUGGESTIONS.find((s) => s.id === id);
}

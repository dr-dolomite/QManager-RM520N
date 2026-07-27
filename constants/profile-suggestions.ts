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
// To add a carrier: append a suggestion here AND add its PLMN to the table in
// lib/carrier-match.ts. Both halves are required — a suggestion no matcher
// returns is dead code, and a match with no suggestion renders nothing.
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
  /**
   * Name of the connection scenario this suggestion binds to.
   *
   * Present ONLY when the suggestion recommends band locks. A suggestion with
   * no bands must leave this undefined so the create path skips scenario
   * creation entirely — see the `scenario_name` note in
   * hooks/use-profile-suggestions.ts for why that matters.
   */
  scenario_name?: string;
  /**
   * True when this suggestion shares its PLMN with a sibling suggestion, so
   * the two cannot be told apart over the air and the user must choose.
   *
   * Currently: T-Mobile vs TMHI (both 310-260), Globe vs GOMO (both 515-02).
   * Drives the "we can't detect which plan you have" note in the UI, rendered
   * only when a visible suggestion carries this flag — an unambiguous single
   * match should not warn about a choice that isn't there.
   */
  ambiguous_plan?: boolean;
}

/** T-Mobile US mid-band + low-band 5G set shared by both T-Mobile suggestions. */
const TMOBILE_NR_BANDS = [25, 41, 66, 71];

/**
 * Name of the shared connection scenario the T-Mobile suggestions bind to.
 * Matched by exact name so a second Create reuses the scenario instead of
 * minting a duplicate (scenarios are capped at 20 on the device).
 */
export const TMOBILE_SCENARIO_NAME = "T-Mobile Recommended Bands";

// -----------------------------------------------------------------------------
// The recipes.
// -----------------------------------------------------------------------------
// Only the T-Mobile pair carries band locks. Every other carrier here is
// APN + TTL/HL only, deliberately: we have no verified band recommendation for
// them, and a band lock is a NARROWING operation. Guessing one would be
// actively harmful — and it would bind a `custom-*` scenario, which disables
// the Band Locking page and removes the user's own route to undoing it.
//
// TTL/HL 64 across the board is intentional and independent of MNO_PRESETS,
// several of which store 0 (leave unchanged) for the same carrier.
// -----------------------------------------------------------------------------
export const PROFILE_SUGGESTIONS: ProfileSuggestion[] = [
  // --- United States ---------------------------------------------------------
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
    scenario_name: TMOBILE_SCENARIO_NAME,
    ambiguous_plan: true,
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
    scenario_name: TMOBILE_SCENARIO_NAME,
    ambiguous_plan: true,
  },
  {
    id: "verizon",
    label: "Verizon",
    mno: "Verizon",
    apn_name: "vzwinternet",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
  },
  {
    id: "att",
    label: "AT&T",
    mno: "AT&T",
    // Matches the `att_5g_phone` MNO preset. This is AT&T's phone APN, not a
    // dedicated fixed-wireless one — it is what the preset has always carried.
    apn_name: "enhancedphone",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
  },

  // --- Philippines -----------------------------------------------------------
  {
    id: "smart",
    label: "Smart",
    mno: "Smart",
    apn_name: "SMARTLTE",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
  },
  {
    id: "globe",
    label: "Globe",
    mno: "Globe",
    apn_name: "internet.globe.com.ph",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
    // GOMO is Globe's own digital brand riding the same PLMN (515-02), so the
    // two are indistinguishable over the air — the same situation as T-Mobile
    // vs TMHI. Both are shown and the user picks.
    ambiguous_plan: true,
  },
  {
    id: "gomo",
    label: "GOMO",
    mno: "GOMO",
    apn_name: "gomo.ph",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
    ambiguous_plan: true,
  },
  {
    id: "dito",
    label: "DITO",
    mno: "DITO",
    apn_name: "internet.dito.ph",
    pdp_type: "IPV4V6",
    cid: 1,
    ttl: 64,
    hl: 64,
    nsa_nr_bands: [],
    sa_nr_bands: [],
  },
];

/** Look up a suggestion by its key. */
export function getProfileSuggestion(
  id: string,
): ProfileSuggestion | undefined {
  return PROFILE_SUGGESTIONS.find((s) => s.id === id);
}

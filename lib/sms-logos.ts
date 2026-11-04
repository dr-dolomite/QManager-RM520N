// =============================================================================
// sms-logos.ts — the curated sender-logo domain map (SMS Center)
// =============================================================================
// A one-way lookup from a RESOLVED sender name (see `sms-identity.ts`, tiers
// "network" / "decoded" / "directory") to the domain the sender disc draws a
// brand mark for (`components/ui/brand-mark.tsx`). Precedent:
// `lib/sms-directory.ts` — same reasoning applies here.
//
// ## Why it lives in the frontend bundle
//
// A static lookup table only the browser reads has no business on the
// device's flash. It ships in the static export instead.
//
// ## Privacy invariant
//
// The brand mark may fetch a logo from a third party (Hunter, Google s2; see
// `lib/logo-store.ts`), and the ONLY thing that ever leaves the browser is a
// domain string this file resolves. A sender
// ID, a phone number or message content never reaches the network: an unmatched
// sender simply gets initials. Do not add a code path that sends anything else.
//
// ## The rule this file must never break
//
// **No guessing.** Matching is exact-normalized-string only — no partial or
// substring matching, no fuzzy matching, no "starts with". A wrong or loose
// match here renders another company's brand mark over a real sender's
// message, which is strictly worse than showing initials. When in doubt,
// leave it out.
//
// ## Why a real logo is shown at all, given a sender ID is spoofable
//
// `sms-identity.ts` has always refused to hash a carrier's real brand colour
// onto the identity disc, because a sender ID is trivially spoofed and a
// brand-coloured disc would read as an implied endorsement. On 2026-09-24 the
// product decision (recorded in that file's header) was to show the REAL logo
// image anyway when this table resolves one, because Filipino subscribers
// already recognize these marks and initials-only discs made legitimate bank
// and government SMS harder to tell apart from spam at a glance. The
// mitigation is NOT "don't show the logo" — it's the phishing warning row
// (`sms-conversation.tsx`, `sms-format.ts::containsSuspiciousLink`) that
// appears under any inbound message containing a link, spelling out that a
// sender name (and, by the same logic, a logo) can be faked.
//
// ## Adding an entry
//
// Only a name you can point at a real published brand for, in the Philippines
// market (the reference device's SIM market). One row per organization;
// aliases cover common alternate spellings a sender ID might actually arrive
// as, not creative guesses.
//
// KEEP SORTED BY NAME (case-insensitive) so two people adding a row in the
// same week do not collide at the end of the list.
//
// ## Deliberately omitted
//
// - **TNT** — a Smart Communications sub-brand, but a DISTINCT one. It must
//   never resolve to Smart's logo; there is no published TNT mark to fetch
//   instead, so it is left out rather than mis-mapped.
// - **NDRRMC** — the national disaster-alert sender. No published logo
//   upstream at the time this table was written.
// - **NTC** — the National Telecommunications Commission (regulatory SMS
//   blasts). No published logo upstream at the time this table was written.
// =============================================================================

export interface SmsLogoEntry {
  /** Canonical display name — must match a resolved `SmsIdentity.title`. */
  name: string;
  /** Domain the brand mark is drawn for (the only value that ever leaves the browser). */
  domain: string;
  /** Alternate spellings a resolved sender name might actually arrive as. */
  aliases: string[];
  /** Where the domain was taken from, so a future editor can re-verify it. */
  source: string;
}

export const SMS_LOGO_MAP: SmsLogoEntry[] = [
  { name: "BDO", domain: "bdo.com.ph", aliases: ["BDO Deals"], source: "PH bank" },
  { name: "BIR", domain: "bir.gov.ph", aliases: [], source: "PH government agency" },
  { name: "BPI", domain: "bpi.com.ph", aliases: [], source: "PH bank" },
  { name: "COMELEC", domain: "comelec.gov.ph", aliases: [], source: "PH government agency" },
  { name: "DFA", domain: "dfa.gov.ph", aliases: [], source: "PH government agency" },
  { name: "DICT", domain: "dict.gov.ph", aliases: [], source: "PH government agency" },
  { name: "DITO", domain: "dito.ph", aliases: [], source: "PH telco" },
  { name: "DOH", domain: "doh.gov.ph", aliases: [], source: "PH government agency" },
  { name: "DSWD", domain: "dswd.gov.ph", aliases: [], source: "PH government agency" },
  { name: "foodpanda", domain: "foodpanda.ph", aliases: [], source: "PH commerce/delivery" },
  { name: "GCash", domain: "gcash.com", aliases: [], source: "PH e-wallet" },
  { name: "Globe", domain: "globe.com.ph", aliases: [], source: "PH telco" },
  {
    name: "GoTyme",
    domain: "gotyme.com.ph",
    aliases: ["GoTyme Bank"],
    source: "PH bank",
  },
  { name: "Grab", domain: "grab.com", aliases: [], source: "PH commerce/ride-hailing" },
  { name: "GSIS", domain: "gsis.gov.ph", aliases: [], source: "PH government agency" },
  { name: "Landbank", domain: "landbank.com", aliases: ["LANDBANK"], source: "PH bank" },
  { name: "Lazada", domain: "lazada.com.ph", aliases: [], source: "PH commerce" },
  { name: "LTO", domain: "lto.gov.ph", aliases: [], source: "PH government agency" },
  { name: "Maya", domain: "maya.ph", aliases: ["PayMaya"], source: "PH e-wallet" },
  { name: "Meralco", domain: "meralco.com.ph", aliases: [], source: "PH utility" },
  { name: "Metrobank", domain: "metrobank.com.ph", aliases: [], source: "PH bank" },
  { name: "MMDA", domain: "mmda.gov.ph", aliases: [], source: "PH government agency" },
  {
    name: "Pag-IBIG",
    domain: "pagibigfund.gov.ph",
    aliases: ["PAGIBIG Fund"],
    source: "PH government agency",
  },
  { name: "PAGASA", domain: "pagasa.dost.gov.ph", aliases: [], source: "PH government agency" },
  { name: "PhilHealth", domain: "philhealth.gov.ph", aliases: [], source: "PH government agency" },
  {
    name: "PLDT",
    domain: "pldt.com",
    aliases: ["PLDTDeals", "PLDTHome", "PLDTUpgrade"],
    source: "PH telco (sender IDs seen live 2026-10)",
  },
  { name: "PSA", domain: "psa.gov.ph", aliases: [], source: "PH government agency" },
  { name: "SeaBank", domain: "seabank.ph", aliases: [], source: "PH bank" },
  { name: "Shopee", domain: "shopee.ph", aliases: [], source: "PH commerce" },
  {
    name: "Smart",
    domain: "smart.com.ph",
    aliases: ["SMART", "SmartApp", "SMARTLoad"],
    source: "PH telco (sender IDs seen live 2026-10)",
  },
  { name: "SSS", domain: "sss.gov.ph", aliases: [], source: "PH government agency" },
  {
    name: "UnionBank",
    domain: "unionbankph.com",
    aliases: ["UnionBankPH"],
    source: "PH bank",
  },
];

/** Lowercase, alphanumeric-only — the exact key both names and aliases hash into. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index built once at module load; lookups are O(1) per row rendered. */
const BY_KEY = new Map<string, SmsLogoEntry>();
for (const entry of SMS_LOGO_MAP) {
  BY_KEY.set(normalize(entry.name), entry);
  for (const alias of entry.aliases) {
    BY_KEY.set(normalize(alias), entry);
  }
}

/**
 * Look up the logo domain for a RESOLVED sender title (never the raw
 * address — see `sms-identity.ts::resolveSmsIdentity`, which is the only
 * call site).
 *
 * Exact match only, against the name or any alias, both normalized the same
 * way. Returns `null` for anything that doesn't match — no partial/substring
 * matching, ever (see the header above).
 */
export function lookupSmsLogoDomain(title: string): string | null {
  if (!title) return null;
  const hit = BY_KEY.get(normalize(title));
  return hit ? hit.domain : null;
}

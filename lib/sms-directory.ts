// =============================================================================
// sms-directory.ts — the shipped short-code directory (identity tier 3)
// =============================================================================
// The fourth and weakest tier of the sender-identity ladder, and the only one
// that is not the device's own word. Tier 1 is a clean alphanumeric sender ID
// the network sent verbatim (`display_source: "network"`); tier 2 is a mangled
// ID the backend un-mangled (`"decoded"`); this file is tier 3 (`"directory"`);
// tier 4 is the raw address, formatted but never renamed (`"raw"`).
//
// ## Why it lives in the frontend bundle
//
// Precedent: `components/local-network/settings/dns-providers.ts`. A table of
// static strings that only the browser ever reads has no business on the
// device's flash. It ships in the static export instead — zero device
// footprint, and adding an entry is a one-line edit here with no deploy of any
// shell script.
//
// ## The rule this file must never break
//
// **It only ever fills a gap. It never overwrites the device's own answer.**
// `resolveDirectoryName()` returns a match ONLY when nothing resolved upstream
// — i.e. `display_source` is `"raw"` or absent AND `display_name` is still the
// raw address. A `network` or `decoded` name is what the carrier actually put
// on the wire; a local lookup table is a guess about it, and a guess never wins
// against evidence (PRODUCT.md > honesty).
// The UI marks a directory hit differently from a network-supplied name for the
// same reason, and the raw address stays on screen either way.
//
// ## Adding an entry
//
// Numeric short codes only, and only ones you can point at a published source
// for. A wrong entry here renders a confident, wrong brand name over a real
// message — strictly worse than showing the number. When in doubt, leave it
// out: tier 4 renders the address honestly and costs the user nothing.
//
// Names are proper nouns and are deliberately NOT i18n keys.
// =============================================================================

import type { SmsAddrKind } from "@/types/sms";

export interface SmsDirectoryEntry {
  /** The stored short code, digits only, no punctuation. */
  code: string;
  /** Display name (proper noun — not translated). */
  name: string;
  /** Where the mapping was taken from, so a future editor can re-verify it. */
  source: string;
}

/**
 * Seed list. Deliberately short: see "Adding an entry" above. Every row below
 * is a carrier- or issuer-published subscriber SMS short code for the
 * Philippines, which is the market the reference device is on.
 *
 * KEEP SORTED BY CODE so two people adding a row in the same week do not
 * collide at the end of the list.
 */
export const SMS_DIRECTORY: SmsDirectoryEntry[] = [
  { code: "143", name: "Globe", source: "Globe free-services short code" },
  { code: "211", name: "Smart", source: "Smart subscriber SMS hotline" },
  { code: "2600", name: "Globe", source: "Globe load and promo short code" },
  { code: "2882", name: "GCash", source: "GCash subscriber SMS short code" },
  { code: "8080", name: "Globe", source: "Globe subscriber SMS hotline" },
];

/** Index built once at module load; lookups are O(1) per row rendered. */
const BY_CODE = new Map(SMS_DIRECTORY.map((e) => [e.code, e]));

/**
 * Classify a raw stored address when the backend did not send `addr_kind`.
 *
 * Mirrors the backend's own rule verbatim (`cellular/sms.sh`): alphanumeric if a non-digit survives an
 * optional leading `+`; short code if all digits and at most 6 long; MSISDN
 * otherwise. Kept here so the surface behaves identically against an old
 * backend envelope that omits the field.
 */
export function classifyAddr(addr: string): SmsAddrKind {
  const body = addr.startsWith("+") ? addr.slice(1) : addr;
  if (body.length === 0 || /\D/.test(body)) return "alphanumeric";
  return body.length <= 6 ? "shortcode" : "msisdn";
}

/**
 * Look up a display name for a raw stored address.
 *
 * Returns `null` for anything that is not a bare numeric short code — the
 * table has no business renaming a full MSISDN, and an alphanumeric address is
 * already the network's own text.
 *
 * This function does NOT decide whether the directory is allowed to apply.
 * That gate lives at the single call site in `sms-identity.ts`, where the
 * upstream `display_source` is in scope.
 */
export function lookupSmsDirectory(addr: string): SmsDirectoryEntry | null {
  const code = addr.startsWith("+") ? addr.slice(1) : addr;
  if (!code || /\D/.test(code)) return null;
  return BY_CODE.get(code) ?? null;
}

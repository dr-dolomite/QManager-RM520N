// =============================================================================
// dns-providers.ts — Built-in Custom DNS provider presets
// =============================================================================
// Each preset carries a dual-stack address pair (two IPv4 + two IPv6). Selecting
// a provider in the card fills the form fields; "Custom" lets the user type their
// own. Brand names are intentionally NOT i18n keys — they are proper nouns.
//
// Sources are the providers' published anycast resolver addresses.
// =============================================================================

export interface DnsProvider {
  /** Stable id used as the Select value and for round-trip matching. */
  id: string;
  /** Display name (proper noun — not translated). */
  name: string;
  /** [primary, secondary] IPv4 resolvers. */
  ipv4: [string, string];
  /** [primary, secondary] IPv6 resolvers. */
  ipv6: [string, string];
}

/** Sentinel id for the user-supplied "Custom" option. */
export const CUSTOM_PROVIDER_ID = "custom";

export const DNS_PROVIDERS: DnsProvider[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    ipv4: ["1.1.1.1", "1.0.0.1"],
    ipv6: ["2606:4700:4700::1111", "2606:4700:4700::1001"],
  },
  {
    id: "google",
    name: "Google",
    ipv4: ["8.8.8.8", "8.8.4.4"],
    ipv6: ["2001:4860:4860::8888", "2001:4860:4860::8844"],
  },
  {
    id: "quad9",
    name: "Quad9",
    ipv4: ["9.9.9.9", "149.112.112.112"],
    ipv6: ["2620:fe::fe", "2620:fe::9"],
  },
  {
    id: "adguard",
    name: "AdGuard",
    ipv4: ["94.140.14.14", "94.140.15.15"],
    ipv6: ["2a10:50c0::ad1:ff", "2a10:50c0::ad2:ff"],
  },
  {
    id: "controld",
    name: "ControlD",
    ipv4: ["76.76.2.0", "76.76.10.0"],
    ipv6: ["2606:1a40::", "2606:1a40:1::"],
  },
];

/**
 * Normalize an IPv6 literal for equality comparison. Lowercases and collapses
 * a trailing "::" so e.g. "2606:1A40::" and "2606:1a40::" match. Deliberately
 * light — it only needs to recognise our own preset values on round-trip.
 */
function normV6(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Given the current four primary/secondary addresses, return the matching
 * provider id, or CUSTOM_PROVIDER_ID when no preset matches exactly. Matching is
 * order-sensitive on the pairs (primary→primary), which is how presets fill.
 * Empty tertiary IPv4 is required for a preset match — presets only define two.
 */
export function matchProvider(
  dns1: string,
  dns2: string,
  dns3: string,
  dns1v6: string,
  dns2v6: string,
): string {
  if (dns3) return CUSTOM_PROVIDER_ID;
  for (const p of DNS_PROVIDERS) {
    if (
      dns1 === p.ipv4[0] &&
      dns2 === p.ipv4[1] &&
      normV6(dns1v6) === normV6(p.ipv6[0]) &&
      normV6(dns2v6) === normV6(p.ipv6[1])
    ) {
      return p.id;
    }
  }
  return CUSTOM_PROVIDER_ID;
}

// One draft spans the three cards because the backend takes them in one POST.
// While off, `currentUpstream` holds the carrier's servers, so an Off baseline is blank.

import type { CustomDnsSettingsResponse } from "@/types/custom-dns";

import { CUSTOM_PROVIDER_ID, DNS_PROVIDERS, matchProvider } from "./dns-providers";

export type Family = "v4" | "v6";

/** The CGI's cap across both families. */
export const MAX_SERVERS = 4;
/** Slots a family shows by default; a saved list that is longer gets more. */
export const BASE_SLOTS = 2;

export interface Draft {
  enabled: boolean;
  ignoreCarrier: boolean;
  /** One entry per slot, in the order they are tried. */
  v4: string[];
  v6: string[];
  /** What the provider picker shows; the addresses are what gets sent. */
  provider: string;
}

const blanks = (n: number) => Array.from({ length: n }, () => "");

/** Pads a list to its family's slot count. */
function fit(list: string[], slots: number): string[] {
  return [...list, ...blanks(Math.max(0, slots - list.length))];
}

const familyOf = (address: string): Family => (address.includes(":") ? "v6" : "v4");

export function baselineFrom(data: CustomDnsSettingsResponse): Draft {
  if (!data.enabled) {
    return {
      enabled: false,
      ignoreCarrier: data.ignoreCarrier,
      v4: blanks(BASE_SLOTS),
      v6: blanks(BASE_SLOTS),
      provider: CUSTOM_PROVIDER_ID,
    };
  }
  const v4 = data.servers.filter((s) => familyOf(s) === "v4");
  const v6 = data.servers.filter((s) => familyOf(s) === "v6");
  const draft = {
    enabled: true,
    ignoreCarrier: data.ignoreCarrier,
    v4: fit(v4, BASE_SLOTS),
    v6: fit(v6, BASE_SLOTS),
  };
  return { ...draft, provider: providerFor(draft) };
}

/** A preset's addresses (keeping the slot counts), or nothing for Custom. */
export function presetFill(id: string, d: Pick<Draft, Family>): Partial<Draft> {
  const preset = DNS_PROVIDERS.find((p) => p.id === id);
  if (!preset) return { provider: CUSTOM_PROVIDER_ID };
  return {
    provider: id,
    v4: fit([...preset.ipv4], d.v4.length),
    v6: fit([...preset.ipv6], d.v6.length),
  };
}

/** Recomputes the picker after an address edit, so it never names a preset the list no longer is. */
export function providerFor(d: Pick<Draft, Family>): string {
  const v6Extra = d.v6.slice(2).join("").trim();
  if (v6Extra) return CUSTOM_PROVIDER_ID;
  return matchProvider(
    d.v4[0] ?? "",
    d.v4[1] ?? "",
    d.v4.slice(2).join("").trim(),
    d.v6[0] ?? "",
    d.v6[1] ?? "",
  );
}

/** What gets sent: IPv4 slots then IPv6 slots, trimmed, empties dropped. */
export function serversOf(d: Pick<Draft, Family>): string[] {
  return [...d.v4, ...d.v6].map((s) => s.trim()).filter((s) => s !== "");
}

export function hasAnyAddress(d: Pick<Draft, Family>): boolean {
  return serversOf(d).length > 0;
}

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

// Structural IPv6 check, close enough to the backend's gate that a malformed
// address never reaches it.
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/** Empty is valid: every slot is optional as long as one is filled. */
export function isValidAddress(family: Family, value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  return family === "v4" ? IPV4.test(v) : IPV6.test(v);
}

export function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v.trim() === b[i].trim());
}

import type { CarrierComponent, ModemStatus } from "@/types/modem-status";

export interface CarrierOption {
  type: "PCC" | "SCC";
  technology: "LTE" | "NR";
  band: string;
  bandNumber: number;
  earfcn: number;
  pci: number;
  rsrp: number | null;
}

function extractBandNumber(band: string): number | null {
  const match = band.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function buildOptionList(
  carriers: CarrierComponent[],
  technology: "LTE" | "NR",
): CarrierOption[] {
  const seen = new Set<string>();
  const filtered: CarrierOption[] = [];
  for (const c of carriers) {
    if (c.technology !== technology) continue;
    if (c.earfcn === null || c.pci === null) continue;
    const bandNumber = extractBandNumber(c.band);
    if (bandNumber === null) continue;
    const key = compositeValue(c.earfcn, c.pci);
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push({
      type: c.type,
      technology: c.technology,
      band: c.band,
      bandNumber,
      earfcn: c.earfcn,
      pci: c.pci,
      rsrp: c.rsrp,
    });
  }
  // Stable sort: PCC before SCC; preserve original order within each group.
  return filtered.sort((a, b) => {
    if (a.type === b.type) return 0;
    return a.type === "PCC" ? -1 : 1;
  });
}

export function lteCarriersFromQcainfo(modemData: ModemStatus): CarrierOption[] {
  return buildOptionList(modemData.network?.carrier_components ?? [], "LTE");
}

export function nrCarriersFromQcainfo(modemData: ModemStatus): CarrierOption[] {
  return buildOptionList(modemData.network?.carrier_components ?? [], "NR");
}

const SCS_15_BANDS = new Set([1, 2, 3, 5, 7, 8, 20, 28, 66, 71]);
const SCS_30_BANDS = new Set([38, 40, 41, 77, 78, 79]);
const SCS_120_BANDS = new Set([257, 258, 260, 261]);

export function defaultScsForBand(bandNumber: number): number | null {
  if (SCS_15_BANDS.has(bandNumber)) return 15;
  if (SCS_30_BANDS.has(bandNumber)) return 30;
  if (SCS_120_BANDS.has(bandNumber)) return 120;
  return null;
}

export function compositeValue(earfcn: number, pci: number): string {
  return `${earfcn}:${pci}`;
}

export function parseCompositeValue(
  value: string,
): { earfcn: number; pci: number } | null {
  if (!value || !value.includes(":")) return null;
  const [eStr, pStr] = value.split(":", 2);
  if (!eStr || !pStr) return null;
  const earfcn = Number(eStr);
  const pci = Number(pStr);
  if (!Number.isFinite(earfcn) || !Number.isFinite(pci)) return null;
  return { earfcn, pci };
}

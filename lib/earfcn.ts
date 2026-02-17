// =============================================================================
// earfcn.ts — EARFCN/NR-ARFCN → Frequency Calculator & Band Name Lookup
// =============================================================================
// Based on 3GPP TS 36.101 §5.7 (LTE) and 3GPP TS 38.104 §5.4.2.1 (NR).
// Used by the Active Bands component to display DL/UL frequency and band names.
// =============================================================================

// --- LTE Band Table (3GPP TS 36.101) ----------------------------------------

interface LTEBandEntry {
  band: number;
  /** Common / marketing name for the band */
  name: string;
  /** DL low edge in MHz */
  dlLow: number;
  /** UL low edge in MHz (same as dlLow for TDD) */
  ulLow: number;
  /** EARFCN offset (N_Offs-DL) */
  earfcnOffset: number;
  /** Valid EARFCN range [min, max] */
  earfcnRange: [number, number];
  /** Channel spacing in MHz (always 0.1 for LTE) */
  spacing: number;
  /** Duplex mode */
  duplexType: "FDD" | "TDD" | "SDL";
}

const LTE_BANDS: LTEBandEntry[] = [
  // FDD
  { band: 1,  name: "IMT 2100",       dlLow: 2110, ulLow: 1920, earfcnOffset: 0,     earfcnRange: [0, 599],       spacing: 0.1, duplexType: "FDD" },
  { band: 2,  name: "PCS 1900",       dlLow: 1930, ulLow: 1850, earfcnOffset: 600,   earfcnRange: [600, 1199],    spacing: 0.1, duplexType: "FDD" },
  { band: 3,  name: "DCS 1800",       dlLow: 1805, ulLow: 1710, earfcnOffset: 1200,  earfcnRange: [1200, 1949],   spacing: 0.1, duplexType: "FDD" },
  { band: 4,  name: "AWS-1",          dlLow: 2110, ulLow: 1710, earfcnOffset: 1950,  earfcnRange: [1950, 2399],   spacing: 0.1, duplexType: "FDD" },
  { band: 5,  name: "CLR 850",        dlLow: 869,  ulLow: 824,  earfcnOffset: 2400,  earfcnRange: [2400, 2649],   spacing: 0.1, duplexType: "FDD" },
  { band: 7,  name: "IMT-E 2600",     dlLow: 2620, ulLow: 2500, earfcnOffset: 2750,  earfcnRange: [2750, 3449],   spacing: 0.1, duplexType: "FDD" },
  { band: 8,  name: "GSM 900",        dlLow: 925,  ulLow: 880,  earfcnOffset: 3450,  earfcnRange: [3450, 3799],   spacing: 0.1, duplexType: "FDD" },
  { band: 12, name: "Lower 700 a",    dlLow: 729,  ulLow: 699,  earfcnOffset: 5010,  earfcnRange: [5010, 5179],   spacing: 0.1, duplexType: "FDD" },
  { band: 13, name: "Upper 700 c",    dlLow: 746,  ulLow: 777,  earfcnOffset: 5180,  earfcnRange: [5180, 5279],   spacing: 0.1, duplexType: "FDD" },
  { band: 14, name: "Upper 700 PS",   dlLow: 758,  ulLow: 788,  earfcnOffset: 5280,  earfcnRange: [5280, 5379],   spacing: 0.1, duplexType: "FDD" },
  { band: 17, name: "Lower 700 b",    dlLow: 734,  ulLow: 704,  earfcnOffset: 5730,  earfcnRange: [5730, 5849],   spacing: 0.1, duplexType: "FDD" },
  { band: 20, name: "EU 800 DD",      dlLow: 791,  ulLow: 832,  earfcnOffset: 6150,  earfcnRange: [6150, 6449],   spacing: 0.1, duplexType: "FDD" },
  { band: 25, name: "PCS 1900+",      dlLow: 1930, ulLow: 1850, earfcnOffset: 8040,  earfcnRange: [8040, 8689],   spacing: 0.1, duplexType: "FDD" },
  { band: 26, name: "ESMR 850+",      dlLow: 859,  ulLow: 814,  earfcnOffset: 8690,  earfcnRange: [8690, 9039],   spacing: 0.1, duplexType: "FDD" },
  { band: 28, name: "APT 700",        dlLow: 758,  ulLow: 703,  earfcnOffset: 9210,  earfcnRange: [9210, 9659],   spacing: 0.1, duplexType: "FDD" },
  { band: 66, name: "AWS-3",          dlLow: 2110, ulLow: 1710, earfcnOffset: 66436, earfcnRange: [66436, 67335], spacing: 0.1, duplexType: "FDD" },
  { band: 71, name: "600 MHz",        dlLow: 617,  ulLow: 663,  earfcnOffset: 68586, earfcnRange: [68586, 68935], spacing: 0.1, duplexType: "FDD" },
  // SDL (Supplemental Downlink — no UL)
  { band: 29, name: "Lower 700 d",    dlLow: 717,  ulLow: 0,    earfcnOffset: 9660,  earfcnRange: [9660, 9769],   spacing: 0.1, duplexType: "SDL" },
  { band: 30, name: "WCS 2300",       dlLow: 2350, ulLow: 2305, earfcnOffset: 9770,  earfcnRange: [9770, 9869],   spacing: 0.1, duplexType: "FDD" },
  { band: 32, name: "DL 1500",        dlLow: 1452, ulLow: 0,    earfcnOffset: 9920,  earfcnRange: [9920, 10359],  spacing: 0.1, duplexType: "SDL" },
  // TDD (UL = DL)
  { band: 34, name: "IMT 2000 TDD",   dlLow: 2010, ulLow: 2010, earfcnOffset: 36200, earfcnRange: [36200, 36349], spacing: 0.1, duplexType: "TDD" },
  { band: 38, name: "IMT-E 2600 TDD", dlLow: 2570, ulLow: 2570, earfcnOffset: 37750, earfcnRange: [37750, 38249], spacing: 0.1, duplexType: "TDD" },
  { band: 39, name: "DCS 1900 TDD",   dlLow: 1880, ulLow: 1880, earfcnOffset: 38250, earfcnRange: [38250, 38649], spacing: 0.1, duplexType: "TDD" },
  { band: 40, name: "TD 2300",        dlLow: 2300, ulLow: 2300, earfcnOffset: 38650, earfcnRange: [38650, 39649], spacing: 0.1, duplexType: "TDD" },
  { band: 41, name: "BRS/EBS",        dlLow: 2496, ulLow: 2496, earfcnOffset: 39650, earfcnRange: [39650, 41589], spacing: 0.1, duplexType: "TDD" },
  { band: 42, name: "CBRS 3500",      dlLow: 3400, ulLow: 3400, earfcnOffset: 41590, earfcnRange: [41590, 43589], spacing: 0.1, duplexType: "TDD" },
  { band: 43, name: "C-Band 3700",    dlLow: 3600, ulLow: 3600, earfcnOffset: 43590, earfcnRange: [43590, 45589], spacing: 0.1, duplexType: "TDD" },
  { band: 46, name: "LAA 5 GHz",      dlLow: 5150, ulLow: 5150, earfcnOffset: 46790, earfcnRange: [46790, 54539], spacing: 0.1, duplexType: "TDD" },
  { band: 48, name: "CBRS",           dlLow: 3550, ulLow: 3550, earfcnOffset: 55240, earfcnRange: [55240, 56739], spacing: 0.1, duplexType: "TDD" },
];

// --- NR Band Table (3GPP TS 38.104) ------------------------------------------

interface NRBandEntry {
  band: number;
  name: string;
  /** UL low edge in MHz (same as DL low for TDD) */
  ulLow: number;
  /** DL low edge in MHz */
  dlLow: number;
  duplexType: "FDD" | "TDD" | "SDL";
  /** NR-ARFCN range for DL [min, max] */
  nrarfcnRange: [number, number];
}

const NR_BANDS: NRBandEntry[] = [
  // FDD (FR1)
  { band: 1,  name: "IMT 2100",         ulLow: 1920,  dlLow: 2110,  duplexType: "FDD", nrarfcnRange: [422000, 434000] },
  { band: 2,  name: "PCS 1900",         ulLow: 1850,  dlLow: 1930,  duplexType: "FDD", nrarfcnRange: [386000, 398000] },
  { band: 3,  name: "DCS 1800",         ulLow: 1710,  dlLow: 1805,  duplexType: "FDD", nrarfcnRange: [361000, 376000] },
  { band: 5,  name: "CLR 850",          ulLow: 824,   dlLow: 869,   duplexType: "FDD", nrarfcnRange: [173800, 178800] },
  { band: 7,  name: "IMT-E 2600",       ulLow: 2500,  dlLow: 2620,  duplexType: "FDD", nrarfcnRange: [524000, 538000] },
  { band: 8,  name: "GSM 900",          ulLow: 880,   dlLow: 925,   duplexType: "FDD", nrarfcnRange: [185000, 192000] },
  { band: 12, name: "Lower 700",        ulLow: 699,   dlLow: 729,   duplexType: "FDD", nrarfcnRange: [145800, 149200] },
  { band: 14, name: "FirstNet 700",     ulLow: 788,   dlLow: 758,   duplexType: "FDD", nrarfcnRange: [151600, 153600] },
  { band: 20, name: "EU 800 DD",        ulLow: 832,   dlLow: 791,   duplexType: "FDD", nrarfcnRange: [158200, 164200] },
  { band: 25, name: "PCS 1900+",        ulLow: 1850,  dlLow: 1930,  duplexType: "FDD", nrarfcnRange: [386000, 399000] },
  { band: 28, name: "APT 700",          ulLow: 703,   dlLow: 758,   duplexType: "FDD", nrarfcnRange: [151600, 160600] },
  { band: 30, name: "WCS 2300",         ulLow: 2305,  dlLow: 2350,  duplexType: "FDD", nrarfcnRange: [470000, 472000] },
  { band: 66, name: "AWS-3",            ulLow: 1710,  dlLow: 2110,  duplexType: "FDD", nrarfcnRange: [422000, 440000] },
  { band: 70, name: "AWS-4",            ulLow: 1695,  dlLow: 1995,  duplexType: "FDD", nrarfcnRange: [399000, 404000] },
  { band: 71, name: "600 MHz",          ulLow: 663,   dlLow: 617,   duplexType: "FDD", nrarfcnRange: [123400, 130400] },
  // SDL
  { band: 29, name: "SDL 700",          ulLow: 0,     dlLow: 717,   duplexType: "SDL", nrarfcnRange: [143400, 145600] },
  // TDD (FR1)
  { band: 34, name: "IMT 2000 TDD",     ulLow: 2010,  dlLow: 2010,  duplexType: "TDD", nrarfcnRange: [402000, 405000] },
  { band: 38, name: "IMT-E 2600 TDD",   ulLow: 2570,  dlLow: 2570,  duplexType: "TDD", nrarfcnRange: [514000, 524000] },
  { band: 39, name: "DCS 1900 TDD",     ulLow: 1880,  dlLow: 1880,  duplexType: "TDD", nrarfcnRange: [376000, 384000] },
  { band: 40, name: "TD 2300",          ulLow: 2300,  dlLow: 2300,  duplexType: "TDD", nrarfcnRange: [460000, 480000] },
  { band: 41, name: "BRS/EBS",          ulLow: 2496,  dlLow: 2496,  duplexType: "TDD", nrarfcnRange: [499200, 537999] },
  { band: 48, name: "CBRS",             ulLow: 3550,  dlLow: 3550,  duplexType: "TDD", nrarfcnRange: [636667, 646666] },
  { band: 77, name: "C-Band",           ulLow: 3300,  dlLow: 3300,  duplexType: "TDD", nrarfcnRange: [620000, 680000] },
  { band: 78, name: "C-Band (3.5 GHz)", ulLow: 3300,  dlLow: 3300,  duplexType: "TDD", nrarfcnRange: [620000, 653333] },
  { band: 79, name: "C-Band (4.5 GHz)", ulLow: 4400,  dlLow: 4400,  duplexType: "TDD", nrarfcnRange: [693334, 733333] },
  { band: 90, name: "BRS/EBS",          ulLow: 2496,  dlLow: 2496,  duplexType: "TDD", nrarfcnRange: [499200, 538000] },
  // FR2 (mmWave) — all TDD
  { band: 257, name: "mmWave 28 GHz",   ulLow: 26500, dlLow: 26500, duplexType: "TDD", nrarfcnRange: [2054166, 2104165] },
  { band: 258, name: "mmWave 26 GHz",   ulLow: 24250, dlLow: 24250, duplexType: "TDD", nrarfcnRange: [2016667, 2070832] },
  { band: 259, name: "mmWave 41 GHz",   ulLow: 39500, dlLow: 39500, duplexType: "TDD", nrarfcnRange: [2270832, 2337499] },
  { band: 260, name: "mmWave 39 GHz",   ulLow: 37000, dlLow: 37000, duplexType: "TDD", nrarfcnRange: [2229166, 2279165] },
  { band: 261, name: "mmWave 28 GHz",   ulLow: 27500, dlLow: 27500, duplexType: "TDD", nrarfcnRange: [2070833, 2084999] },
];

// --- Band Name Lookups -------------------------------------------------------

const NR_BAND_NAMES: Record<number, string> = {};
for (const b of NR_BANDS) {
  NR_BAND_NAMES[b.band] = b.name;
}

const LTE_BAND_NAMES: Record<number, string> = {};
for (const b of LTE_BANDS) {
  LTE_BAND_NAMES[b.band] = b.name;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract the numeric band number from a 3GPP band string.
 * e.g. "B3" → 3, "N41" → 41, "B66" → 66
 */
export function parseBandNumber(bandStr: string): number | null {
  const m = bandStr.match(/^[BNn]?(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Get the common/marketing name for a band.
 * @param bandStr - Band string from CarrierComponent, e.g. "B3" or "N41"
 * @param technology - "LTE" or "NR"
 * @returns Name like "DCS 1800" or "BRS/EBS", or empty string if unknown
 */
export function getBandName(bandStr: string, technology: "LTE" | "NR"): string {
  const num = parseBandNumber(bandStr);
  if (num === null) return "";
  if (technology === "NR") return NR_BAND_NAMES[num] ?? "";
  return LTE_BAND_NAMES[num] ?? "";
}

// --- LTE Frequency Calculations ----------------------------------------------

/** Find the matching LTE band entry for a given EARFCN */
function findLTEBand(earfcn: number): LTEBandEntry | null {
  for (const band of LTE_BANDS) {
    if (earfcn >= band.earfcnRange[0] && earfcn <= band.earfcnRange[1]) {
      return band;
    }
  }
  return null;
}

/**
 * Calculate the downlink frequency in MHz from an LTE EARFCN.
 * Formula: F_DL = F_DL_low + 0.1 × (EARFCN − N_Offs-DL)
 */
export function lteDLFrequency(earfcn: number): number | null {
  const band = findLTEBand(earfcn);
  if (!band) return null;
  return band.dlLow + (earfcn - band.earfcnOffset) * band.spacing;
}

/**
 * Calculate the uplink frequency in MHz from an LTE EARFCN.
 * For FDD: F_UL = F_UL_low + 0.1 × (EARFCN − N_Offs-DL)
 *   (same channel offset applied to UL low edge)
 * For TDD: UL = DL (same frequency, time-divided)
 * For SDL: no UL exists → returns null
 */
export function lteULFrequency(earfcn: number): number | null {
  const band = findLTEBand(earfcn);
  if (!band) return null;
  if (band.duplexType === "SDL") return null;
  if (band.duplexType === "TDD") {
    // TDD: UL and DL share the same frequency
    return band.dlLow + (earfcn - band.earfcnOffset) * band.spacing;
  }
  // FDD: apply same channel offset to UL low edge
  return band.ulLow + (earfcn - band.earfcnOffset) * band.spacing;
}

// --- NR Frequency Calculations -----------------------------------------------

/**
 * Calculate frequency in MHz from an NR-ARFCN using the global raster.
 * 3GPP TS 38.104 §5.4.2.1:
 *   Range 1 (0–599999):       F = 0          + 0.005 × N_REF
 *   Range 2 (600000–2016666): F = 3000       + 0.015 × (N_REF − 600000)
 *   Range 3 (2016667–3279165):F = 24250.08   + 0.060 × (N_REF − 2016667)
 */
function nrArfcnToFrequency(nrarfcn: number): number | null {
  if (nrarfcn >= 0 && nrarfcn <= 599999) {
    return nrarfcn * 0.005;
  } else if (nrarfcn >= 600000 && nrarfcn <= 2016666) {
    return 3000 + (nrarfcn - 600000) * 0.015;
  } else if (nrarfcn >= 2016667 && nrarfcn <= 3279165) {
    return 24250.08 + (nrarfcn - 2016667) * 0.06;
  }
  return null;
}

/** Find the matching NR band entry for a given NR-ARFCN */
function findNRBand(nrarfcn: number): NRBandEntry | null {
  for (const band of NR_BANDS) {
    if (nrarfcn >= band.nrarfcnRange[0] && nrarfcn <= band.nrarfcnRange[1]) {
      return band;
    }
  }
  return null;
}

/**
 * Calculate the downlink frequency in MHz from an NR-ARFCN.
 */
export function nrDLFrequency(nrarfcn: number): number | null {
  return nrArfcnToFrequency(nrarfcn);
}

/**
 * Calculate the uplink frequency in MHz from an NR-ARFCN.
 * For TDD: UL = DL (same frequency)
 * For FDD: compute offset from DL low edge, apply to UL low edge
 * For SDL: no UL → returns null
 *
 * @param nrarfcn - NR-ARFCN value
 * @param bandNum - Optional band number to resolve ambiguous ARFCNs
 *   (e.g. 528030 matches both n7 FDD and n41 TDD)
 */
export function nrULFrequency(nrarfcn: number, bandNum?: number): number | null {
  let band: NRBandEntry | null = null;

  if (bandNum !== undefined) {
    // Use the specific band when provided (resolves overlap ambiguity)
    band = NR_BANDS.find((b) => b.band === bandNum) ?? null;
  }
  if (!band) {
    band = findNRBand(nrarfcn);
  }
  if (!band) return null;
  if (band.duplexType === "SDL") return null;

  const dlFreq = nrArfcnToFrequency(nrarfcn);
  if (dlFreq === null) return null;

  if (band.duplexType === "TDD") {
    // TDD: UL and DL share the same frequency
    return dlFreq;
  }
  // FDD: compute the offset from DL low, apply to UL low
  const offset = dlFreq - band.dlLow;
  return band.ulLow + offset;
}

// --- Unified API (dispatches by technology) ----------------------------------

/**
 * Calculate the downlink frequency for a carrier component.
 * @param earfcn - EARFCN or NR-ARFCN value
 * @param technology - "LTE" or "NR"
 * @returns frequency in MHz, or null if not calculable
 */
export function getDLFrequency(
  earfcn: number | null,
  technology: "LTE" | "NR"
): number | null {
  if (earfcn === null || earfcn === undefined) return null;
  return technology === "NR" ? nrDLFrequency(earfcn) : lteDLFrequency(earfcn);
}

/**
 * Calculate the uplink frequency for a carrier component.
 * @param earfcn - EARFCN or NR-ARFCN value
 * @param technology - "LTE" or "NR"
 * @param bandStr - Optional band string (e.g. "B3", "N41") to resolve
 *   ambiguous NR-ARFCNs that fall in overlapping band ranges
 * @returns frequency in MHz, or null if not calculable (SDL bands, unknown EARFCN)
 */
export function getULFrequency(
  earfcn: number | null,
  technology: "LTE" | "NR",
  bandStr?: string
): number | null {
  if (earfcn === null || earfcn === undefined) return null;
  if (technology === "NR") {
    const bandNum = bandStr ? parseBandNumber(bandStr) : undefined;
    return nrULFrequency(earfcn, bandNum ?? undefined);
  }
  return lteULFrequency(earfcn);
}

/**
 * Get the duplex mode for a band.
 * @param bandStr - Band string from CarrierComponent, e.g. "B3" or "N41"
 * @param technology - "LTE" or "NR"
 * @returns "FDD", "TDD", "SDL", or "" if unknown
 */
export function getDuplexMode(
  bandStr: string,
  technology: "LTE" | "NR"
): string {
  const num = parseBandNumber(bandStr);
  if (num === null) return "";
  if (technology === "NR") {
    const band = NR_BANDS.find((b) => b.band === num);
    return band?.duplexType ?? "";
  }
  const band = LTE_BANDS.find((b) => b.band === num);
  return band?.duplexType ?? "";
}

/**
 * Format a frequency value for display.
 * e.g., 1850.5 → "1850.5 MHz", 28000.0 → "28.00 GHz"
 */
export function formatFrequency(freqMHz: number | null): string {
  if (freqMHz === null) return "-";
  if (freqMHz >= 10000) {
    return `${(freqMHz / 1000).toFixed(2)} GHz`;
  }
  const formatted = freqMHz % 1 === 0 ? freqMHz.toFixed(0) : freqMHz.toFixed(1);
  return `${formatted} MHz`;
}

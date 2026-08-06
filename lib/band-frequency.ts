// =============================================================================
// band-frequency.ts — 3GPP band designator -> centre frequency (MHz)
// =============================================================================
// Static reference data. The 3GPP band plan is fixed by spec, not read from
// the modem, so this is a lookup table rather than something the poller could
// ever report. Bands absent from the map (rare regional allocations this
// modem's SKUs do not ship) resolve to `null`, and callers render the tile
// without a frequency line rather than guessing at one.
//
// Bands with more than one commonly-cited centre frequency (e.g. B4/B66's
// AWS-3 pairing) use the figure operators and 3GPP documentation cite most
// often for that band's downlink.
// =============================================================================

const LTE_BAND_MHZ: Record<number, number> = {
  1: 2100, 2: 1900, 3: 1800, 4: 1700, 5: 850, 7: 2600, 8: 900,
  12: 700, 13: 700, 14: 700, 17: 700, 18: 800, 19: 800, 20: 800,
  25: 1900, 26: 850, 28: 700, 29: 700, 30: 2300, 32: 1500, 34: 2000,
  38: 2600, 39: 1900, 40: 2300, 41: 2500, 42: 3500, 43: 3700,
  46: 5200, 48: 3600, 66: 1700, 71: 600,
};

const NR_BAND_MHZ: Record<number, number> = {
  1: 2100, 2: 1900, 3: 1800, 5: 850, 7: 2600, 8: 900,
  12: 700, 13: 700, 14: 700, 18: 800, 20: 800, 25: 1900, 26: 850,
  28: 700, 29: 700, 30: 2300, 38: 2600, 40: 2300, 41: 2500,
  48: 3600, 66: 1700, 70: 1700, 71: 600, 75: 1500, 76: 1500,
  77: 3700, 78: 3500, 79: 4700,
};

/**
 * The centre frequency for a band designator like `"B28"` or `"N71"`, in MHz.
 * `technology` picks the table because LTE and NR band numbers are not the
 * same namespace (LTE B66 and NR N66 happen to share a frequency; LTE B48
 * and NR N48 do not exist on the same modem generation).
 */
export function bandFrequencyMhz(
  technology: "LTE" | "NR",
  band: string,
): number | null {
  const n = parseInt(band.replace(/^[A-Za-z]+/, ""), 10);
  if (Number.isNaN(n)) return null;
  const table = technology === "LTE" ? LTE_BAND_MHZ : NR_BAND_MHZ;
  return table[n] ?? null;
}

// =============================================================================
// band-locking.ts — QManager Band Locking Types
// =============================================================================
// TypeScript interfaces and utility functions for the Band Locking feature.
// Band locking controls which LTE/NR bands the modem is allowed to use,
// independent of Connection Scenarios (which control network mode).
//
// Backend contract:
//   Current bands:    GET  /cgi-bin/quecmanager/bands/current.sh
//   Lock bands:       POST /cgi-bin/quecmanager/bands/lock.sh
//   Failover toggle:  POST /cgi-bin/quecmanager/bands/failover_toggle.sh
//   Supported bands:  From useModemStatus() → data.device.supported_*_bands
//   Active bands:     From useModemStatus() → data.network.carrier_components
// =============================================================================

// --- Band Category -----------------------------------------------------------

/** Discriminator for the three independent band locking cards */
export type BandCategory = "lte" | "nsa_nr5g" | "sa_nr5g";

/** Display labels for each band category */
export const BAND_CATEGORY_LABELS: Record<BandCategory, string> = {
  lte: "LTE",
  nsa_nr5g: "NR5G NSA",
  sa_nr5g: "NR5G SA",
};

/** Band prefix used in UI display (e.g., "B1" for LTE, "N41" for NR) */
export const BAND_PREFIX: Record<BandCategory, string> = {
  lte: "B",
  nsa_nr5g: "N",
  sa_nr5g: "N",
};

// --- API Response Types ------------------------------------------------------

/** Currently configured (locked) bands from ue_capability_band */
export interface CurrentBands {
  lte_bands: string; // colon-delimited: "1:3:41"
  nsa_nr5g_bands: string;
  sa_nr5g_bands: string;
}

/** Failover safety mechanism state */
export interface FailoverState {
  /** Whether failover is enabled (persistent, on flash) */
  enabled: boolean;
  /** Whether failover has fired and overrode the user's lock */
  activated: boolean;
  /** Whether the failover watcher daemon is currently monitoring */
  watcher_running: boolean;
}

/** Response from GET /cgi-bin/quecmanager/bands/current.sh */
export interface BandCurrentResponse {
  success: boolean;
  current: CurrentBands;
  failover: FailoverState;
  error?: string;
  detail?: string;
}

/** Response from POST /cgi-bin/quecmanager/bands/lock.sh */
export interface BandLockResponse {
  success: boolean;
  band_type?: string;
  bands?: string;
  failover_armed?: boolean;
  error?: string;
  detail?: string;
}

/** Response from POST /cgi-bin/quecmanager/bands/failover_toggle.sh */
export interface FailoverToggleResponse {
  success: boolean;
  enabled?: boolean;
  error?: string;
  detail?: string;
}

/** Response from GET /cgi-bin/quecmanager/bands/failover_status.sh */
export interface FailoverStatusResponse {
  enabled: boolean;
  activated: boolean;
  /** True while the one-shot watcher process is still running (sleeping / checking) */
  watcher_running: boolean;
}

// --- Utility Functions -------------------------------------------------------

/**
 * Parse a colon-delimited band string into a sorted array of numbers.
 * Returns empty array for empty/null/undefined input.
 *
 * @example parseBandString("1:3:41:7") → [1, 3, 7, 41]
 */
export function parseBandString(bands: string | undefined | null): number[] {
  if (!bands || !bands.trim()) return [];
  return bands
    .split(":")
    .map((b) => parseInt(b.trim(), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
}

/**
 * Convert a number array back to colon-delimited string for AT commands.
 * Sorts numerically before joining.
 *
 * @example bandArrayToString([41, 3, 1, 7]) → "1:3:7:41"
 */
export function bandArrayToString(bands: number[]): string {
  return [...bands].sort((a, b) => a - b).join(":");
}

/**
 * Format a band number with the appropriate prefix for display.
 *
 * @example formatBandName("lte", 3) → "B3"
 * @example formatBandName("nsa_nr5g", 41) → "N41"
 */
export function formatBandName(category: BandCategory, band: number): string {
  return `${BAND_PREFIX[category]}${band}`;
}

/**
 * Get the bands for a specific category from a CurrentBands or supported bands object.
 * Maps the BandCategory key to the correct field name.
 */
export function getBandsForCategory(
  bands: CurrentBands | { lte_bands: string; nsa_nr5g_bands: string; sa_nr5g_bands: string },
  category: BandCategory,
): string {
  switch (category) {
    case "lte":
      return bands.lte_bands;
    case "nsa_nr5g":
      return bands.nsa_nr5g_bands;
    case "sa_nr5g":
      return bands.sa_nr5g_bands;
  }
}

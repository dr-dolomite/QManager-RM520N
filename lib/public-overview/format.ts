// =============================================================================
// format.ts — Pure presentation helpers for the public overview card.
// =============================================================================

import type { ConnectionState } from "@/types/modem-status";
import type { PublicOverviewBand } from "@/types/public-overview";

/**
 * Reduces LTE + NR connection states into a single label for the connection
 * badge. Priority: connected > searching > limited > inactive > error >
 * disconnected > unknown. Either side being "connected" is enough — NSA has
 * both, SA has only NR, LTE-only has only LTE.
 */
export function deriveConnectionLabel(
  lte: ConnectionState,
  nr: ConnectionState,
): ConnectionState {
  const states: ConnectionState[] = [lte, nr];
  const priority: ConnectionState[] = [
    "connected",
    "searching",
    "limited",
    "inactive",
    "error",
    "disconnected",
    "unknown",
  ];
  for (const candidate of priority) {
    if (states.includes(candidate)) return candidate;
  }
  return "unknown";
}

/**
 * One row per active carrier component (PCC + SCCs in input order). Bandwidth
 * is `null` when missing (0 or non-finite); PCI / RSRP are `null` when not
 * reported. Renderer decides how to format each side independently.
 */
export interface CarrierComponentRow {
  band: string;
  bandwidth: number | null;
  pci: number | null;
  rsrp: number | null;
}

/**
 * Builds the per-component rows for the "Bands" section. Entries with empty
 * `band` are skipped; remaining fields are normalized to a flat shape so the
 * renderer can lay each row out without juggling discriminated variants.
 */
export function formatCarrierComponents(
  bands: PublicOverviewBand[],
): CarrierComponentRow[] {
  return bands
    .filter((b): b is PublicOverviewBand => Boolean(b && b.band))
    .map((b) => ({
      band: b.band,
      bandwidth:
        Number.isFinite(b.bandwidth_mhz) && b.bandwidth_mhz > 0
          ? b.bandwidth_mhz
          : null,
      pci: b.pci != null ? b.pci : null,
      rsrp: b.rsrp != null ? b.rsrp : null,
    }));
}

export type UptimeFormat =
  | { key: "days"; days: number; hours: number }
  | { key: "hours"; hours: number; minutes: number }
  | { key: "minutes"; minutes: number };

/**
 * Formats device uptime (seconds) into a coarse, human-friendly bucket.
 * Returns a structured value so callers can pass the parts to i18next
 * interpolation (so day/hour/minute labels can be translated).
 */
export function formatUptime(seconds: number): UptimeFormat {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { key: "minutes", minutes: 0 };
  }
  const totalMinutes = Math.floor(seconds / 60);
  const totalHours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);

  if (days >= 1) {
    return { key: "days", days, hours: totalHours - days * 24 };
  }
  if (totalHours >= 1) {
    return {
      key: "hours",
      hours: totalHours,
      minutes: totalMinutes - totalHours * 60,
    };
  }
  return { key: "minutes", minutes: totalMinutes };
}

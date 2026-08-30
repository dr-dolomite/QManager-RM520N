// =============================================================================
// format.ts — Pure presentation helpers for the public overview card.
// =============================================================================

import type { ConnectionState } from "@/types/modem-status";

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

// A carrier-component flattener and its row interface used to live here. They
// had no consumer: `BandRow` reads `PublicOverviewBand` directly and needs none
// of the normalising, so the pair was a preparation step for a renderer that was
// never written.
//
// `formatUptime` below is NOT in that category and must stay — it has two live
// consumers on the AUTHENTICATED side (`cellular/radio/cellular-information-card.tsx`
// and `dashboard/device-status.tsx`), so deleting it while cleaning up this
// module's public-splash helpers would be a regression, not a tidy-up.

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

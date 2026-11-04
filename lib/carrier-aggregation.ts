import type { CarrierComponent, NetworkType } from "@/types/modem-status";

/**
 * Carrier-aggregation view model.
 *
 * The device is the source of truth for `type` ("PCC" | "SCC") — it comes
 * verbatim from AT+QCAINFO field 1 and we never invent a second PCC. The one
 * thing we derive is the NSA anchor: in EN-DC the LTE cell holds the PCC and
 * the NR leg reports as an ordinary SCC (see scripts/usr/lib/qmanager/parse_at.sh,
 * "In NSA mode, the first NR SCC is the NR leg itself"). Rendering that leg as a
 * plain secondary would tell a 5G user that the carrier doing most of the work
 * is supplementary, so it gets its own role — derived here, in the frontend,
 * leaving status.json a faithful transcript of what the radio said.
 */

export type CarrierRole = "pcc" | "nr-anchor" | "scc";

export interface ResolvedCarrier extends CarrierComponent {
  /** Stable list key. PCC and SCC can share a PCI on the same site, so PCI
   *  alone would collapse two real carriers into one row. */
  key: string;
  role: CarrierRole;
  /** True once the carrier has been absent from the poller snapshot long
   *  enough that the absence is a release rather than a dropped AT read. */
  released: boolean;
  /** Wall-clock ms of the last snapshot this carrier appeared in. */
  lastSeenMs: number;
}

/** Segments narrower than this become unreadable, so a real carrier is never
 *  allowed to render below it. 1.4 MHz LTE against a 100 MHz n78 would
 *  otherwise be a 2px sliver, and an unrecognised bandwidth enum decodes to 0
 *  and would vanish entirely while still appearing in the tile row. */
const MIN_SEGMENT_SHARE = 0.07;

/** RSRP range the quality bars map across. Wider than the useful band at both
 *  ends so the bar keeps moving instead of pinning at the extremes. */
const RSRP_FLOOR_DBM = -125;
const RSRP_CEIL_DBM = -65;

/** How long a carrier must be missing before we call it released rather than a
 *  blip. A single failed AT read resets carrier_components to [] wholesale
 *  (qmanager_poller), so on a ~2s cadence an eager release would flicker the
 *  entire chain grey and back. */
const RELEASE_GRACE_MS = 6000;

/** How long a released carrier stays on screen before it is dropped. Long
 *  enough to explain a drop, short enough that the chain reflects the present. */
const RELEASE_RETAIN_MS = 120000;

export function carrierKey(c: CarrierComponent): string {
  return `${c.technology}-${c.band}-${c.earfcn ?? "na"}`;
}

/**
 * Assigns roles without ever synthesising a PCC the device did not report.
 * Tolerates zero or multiple PCC lines: NSA was unverifiable on the test
 * device, so this degrades rather than assuming the invariant holds.
 */
export function assignRoles(
  carriers: CarrierComponent[],
  networkType: NetworkType,
): CarrierRole[] {
  const firstNrIndex =
    networkType === "5G-NSA"
      ? carriers.findIndex((c) => c.technology === "NR")
      : -1;

  return carriers.map((c, i) => {
    if (i === firstNrIndex && c.type !== "PCC") return "nr-anchor";
    return c.type === "PCC" ? "pcc" : "scc";
  });
}

/** True for the roles that lead their radio leg, and therefore carry the
 *  strong tone rather than the container tone. */
export function isLeadRole(role: CarrierRole): boolean {
  return role === "pcc" || role === "nr-anchor";
}

/**
 * Segment widths as percentages summing to 100.
 *
 * Bandwidth drives the width because on this widget the width *is* the data.
 * Every segment is lifted to a legibility floor first, then the whole set is
 * renormalised, so the proportions stay honest in the common case and stay
 * readable in the pathological one.
 */
export function computeSegmentShares(bandwidths: number[]): number[] {
  const n = bandwidths.length;
  if (n === 0) return [];

  const equal = (): number[] => Array.from({ length: n }, () => 100 / n);

  // Past this count the floor cannot be honoured for everyone; equal widths
  // are at least not a lie about which carrier is wider.
  if (n * MIN_SEGMENT_SHARE >= 1) return equal();

  const total = bandwidths.reduce((sum, b) => sum + (b > 0 ? b : 0), 0);
  if (total <= 0) return equal();

  const floored = bandwidths.map((b) =>
    Math.max(b > 0 ? b / total : 0, MIN_SEGMENT_SHARE),
  );
  const flooredTotal = floored.reduce((sum, share) => sum + share, 0);
  return floored.map((share) => (share / flooredTotal) * 100);
}

/**
 * RSRP to a quality-bar percentage. Anchored on the same dBm scale the value's
 * text colour reads from, so the bar and the colour never disagree.
 */
export function rsrpToPercent(rsrp: number | null | undefined): number {
  if (rsrp === null || rsrp === undefined || Number.isNaN(rsrp)) return 0;
  const clamped = Math.min(Math.max(rsrp, RSRP_FLOOR_DBM), RSRP_CEIL_DBM);
  const pct =
    ((clamped - RSRP_FLOOR_DBM) / (RSRP_CEIL_DBM - RSRP_FLOOR_DBM)) * 100;
  // Keep a visible stub for a real-but-terrible carrier; an empty track reads
  // as "no data" rather than "very weak".
  return Math.max(pct, 2);
}

/**
 * Folds a fresh poller snapshot into the previously rendered set.
 *
 * The backend keeps no release history — a dropped SCC simply stops appearing
 * — so retention is observed here, by this client, and resets on reload. That
 * is a real observation rather than a fabricated timestamp, which is the whole
 * reason it is allowed to exist.
 */
export function reconcileCarriers(
  previous: ResolvedCarrier[],
  snapshot: CarrierComponent[],
  networkType: NetworkType,
  nowMs: number,
): ResolvedCarrier[] {
  const roles = assignRoles(snapshot, networkType);

  const live = new Map<string, ResolvedCarrier>();
  snapshot.forEach((c, i) => {
    const key = carrierKey(c);
    live.set(key, {
      ...c,
      key,
      role: roles[i],
      released: false,
      lastSeenMs: nowMs,
    });
  });

  const out: ResolvedCarrier[] = [];
  const placed = new Set<string>();

  // Walk the PREVIOUS order first, so a carrier never changes position. If a
  // middle carrier drops, appending it to the end would slide it across the
  // strip while the width animation runs, which is a redraw — the exact thing
  // holding released segments in place is meant to avoid.
  for (const prev of previous) {
    const fresh = live.get(prev.key);
    if (fresh) {
      out.push(fresh);
      placed.add(prev.key);
      continue;
    }
    if (nowMs - prev.lastSeenMs >= RELEASE_RETAIN_MS) continue;
    out.push({
      ...prev,
      released: nowMs - prev.lastSeenMs >= RELEASE_GRACE_MS,
    });
    placed.add(prev.key);
  }

  // Genuinely new carriers join at the end, in the order the radio listed them.
  for (const c of snapshot) {
    const key = carrierKey(c);
    if (placed.has(key)) continue;
    const fresh = live.get(key);
    if (fresh) out.push(fresh);
  }

  return out;
}

/** Milliseconds a carrier has been gone, for release copy. */
export function releasedForMs(c: ResolvedCarrier, nowMs: number): number {
  return nowMs - c.lastSeenMs;
}

export interface AggregationSummary {
  /** Carriers still being reported by the radio. */
  activeCount: number;
  /** Sum of active carrier bandwidths, MHz. */
  totalMhz: number;
  /** Sum including still-displayed released carriers, so a drop can be shown
   *  as what remains against what it was rather than as a number that quietly
   *  shrinks. Equals totalMhz when nothing is released. */
  previousTotalMhz: number;
  /** Carriers currently shown as released. */
  releasedCount: number;
  lteCa: boolean;
  nrCa: boolean;
  endc: boolean;
}

export function summarise(
  carriers: ResolvedCarrier[],
  networkType: NetworkType,
): AggregationSummary {
  const active = carriers.filter((c) => !c.released);
  const lte = active.filter((c) => c.technology === "LTE");
  const nr = active.filter((c) => c.technology === "NR");

  return {
    activeCount: active.length,
    totalMhz: active.reduce((sum, c) => sum + (c.bandwidth_mhz || 0), 0),
    previousTotalMhz: carriers.reduce(
      (sum, c) => sum + (c.bandwidth_mhz || 0),
      0,
    ),
    releasedCount: carriers.length - active.length,
    lteCa: lte.length > 1,
    // The NSA anchor is not aggregation on its own; NR-CA needs a second NR
    // carrier beyond it. Mirrors the poller's own nr_ca_active rule, which
    // subtracts the anchor before counting.
    nrCa: nr.length > 1,
    endc: networkType === "5G-NSA" && nr.length > 0 && lte.length > 0,
  };
}

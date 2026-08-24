import type {
  CellScanResult,
  NeighbourCellResult,
  NeighbourCellType,
} from "@/types/cell-scanner";

import { signalTier, type SignalTier } from "./shapes";

// =============================================================================
// The run summaries — every aggregate on this surface, in one place
// =============================================================================
// Pure functions over the rows a run returned. They are here rather than inline
// in the two coordinators for one reason: an aggregate is where a results
// surface lies. `Math.max()` of an empty list is `-Infinity`, a mean over zero
// rows is `NaN`, and both render as confident text next to real numbers. Keeping
// them in one module means "survives an empty array, a single row, and
// all-sentinel data" is a property of one file per route rather than of a
// rendering path nobody re-reads.
//
// THE 0 SENTINEL IS THE WHOLE DIFFICULTY. Both workers emit `0` — not `null` —
// for an unreported reading, and 0 dBm is not a physically meaningful RSRP. So
// every aggregate below asks "was this measured?" before it asks "how strong?",
// and a run in which nothing was measured returns `null` rather than a number
// derived from sentinels. See docs/reference/cell-scanner.md > The 0-dBm
// sentinel.
//
// NO COPY IN THIS FILE. These return numbers, tiers and identifiers; the routes
// turn them into translated strings. A pure function that returns English is an
// i18n hole `bun run i18n:check` cannot see — the frequency calculator on this
// same route prefix shipped exactly that bug.
// =============================================================================

/** Whether a reading is a reading at all. The one place the sentinel is read. */
function isMeasured(strength: number): boolean {
  return strength !== 0;
}

/** The strongest RSRP among measured rows, or `null` when none were measured. */
function bestSignal(strengths: number[]): number | null {
  let best: number | null = null;
  for (const value of strengths) {
    if (!isMeasured(value)) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

/** An empty tally, so a caller never indexes into `undefined`. */
function emptyTiers(): Record<SignalTier, number> {
  return { good: 0, fair: 0, poor: 0, none: 0 };
}

function countTiers(strengths: number[]): Record<SignalTier, number> {
  const tiers = emptyTiers();
  for (const value of strengths) tiers[signalTier(value)] += 1;
  return tiers;
}

/**
 * The single tier every MEASURED row shares, or `null` when the spread is mixed
 * (or when nothing was measured at all). This is what gates the verdict strip:
 * "the readings vary" is not an explanation, so a mixed run gets no verdict.
 */
function uniformTier(
  tiers: Record<SignalTier, number>,
): Exclude<SignalTier, "none"> | null {
  const measured = (["good", "fair", "poor"] as const).filter(
    (tier) => tiers[tier] > 0,
  );
  return measured.length === 1 ? measured[0] : null;
}

// -----------------------------------------------------------------------------
// The full sweep
// -----------------------------------------------------------------------------

/**
 * How many provider tiles the grid draws before it folds the rest into one.
 *
 * Five plus an overflow tile is what fits three columns twice over without the
 * panel outgrowing the posture rail beside it. A dense urban sweep can return a
 * dozen operator entries — including roaming partners the reader has never heard
 * of — and a grid that grows with them turns the hero into a list.
 */
export const MAX_PROVIDER_TILES = 5;

export interface ProviderGroup {
  /** The worker's own string. Empty when the modem reported no operator name. */
  provider: string;
  cells: number;
  /** `B3` / `N78`, sorted, de-duplicated. Band 0 is the worker's sentinel and is dropped. */
  bands: string[];
  /** Strongest RSRP among this provider's measured cells; `null` if none were. */
  best: number | null;
  /**
   * `best` graded on this surface's own three-tier scale — what the summary
   * tile's disc is tinted and glyphed by.
   *
   * DERIVED HERE, not at the call site, for the reason every other aggregate in
   * this file is: a tier is a judgement over a nullable reading, and computing
   * it inside a `.map()` in a component is how the same judgement ends up
   * spelled two different ways on two routes. `signalTier(null)` is `none`, so a
   * group nothing was measured in grades as an absence rather than as "poor".
   *
   * Still no copy: this is the tier ENUM. The routes turn it into a label.
   */
  tier: SignalTier;
}

export interface SweepSummary {
  total: number;
  /** Capped at `MAX_PROVIDER_TILES`, strongest-populated first. */
  groups: ProviderGroup[];
  /** Providers and cells folded out of the capped list. Both 0 when nothing was. */
  overflowProviders: number;
  overflowCells: number;
  /**
   * The best tier among the FOLDED groups — the overflow tile's disc.
   *
   * Without it the tile that stands for "3 more providers" would have to pick a
   * tier it does not have, and the honest-looking choice (`none`) would paint it
   * "nothing was measured here" when the folded groups may hold the strongest
   * reading of the run. `none` when the list folded nothing, which is also when
   * the tile is not rendered.
   */
  overflowTier: SignalTier;
  // `providerCount` and `bandCount` lived here for the posture rail's context
  // caption ("across 3 providers on 6 bands"). That line was removed by user
  // decision (see `shapes.ts`'s header) and nothing else read them, so they are
  // gone rather than left as a field only a future caller might want — an
  // aggregate with no consumer is an untested aggregate.
  measured: number;
  tiers: Record<SignalTier, number>;
  uniform: Exclude<SignalTier, "none"> | null;
}

/** `B3` for LTE, `N78` for NR — the carrier's own notation, as the table uses. */
function bandLabel(cell: CellScanResult): string | null {
  if (!cell.band) return null;
  const prefix = cell.networkType.toUpperCase().startsWith("NR") ? "N" : "B";
  return `${prefix}${cell.band}`;
}

export function summariseSweep(results: CellScanResult[]): SweepSummary {
  const byProvider = new Map<string, CellScanResult[]>();

  for (const cell of results) {
    const key = cell.provider ?? "";
    const bucket = byProvider.get(key);
    if (bucket) bucket.push(cell);
    else byProvider.set(key, [cell]);
  }

  const groups: ProviderGroup[] = [...byProvider.entries()]
    .map(([provider, cells]) => {
      const bands = [
        ...new Set(
          cells
            .map(bandLabel)
            .filter((band): band is string => band !== null),
        ),
      ].sort((a, b) =>
        // Numeric within a radio, so B28 does not sort before B3.
        a[0] === b[0]
          ? Number(a.slice(1)) - Number(b.slice(1))
          : a.localeCompare(b),
      );

      const best = bestSignal(cells.map((cell) => cell.signalStrength));

      return {
        provider,
        cells: cells.length,
        bands,
        best,
        tier: signalTier(best),
      };
    })
    // Most cells first; a tie is broken by the stronger reading, and a group with
    // no reading at all sorts last rather than winning on a `null`.
    .sort(
      (a, b) =>
        b.cells - a.cells ||
        (b.best ?? Number.NEGATIVE_INFINITY) -
          (a.best ?? Number.NEGATIVE_INFINITY),
    );

  const shown = groups.slice(0, MAX_PROVIDER_TILES);
  const folded = groups.slice(MAX_PROVIDER_TILES);
  const strengths = results.map((cell) => cell.signalStrength);
  const tiers = countTiers(strengths);

  return {
    total: results.length,
    groups: shown,
    overflowProviders: folded.length,
    overflowCells: folded.reduce((sum, group) => sum + group.cells, 0),
    // `?? 0` maps a group with no reading onto the same sentinel the workers
    // use, so `bestSignal` skips it rather than treating null as a level.
    overflowTier: signalTier(bestSignal(folded.map((group) => group.best ?? 0))),
    measured: strengths.filter(isMeasured).length,
    tiers,
    uniform: uniformTier(tiers),
  };
}

// -----------------------------------------------------------------------------
// The neighbour read
// -----------------------------------------------------------------------------

/** How many channel numbers a relation tile prints before it counts them instead. */
export const MAX_TILE_CHANNELS = 3;

export interface RelationGroup {
  type: NeighbourCellType;
  count: number;
  /** Distinct reported channels. The worker's 0 is "not reported" and is dropped. */
  channels: number[];
  best: number | null;
  /** `best` on the three-tier scale — the tile disc. See `ProviderGroup.tier`. */
  tier: SignalTier;
}

export interface NeighbourSummary {
  total: number;
  /** Only the relations that actually appeared, in `intra`, `inter`, `nr5g` order. */
  groups: RelationGroup[];
  /** Rows carrying an RSRP. */
  measured: number;
  /**
   * Rows the serving cell named but did not measure. These carry no quality and
   * cannot be locked — the one fact this route's verdict exists to explain.
   */
  channelOnly: number;
  /**
   * The best tier across the WHOLE read — the disc on the measurement-split
   * tile, which is a count rather than a relation and so has no tier of its own.
   * `none` when nothing was measured, which is exactly what that tile then says.
   */
  tier: SignalTier;
  // `channelCount` is gone for the same reason `providerCount` is on the sweep
  // side: it fed only the posture rail's context caption, which was removed.
}

const RELATION_ORDER: NeighbourCellType[] = ["intra", "inter", "nr5g"];

export function summariseNeighbours(
  results: NeighbourCellResult[],
): NeighbourSummary {
  const groups: RelationGroup[] = RELATION_ORDER.map((type) => {
    const rows = results.filter((row) => row.cellType === type);
    const best = bestSignal(rows.map((row) => row.signalStrength));
    return {
      type,
      count: rows.length,
      channels: [
        ...new Set(
          rows.map((row) => row.frequency).filter((channel) => channel !== 0),
        ),
      ].sort((a, b) => a - b),
      best,
      tier: signalTier(best),
    };
  }).filter((group) => group.count > 0);

  const measured = results.filter((row) => isMeasured(row.signalStrength)).length;

  return {
    total: results.length,
    groups,
    measured,
    channelOnly: results.length - measured,
    tier: signalTier(bestSignal(results.map((row) => row.signalStrength))),
  };
}

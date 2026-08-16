// =============================================================================
// TILE_SHAPE — the shared `/cellular/` glance-tile geometry
// =============================================================================
// The 52px-disc-plus-text-column tile: a 28px-radius block PINNED at 104px
// height, holding a full-round glyph disc beside an eyebrow → value → caption
// column. DESIGN.md > Components > Tiles describes it; this file is where the
// numbers actually live, so a strip and its skeleton can never drift apart
// (Skeleton-Mirror Rule).
//
// It moved here from `radio/summary-tiles.tsx`, which is where it was first
// written and where four other surfaces reached in to borrow it — Antenna
// Statistics' context tiles and skeleton, and the SMS Center's strip and
// skeleton. Radio Information's strip briefly became an anchor-plus-grouped-box
// composition that did not use these values at all, which would have left four
// surfaces importing their geometry from a component that had stopped honouring
// it. That strip is a four-tile grid again and reads from here like everyone
// else, but the extraction stays: shared geometry belongs in a file nobody can
// recompose out from under its consumers. `components/cellular/` already holds
// this family's shared primitives (`condition-screen.tsx`,
// `signal-quality-display.ts`); this is one more.
// =============================================================================

export const TILE_SHAPE = {
  /** Grid wrapper. Container queries, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  /**
   * One tile, at a PINNED 104px rather than a minimum.
   *
   * The text column, not the 52px disc, sets the height: eyebrow (16) + 3 +
   * value + 3 + caption (16) = 38 + value, plus py-4 either side = 70 + value.
   * A 34px value budget lands the tile at 104, which fits every shape these
   * strips actually render: a 22px single-line figure, a Badge sitting inline
   * with one (the network tile), and a two-leg `LTE 1x2 | NR 2x4` stacked at
   * `text-sm` (2 x 16).
   *
   * It is PINNED because `min-h-` made HEIGHT below a lie. Measured on the four
   * live states: a two-leg MIMO tile resolved to 118px, an LTE single-carrier
   * tile to 98, a fully degraded tile to 95 — against a skeleton mirroring the
   * 92px floor. Every one of those is a visible jump at the skeleton handoff,
   * and the worst is 26px. A floor cannot be a mirror; only a pin can. (The
   * same correction was made to the summary strip's rows for the same reason.)
   *
   * Nothing clips at the pin: the eyebrow, caption, value and MIMO legs all
   * carry `truncate`, so a long translation shortens rather than overflows.
   */
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
} as const;

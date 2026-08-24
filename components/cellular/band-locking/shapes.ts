import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { BandCategory } from "@/types/band-locking";

// =============================================================================
// Band Locking — shared geometry and tone contract
// =============================================================================
// The single source of truth for this surface's shapes, tones and skeleton
// mirrors. Modelled on `components/cellular/custom-profiles/shapes.ts`, and for
// the same reason: the incumbent band-locking code declared its card shell in
// THREE places inside one file (the loading branch, the empty branch and the
// loaded branch of `band-cards.tsx`), so a radius fixed in one branch stayed
// wrong in the other two. Every consumer imports from here.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// Two kinds of object, and the incumbent layout said they were the same kind:
// it put a read-only status panel and three interactive control surfaces into
// one 2-column grid as visual peers.
//
//   1. THE HERO reports what the modem is doing right now — its lock posture,
//      the failover safety net, and the bands actually on air. Read-only except
//      for the one switch that arms the safety net.
//   2. THE CATEGORY CARDS are where you change it. One per AT parameter
//      (`lte_band`, `nsa_nr5g_band`, `nr5g_band`), which is also one per
//      genuinely distinct supported-band list from the modem.
//
// The hero earns `rounded-hero` under the Consistent-Layout Rule's "a genuine
// glance surface may earn a hero card" exception. It is the ONE hero on this
// page. A second one spends the exception twice.
//
// -----------------------------------------------------------------------------
// THE TWO-AXIS BAND CHIP (read before touching BAND_CHIP)
// -----------------------------------------------------------------------------
// The incumbent grid was a checkbox per band, which conflates two facts that
// are not the same fact:
//
//   SELECTED — what you have picked and have not applied yet. Local state.
//   LIVE     — what is actually configured on the modem right now, read back
//              from `ue_capability_band` via `current.sh`.
//
// A checkbox has one channel and there are two facts, so the incumbent grid
// could not show you a pending change at all. Once you clicked, the UI claimed
// the new state before the modem had it — a State-Honesty violation hiding
// inside a form control.
//
// The chip separates them onto two channels that do not interfere:
//
//   FILL carries SELECTED.  `primary-container` when picked, `surface-container`
//                           when not. Brand, not a functional role: a chosen
//                           band is not a *healthy* band, and the
//                           Identity-Never-Acts Rule keeps `nr`/`lte` out of a
//                           control's tone entirely.
//   RING carries LIVE.      A 2px inset `--primary` ring, present iff the band
//                           is configured on the modem at this moment.
//
// So the four combinations read directly, and the two pending ones — the states
// the incumbent could not express — are the interesting half:
//
//   fill + ring   already locked, staying locked
//   fill, no ring PENDING ADD — will be locked when you apply
//   ring, no fill PENDING REMOVAL — will be dropped when you apply
//   neither       not locked, staying that way
//
// WHY AN INSET SHADOW AND NOT A BORDER. Identical rationale to
// `PROFILE_ROW_ACTIVE_RING` in the custom-profiles contract: a real border adds
// a layout box, so every chip in the grid would shift by 2px the moment a lock
// landed and the grid would visibly reflow on every successful apply. An inset
// shadow costs no box, so a chip gaining or losing its ring is a pure paint.
//
// This is NOT a No-Hairline-On-Fill violation. That rule bans a stroke drawn to
// prop up a fill too weak to read alone. Here the fill reads fine on its own and
// carries a DIFFERENT fact; the ring is a second independent signal, not a
// crutch for the first.
//
// WHY `--primary` READS ON BOTH FILLS. The ring has to survive on
// `surface-container` and on `primary-container`, in both themes. It does,
// because `--primary` and `--primary-container` are far apart on the lightness
// axis in each theme and they move in opposite directions across the flip:
// light is L 0.488 on L 0.885, dark is L 0.79 on L 0.4. A ring drawn in
// `on-primary-container` instead would vanish against the container it sits on.
//
// -----------------------------------------------------------------------------
// THE TOUCH-TARGET FLOOR
// -----------------------------------------------------------------------------
// The incumbent target was a `size-4` checkbox: 16px, against the project's
// stated 44px minimum on coarse pointers. This page is used roadside on a
// tablet, in sun, on a device whose connection you are about to reconfigure.
//
// The chip paints at 40px — the metric-row-pill height, so a band chip and a
// glance row are visibly the same family — and a `before:` overlay expands the
// hit area to 44px without contributing a layout box. Same construction as the
// `Banner` dismiss button, and for the same reason: the target the finger gets
// and the box the grid lays out do not have to be the same rectangle.
// =============================================================================

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * The page's anchor card. `rounded-hero` (40px) — one per surface.
 *
 * `shadow-whisper` as a bare utility does NOT resolve; it must go through the
 * custom property, as written.
 */
export const BAND_HERO =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * One category card. `rounded-card` (36px) — a peer in a grid, never a second
 * hero. Imported by the loaded, loading AND empty branches so the three can
 * never again disagree about their own radius.
 */
export const BAND_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 24px on a peer card, 28px on the hero (baked into BAND_HERO). */
export const CARD_PAD = "px-6";

// -----------------------------------------------------------------------------
// The hero
// -----------------------------------------------------------------------------

/**
 * The hero's two-column shape ("2a" of the Band Locking Hero Options design
 * exploration — `claude.ai/design/p/681e72a4-…`, "Compact tile grid").
 *
 * The single-column hero this replaced stacked "on air now", failover and the
 * posture summary as three unrelated full-width strips inside one card, so the
 * tallest element on the page was also the emptiest, and the most valuable
 * live fact (what the radio is actually camped on) sat last and smallest.
 *
 * Both panels are `rounded-card` (36px), ONE STEP BELOW the outer section's
 * `rounded-hero` (40px) — not a second hero. `BAND_HERO` still claims the
 * page's one hero exception on its own; nesting two hero-radius panels inside
 * it would spend that exception twice. The step-down is the same nesting the
 * incumbent already used for `HERO_ROW` (`rounded-field` inside the hero).
 *
 * `items-start`, NOT `items-stretch` — EACH PANEL ENDS WHERE ITS CONTENT ENDS.
 *
 * The panels used to stretch to the taller one, which was survivable only while
 * the failover row sat at the rail's foot on `mt-auto` and absorbed the slack.
 * With that row promoted to hero level, and the on-air panel grown taller (the
 * carrier tile gained a 40px disc row), stretching left the rail as a disc block
 * plus three rows floating in a tall empty box.
 *
 * The fix is NOT to inflate the rows to fill it. A rail row's content is fixed —
 * a label, a ratio, a status badge, a chevron — so its height encodes nothing,
 * and stretching it would make that height vary with how many carriers are on
 * air, a completely unrelated fact. That is the Data-Ink Rule applied to
 * geometry: a dimension that varies must vary with something it represents.
 * Unequal panel heights are the honest outcome here, not a defect.
 *
 * It has to be SET, not merely un-set: `stretch` is the CSS default for
 * `align-items`, so deleting the utility would change nothing at all.
 *
 * Both alignment utilities are `@2xl/hero:`-scoped, so neither reaches the
 * stacked state. Below that breakpoint the container is `flex-col` with no
 * align-items utility in force, leaving the default `stretch` on the CROSS axis
 * — which is exactly what gives both panels their full width there. Written
 * unscoped, `items-start` would collapse them to their content width instead.
 */
export const HERO_SPLIT = "flex flex-col gap-4 @2xl/hero:flex-row @2xl/hero:items-start";

/** The left panel: on-air carrier tiles. Grows; the rail is the fixed side. */
export const HERO_ONAIR_PANEL =
  "@container/onair min-w-0 flex-1 flex flex-col gap-4 rounded-card bg-surface-container px-6 py-6";

/** The right panel: the posture rail. Fixed width on a wide container, full
 *  width once the hero drops to one column. */
export const HERO_RAIL_PANEL =
  "flex w-full flex-none flex-col gap-3.5 rounded-card bg-surface-container px-5 py-6 @2xl/hero:w-[25rem]";

/**
 * The eyebrow above the lock-posture line.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * because the committed world ships one: DESIGN.md's tile anatomy is literally
 * `eyebrow -> value -> caption`, and the custom-profiles hero already carries
 * the identical step.
 */
export const HERO_EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

/**
 * The rail's own leading glyph disc — 44px, one step below `HERO_DISC`'s 52px
 * everywhere else in the product, because the rail is a nested panel rather
 * than the hero's own top-level anchor point.
 */
export const HERO_RAIL_DISC =
  "grid size-11 flex-none place-items-center rounded-pill bg-primary text-primary-foreground";

/** The rail's title (next to the disc) and its dynamic subtitle underneath. */
export const HERO_RAIL_TITLE = "text-base font-semibold";
export const HERO_RAIL_SUBTITLE = "text-[13px] text-on-surface-variant";

/**
 * One clickable category row in the rail: label + ratio, a status badge, and
 * a chevron. The chevron is a REAL affordance, not decoration — clicking the
 * row scrolls the matching category card into view, because "Lock posture"
 * and the three cards below it describe the same three facts and a rail that
 * only summarised them without linking to where they are changed would be
 * restating information the cards already carry, just one layer removed.
 */
export const HERO_RAIL_ROW =
  "group flex w-full items-center gap-3 rounded-field bg-surface px-4 py-3 text-left transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export const HERO_RAIL_ROW_LABEL = "text-sm font-semibold";
export const HERO_RAIL_ROW_RATIO =
  "text-xs text-on-surface-variant tabular-nums";

/**
 * The failover row's height, shared with `SKELETON_SHAPE.HERO_ROW` so the loaded
 * row and its placeholder cannot drift (Skeleton-Mirror Rule).
 *
 * A FLOOR SET ABOVE THE NATURAL CONTENT HEIGHT, which is how it gets a pin's
 * mirroring guarantee without a pin's failure mode. The row's tallest child is
 * the 22px help-tooltip trigger, so at `py-3` it resolves to ~46px and the 52px
 * floor BINDS — every unwrapped row is exactly 52px and so is its skeleton, the
 * same exactness `components/cellular/tile-shape.ts` gets from `h-`. But this
 * row is `flex-wrap`: on a narrow container the label block and the
 * badge-plus-switch group fall to two lines, and a hard `h-` would spill that
 * second line out of the rounded box (nothing here clips). A floor grows
 * instead.
 *
 * 52px is also the incumbent skeleton's measure, kept deliberately — the row's
 * anatomy is unchanged by the move to hero level.
 *
 * Written as a verbatim literal because Tailwind's scanner reads source TEXT: an
 * arbitrary value assembled from parts never reaches the stylesheet at all.
 */
export const HERO_ROW_MIN_H = "min-h-[3.25rem]";

/**
 * The failover row, at HERO level — a direct child of `BAND_HERO` spanning the
 * full width below both panels, not a member of `HERO_RAIL_PANEL`.
 *
 * WHY IT LEFT THE RAIL. `docs/reference/band-locking.md` argues for the rail
 * foot, on the reading that failover is the safety net for the locks beside it.
 * Two facts overrule that:
 *
 *   1. `lock.sh` arms exactly ONE watcher for the modem, regardless of which
 *      category was written. Failover is a property of the MODEM, not of any
 *      one of the rail's three category rows — and a control docked to a
 *      three-row list reads as the fourth row of that list.
 *   2. On a narrow container the hero drops to one column and the rail stacks
 *      LAST, which buried the single control that decides whether a mistaken
 *      lock is recoverable underneath everything it protects.
 *
 * Moving it cost the rail its only `mt-auto` floor pin, which is why `HERO_SPLIT`
 * now aligns the panels to `items-start` — see that constant.
 *
 * `bg-surface-container`, NOT `bg-surface`: the row used to sit inside a
 * `surface-container` panel and recessed to `surface` against it. At hero level
 * its ground is `BAND_HERO`'s own `bg-surface`, so the same token would make it
 * invisible. It steps UP now instead of down, which is the same one-step
 * separation read in the other direction.
 *
 * THE HELP COPY STAYS IN ITS TOOLTIP. Promoting it to a standing line under the
 * label was tried and reverted: commit `69df6ac` ("drop over-explanatory info
 * copy from lock/scanner surfaces") deliberately removed a standing explanatory
 * line from this exact panel, and `failover_help` is written in on-demand-help
 * register — it explains a hypothetical ("When enabled, the modem returns to
 * its default bands…") in 22 words, restating the premise of the four-state
 * chip sitting beside the switch. The extra hero width is not a reason to spend
 * it on prose.
 *
 * `rounded-field` (20px) rather than a metric-row pill, because this row WRAPS:
 * it carries a label, a help affordance, a switch and a status chip, and on a
 * narrow container those fall to a second line. A pill that has wrapped to two
 * lines is a stadium, not a pill, and the Radius-Follows-Size Rule puts a
 * two-line block on the field step.
 */
export const HERO_ROW = `flex ${HERO_ROW_MIN_H} flex-wrap items-center gap-x-4 gap-y-3 rounded-field bg-surface-container px-5 py-3`;

/** The failover label, beside its help-tooltip trigger. */
export const HERO_ROW_LABEL = "text-sm font-semibold";

// -----------------------------------------------------------------------------
// The on-air carrier tile
// -----------------------------------------------------------------------------

/**
 * The wrapping tile grid: a fixed 3-column ceiling rather than `auto-fit`.
 * The tile grew a full metric anatomy (EARFCN/PCI/Cell, RSRP+RSRQ+SINR) in
 * the "full detail" pass, so `minmax(160px,1fr)` no longer fits its content —
 * `auto-fit` was combing five *thin* tiles across the panel where three
 * *legible* ones read better. A carrier count under 3 leaves empty cells
 * rather than stretching, which is the deliberate trade: whitespace below a
 * mostly-empty grid reads as "nothing more to report", where a stretched
 * tile reads as a layout bug.
 *
 * Columns step in with the on-air panel's OWN container width
 * (`@container/onair`, declared on `HERO_ONAIR_PANEL`), not the viewport —
 * the panel narrows independently of the page whenever the hero drops to one
 * column below `@2xl/hero`.
 */
export const HERO_ONAIR_GRID =
  "grid grid-cols-1 gap-3 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3";

/**
 * The absent-leg cell that fills the solo layout's remaining third. Names the
 * radio that is NOT on air and offers the one action that would find it.
 *
 * `rounded-tile` and `bg-surface` match the empty state directly above it in
 * this file's consumer: both are "the thing that is not a carrier", and they
 * sit one step recessed from the panel's `surface-container` so a reader can
 * see at a glance which cells are live radios and which are not.
 */
export const HERO_ONAIR_ABSENT = {
  ROOT: "flex flex-col gap-2 rounded-tile bg-surface px-4 py-3.5",
  DISC: "grid size-9 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  TITLE: "text-sm font-semibold",
  BODY: "text-on-surface-variant text-xs leading-relaxed text-pretty",
  LINK: "mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors duration-[var(--duration-quick)] ease-out hover:text-primary/80 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none rounded-pill",
} as const;

/**
 * The tile's height, shared with `SKELETON_SHAPE.ONAIR_TILE` so the loaded tile
 * and its placeholder cannot drift (Skeleton-Mirror Rule).
 *
 * RE-MEASURED 2026-08-24 in a real browser (not by hand) after the tag row
 * was deleted, the reading was split into a tightly-coupled RSRP+bar group
 * over a reduced-gap RSRQ/SINR line, and the bandwidth figure went back to an
 * absolutely-positioned top-right corner (see `HERO_ONAIR_TILE`'s header
 * comment and `BANDWIDTH`'s own comment). Measured `getBoundingClientRect()`
 * heights, with CSS Grid's row-stretch temporarily neutralised so each figure
 * is the tile's OWN content height, not the tallest sibling's:
 *
 *     A full-detail tile, 1-column (no wrap)         144px
 *     A full-detail tile, 3-column (EARFCN/PCI wrap)  186px
 *     A sparse solo tile (no EARFCN/PCI/RSRQ/SINR)    126px
 *
 * The 3-column figure is the one that matters: at that width `DETAIL`'s
 * `EARFCN {{n}}` and `PCI {{n}}` segments want ~137px in a ~132px lane and
 * wrap, which is a pre-existing property of `DETAIL`'s own flex-wrap, not
 * something this pass introduced or can tidy away — the same width tension
 * `docs/reference/band-locking.md` already documented for the retired 216px
 * floor. No single `h-` is right across every width and reading shape, for
 * the same reason that floor was not.
 *
 * SO THIS IS STILL A FLOOR SET ABOVE THE NATURAL CEILING, not a pin — nothing
 * here truncates or clips, so a hard `h-` would spill a wrapped row out of the
 * rounded box instead of the box growing to hold it (confirmed above: the
 * measured 186px 3-column case already exceeds this floor and simply grows).
 * `HERO_ONAIR_TILE.METRICS_GROUP` keeps `mt-auto`, so slack — from the floor,
 * or from `align-items: stretch` matching a taller grid row-sibling — lands as
 * breathing room above the reading rather than as a gap mid-tile.
 *
 * Verbatim literal, because Tailwind's scanner reads source TEXT: an arbitrary
 * value assembled from parts never reaches the stylesheet at all.
 */
export const ONAIR_TILE_MIN_H = "min-h-[12rem]";

/**
 * One tile's full anatomy: the channel bandwidth pinned to the top-right
 * corner, an identity DISC centred against a two-row text column (band +
 * centre frequency, then EARFCN/PCI), followed by RSRP tightly paired with
 * its own quality bar, then RSRQ/SINR beneath at a reduced gap.
 *
 * THE IDENTITY TAG ROW IS GONE (2026-08-24). The tile used to carry a visible
 * `nr`/`lte` `Tag` plus a raw `PCC`/`SCC` `Tag` on their own row above the
 * band designator. Both were redundant with the disc one row down: the disc's
 * fill (`carrierDiscTone`) already says which radio (violet vs blue), and its
 * glyph (`CARRIER_DISC_GLYPH`) already gives a second, non-chromatic channel
 * for the same fact. `PCC`/`SCC` primacy still reads from `sortCarriers()`'s
 * ordering alone — see PCC PRIMACY IS NOW ORDER, NOT COLOUR in
 * `live-band-hero.tsx` — so deleting the tag removes a reinforcement, not the
 * only channel. What the tag row is NOT redundant with is a screen reader: the
 * tile's `role="listitem"` now carries an explicit `aria-label` naming the
 * radio family and PCC/SCC role, so that fact is still announced in words even
 * though nothing on screen prints "LTE" or "PCC" any more.
 *
 * THE DISC IS NOW CENTRED AGAINST THE TEXT PAIR, NOT THE TILE'S TOP EDGE. With
 * the tag row gone, the disc's only neighbours are the band/frequency/
 * bandwidth line and the EARFCN/PCI line — two rows, not three — so `TOP`
 * centres the 40px disc against that pair (`items-center`) instead of the old
 * `items-start` HEAD row, which existed only to keep the disc from dragging a
 * WRAPPED tag row's baseline down with it. There is no tag row left to wrap.
 *
 * THE READING IS NOW TWO GROUPS, NOT ONE ROW PLUS A FLOATING METER. RSRP and
 * its bar are one visual object — the bar IS the RSRP reading, drawn as a
 * length — so `READING` keeps them one tight `gap-1` apart. RSRQ/SINR is
 * supporting detail, so it sits under that pair at `METRICS_GROUP`'s slightly
 * larger `gap-1.5`, which is still tighter than the tile's general `gap-2.5`
 * rhythm. This replaces the old single `METRICS` row (RSRP and RSRQ/SINR side
 * by side, wrapping past each other on a narrow container) with a fixed
 * top-to-bottom order that reads the same at every width, and it is what lets
 * `ONAIR_TILE_MIN_H` shrink — see that constant.
 *
 * THE TILE BODY IS NEUTRAL. THE DISC CARRIES THE COLOUR. This tile shipped a
 * Gen-1 composition that `components/cellular/radio/summary-tiles.tsx` has since
 * gone through five generations of and retired outright — read that file's
 * header. The body was a saturated identity fill: `bg-primary`/`bg-lte` on the
 * lead carrier, the matching container on every other. Three consequences, all
 * of them structural rather than cosmetic:
 *
 *   1. The identity chip could not be a real `Tag`. An outline does not read on
 *      a strong fill, so the pill had to be a hand-rolled alpha over the tile's
 *      own ink — a third chip form, outside the Two-Form Rule entirely.
 *   2. The meter collided with the ground it sat on. Its tone helper grew a
 *      lead/secondary parameter and two alpha tracks purely to stop a `bg-lte`
 *      fill being drawn on a `bg-lte` tile.
 *   3. The five-stop signal ramp was STRUCTURALLY EXCLUDED. The retired comment
 *      said so outright: a quality-toned bar on an identity-toned fill is "two
 *      container fills stacked". So the one measurement in the tile — how good
 *      this carrier actually is — was the one thing colour could not report.
 *
 * A neutral body dissolves all three at once. The tag becomes a real `Tag`, the
 * meter becomes a real `MetricBar`, and the ramp lands on the numeral and the
 * bar where DESIGN.md > The signal quality ramp puts it. This is The Data-Ink
 * Rule at tile scale: colour belongs to the reading, not to the container
 * holding it.
 *
 * `bg-surface`, one step recessed from `HERO_ONAIR_PANEL`'s `surface-container`,
 * so a live carrier and the panel behind it stay distinguishable now that the
 * tile no longer separates itself by hue. Same ground as `HERO_ONAIR_ABSENT`,
 * deliberately: both are cells in one grid.
 */
export const HERO_ONAIR_TILE = {
  /**
   * `relative`: the anchor `BANDWIDTH`'s `absolute` positioning resolves
   * against. See `BANDWIDTH` for why it is taken out of flow rather than laid
   * out as a third flex child of `TOP`.
   */
  ROOT: `relative flex ${ONAIR_TILE_MIN_H} flex-col gap-2.5 rounded-tile bg-surface px-5 py-4`,
  /** Disc beside the two-row text column. `items-center` centres the 40px
   *  disc against the pair as a UNIT. Only two children — `BANDWIDTH` is
   *  `absolute`, not a third flex item here; see that constant. */
  TOP: "flex items-center gap-3",
  /**
   * The identity disc — 40px, the only coloured element on the tile.
   *
   * One step below `HERO_RAIL_DISC`'s 44px and two below the product's 52px
   * `TILE_SHAPE.DISC`, because this disc marks one cell inside a 3-up grid
   * rather than anchoring a panel.
   */
  DISC: "grid size-10 flex-none place-items-center rounded-pill",
  /** The band/EARFCN text column beside the disc. `min-w-0` so a long detail
   *  line truncates instead of pushing the tile past its grid cell. */
  TEXT: "grid min-w-0 flex-1 gap-1",
  /** Band designator + centre frequency, one row. `pr-11` reserves the corner
   *  `BANDWIDTH` occupies (see that constant) so a long band/frequency pair
   *  wraps under it rather than running into it — scoped to THIS row, not the
   *  whole `TEXT` column, because the badge sits only as tall as this row;
   *  the EARFCN/PCI line beneath it needs its full width. The standalone
   *  "No aggregation" tag this row briefly carried in the solo case is gone
   *  by request — a lone tile beside `AbsentLegCell` already says nothing
   *  else is aggregated with it. */
  BAND_ROW: "flex flex-wrap items-baseline gap-2 pr-11",
  /** The band designator — a device identifier (the Machine-Voice Rule). */
  BAND: "font-mono text-2xl leading-none font-semibold tabular-nums text-on-surface",
  /** Centre frequency, beside the designator. */
  FREQ: "text-xs font-medium text-on-surface-variant",
  /**
   * Channel width, top-right of the tile — its ORIGINAL corner, restored by
   * request after a round trip through the band/frequency row.
   *
   * `absolute`, NOT a third flex child of `TOP`. In the 3-column grid a tile's
   * content is only ~184px wide; `DISC` (40px) already shares that row with
   * the band/EARFCN text column, and reserving a further ~45px for a flex
   * sibling left the text column just 77px wide — narrow enough that every
   * token (band, frequency, `EARFCN`, its value, `PCI`, its value) fell onto
   * its own line, all measured live. Taking `BANDWIDTH` out of flow keeps the
   * text column at its un-squeezed ~132px, and `BAND_ROW`'s own `pr-11`
   * reserves this corner — scoped to that one row, not the whole `TEXT`
   * column, since the badge is only as tall as `BAND_ROW` — so nothing grows
   * underneath it. Live-measured clearance between the band/frequency text and
   * this badge is 27–41px across "B3", "B28" and "N78" test data, comfortably
   * clear without being wastefully wide. A machine figure, so it wears the
   * machine's voice. */
  BANDWIDTH:
    "absolute top-4 right-5 font-mono text-xs font-semibold tabular-nums text-on-surface-variant",
  /** The EARFCN / PCI line: raw machine strings, so mono. */
  DETAIL:
    "flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-on-surface-variant",
  /**
   * `mt-auto` pins the whole reading — RSRP+bar AND RSRQ/SINR together — to
   * the tile's floor, the same job the lone meter's `mt-auto` used to do. Grid
   * items stretch to the tallest cell in their row and content length varies
   * per carrier (a carrier missing PCI/EARFCN has one fewer detail segment),
   * so without this the reading floats wherever the text above it stops and a
   * row of tiles combs instead of reading as one comparable scale.
   */
  METRICS_GROUP: "mt-auto flex flex-col gap-1.5",
  /** RSRP and its bar — ONE visual object, not two, at a tight `gap-1`: the
   *  bar IS the RSRP reading, drawn as a length. */
  READING: "flex flex-col gap-1",
  RSRP_ROW: "flex items-baseline gap-1.5",
  /**
   * The headline RSRP figure. Carries NO colour of its own — the tone is the
   * ramp's numeral ink (`qualityInkClass`), and a ramp colour is only legal
   * beside a bar whose LENGTH carries the same reading, because adjacent stops
   * sit below the 0.05 CVD separation floor by design.
   *
   * `tabular-nums` and NOT mono: this figure changes while the user watches, and
   * the Machine-Voice Rule scopes mono to identifiers, not to live measurements.
   */
  RSRP: "text-lg font-semibold tabular-nums",
  RSRP_UNIT: "text-xs font-medium text-on-surface-variant",
  /** RSRQ/SINR, beneath the RSRP+bar pair at `METRICS_GROUP`'s `gap-1.5` —
   *  tighter than the tile's general `gap-2.5` rhythm, since this line is
   *  supporting detail for the reading directly above it. */
  SECONDARY:
    "flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-on-surface-variant",
} as const;

/**
 * The identity disc's fill: LTE violet / NR blue, never quality.
 *
 * THE STRONG FILL, not the container. The Glyph-Disc Rule puts identity on the
 * strong role precisely here — in light mode the identity CONTAINERS collapse
 * under deuteranopia and protanopia simulation and the fills do not, which is
 * the same measurement `radio/summary-tiles.tsx` records for its network tile.
 *
 * Quality is not in this function and must never be: the tile reports how good
 * the carrier is on its numeral and its bar (DESIGN.md > The signal quality
 * ramp), and the disc says only which radio the tile belongs to.
 */
export function carrierDiscTone(technology: "LTE" | "NR"): string {
  return technology === "NR"
    ? "bg-primary text-primary-foreground"
    : "bg-lte text-lte-foreground";
}

/**
 * The disc's glyph, by radio family. TWO DISTINCT MARKS, because the disc is a
 * single-slot indicator and the Every-Chip-Has-A-Glyph Rule forbids two states
 * sharing one — the disc's own fills are the identity pair that most needs a
 * second, non-chromatic channel.
 *
 * Keyed onto `MaterialSymbolName`, so a glyph missing from the font subset fails
 * the build rather than rendering as its own literal name. Both are already in
 * `components/ui/material-symbol-names.ts`, so this needs no font re-subset —
 * which matters, because `icons:subset` fetches from Google and cannot run
 * offline.
 */
export const CARRIER_DISC_GLYPH: Record<"LTE" | "NR", MaterialSymbolName> = {
  NR: "cell_tower",
  LTE: "signal_cellular_alt",
};

// -----------------------------------------------------------------------------
// The band chip
// -----------------------------------------------------------------------------

/**
 * The live ring: 2px inset, brand. Present iff the band is configured on the
 * modem right now. See THE TWO-AXIS BAND CHIP above for why this is a shadow
 * and not a border.
 */
export const BAND_CHIP_LIVE_RING = "shadow-[inset_0_0_0_2px_var(--primary)]";

export const BAND_CHIP = {
  /** The grid wrapper. Wraps rather than scrolls — a hidden band is an unlockable band. */
  GRID: "flex flex-wrap gap-2",
  /**
   * One chip.
   *
   * `h-10` is the paint; the `before:` overlay is the 44px hit target (see THE
   * TOUCH-TARGET FLOOR). `min-w-[3.5rem]` keeps "B1" and "B12" the same width so
   * the grid does not comb.
   *
   * Mono + tabular: a band designator is a device identifier, which the
   * Machine-Voice Rule puts in the machine's typeface.
   *
   * The transition names its properties rather than using `transition-all`: the
   * chip changes fill, ink and ring, and `transition-all` with no duration
   * silently inherits Tailwind's off-scale 150ms (The One-Scale Rule).
   */
  ROOT: [
    "relative inline-flex h-10 min-w-[3.5rem] items-center justify-center rounded-pill px-3.5",
    "font-mono text-[0.8125rem] font-semibold tabular-nums select-none",
    "transition-[color,background-color,box-shadow] duration-[var(--duration-standard)] ease-standard",
    "before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-['']",
    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ].join(" "),
  /** Skeleton mirror. Same height and minimum width as a real chip. */
  SKELETON: "h-10 w-[3.5rem] rounded-pill",
} as const;

/**
 * Chip fill by SELECTED state. Brand container, never a functional role — a
 * band you picked is not a band that is healthy, and `nr`/`lte` are identity
 * tones that the Identity-Never-Acts Rule keeps out of controls entirely.
 *
 * The unselected fill is `surface-container`, one step off the card, so the
 * grid reads as a field of blocks rather than as text floating on the card.
 *
 * BOTH hovers are `enabled:`-scoped. Tailwind's `hover:` does not exclude a
 * disabled element on its own, so an unscoped hover would light up every chip
 * on a scenario-gated card — advertising an interaction that is switched off,
 * which is the same class of lie as a status chip claiming a state the device
 * is not in.
 *
 * The selected hover is an alpha on the container, matching what
 * `components/ui/badge.tsx` already does for every tonal chip in the product.
 * That is the one sanctioned place for an alpha on a fill here: it is a
 * transient pointer tint on a surface whose resting colour is still the token,
 * not a compensation for a mismatched pair.
 *
 * MODULE-LOCAL on purpose. Its only consumer is `bandChipClass` below, and the
 * full class is what a component should be reaching for: a caller that composed
 * the fill by hand could pair it with the wrong `ROOT` or drop the live ring,
 * which is exactly the two-axis chip's one failure mode.
 */
function bandChipFill(selected: boolean): string {
  return selected
    ? "bg-primary-container text-on-primary-container enabled:hover:bg-primary-container/80"
    : "bg-surface-container text-on-surface-variant enabled:hover:bg-surface-container-high";
}

/**
 * The full chip class for a given (selected, live) pair.
 *
 * Both facts are also announced non-visually — see `bandChipA11yKey`, which
 * resolves to a distinct sentence per state. The ring is a shape signal rather
 * than a colour one, so it survives grayscale and every colour-vision
 * deficiency, but a screen reader gets the words regardless.
 */
export function bandChipClass(selected: boolean, live: boolean): string {
  return [
    BAND_CHIP.ROOT,
    bandChipFill(selected),
    live ? BAND_CHIP_LIVE_RING : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The i18n key describing a chip's state to assistive technology. Three
 * sentences, not a colour: "selected", "not selected", "selected and active on
 * the modem". A pending removal (live, not selected) reads as "not selected",
 * which is the truthful description of what applying would do.
 */
export function bandChipA11yKey(selected: boolean, live: boolean): string {
  if (selected && live) return "band_locking.a11y.band_live";
  return selected
    ? "band_locking.a11y.band_selected"
    : "band_locking.a11y.band_unselected";
}

/**
 * The legend under a grid that has at least one live band.
 *
 * The live swatch's label is "Currently locked", not "On the modem now" — the
 * hero above this card has its own, unrelated "On air now" block reading
 * `carrier_components` (what the radio is actually camped on this instant).
 * This ring reads `ue_capability_band` (what is CONFIGURED, whether or not the
 * radio is using it right now). Two different data sources, both describable
 * as "on the modem now" in the loose sense, which is exactly how they got
 * conflated — so the label names the CONFIGURATION fact explicitly instead.
 */
export const BAND_LEGEND = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant",
  ITEM: "inline-flex items-center gap-1.5",
  /** The swatch that stands in for a selected chip. */
  SWATCH_SELECTED: "size-3 rounded-pill bg-primary-container",
  /** The swatch that stands in for a live chip — ring only, no fill. */
  SWATCH_LIVE: `size-3 rounded-pill bg-surface-container ${BAND_CHIP_LIVE_RING}`,
} as const;

// -----------------------------------------------------------------------------
// Inline notice (the category card's error slot)
// -----------------------------------------------------------------------------

/**
 * The card-scoped error notice.
 *
 * This replaces the surface's single loudest legacy tell:
 * `bg-destructive/10 border border-destructive/30 text-destructive` — an
 * opacity wash propped up by a hairline drawn to compensate for it. A 10% alpha
 * over a tinted surface is not a stable colour: it collapses in dark mode and it
 * is the first thing to wash out in sunlight, which is the exact ambient
 * condition this product is designed against.
 *
 * `rounded-field` (20px) so it never out-rounds the 36px card hosting it.
 */
export const NOTICE = {
  ROOT: "flex items-start gap-3 rounded-field px-4 py-3 text-sm",
  /** Glyph-Disc Rule: the icon sits in a filled circle on the role's STRONG fill. */
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
} as const;

export const NOTICE_TONE = {
  fill: "bg-destructive-container text-on-destructive-container",
  disc: "bg-destructive text-destructive-foreground",
  glyph: "error" as MaterialSymbolName,
};

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * The action pill. Identical string to `radio/page-header.tsx`'s `PILL_ACTION`
 * and the custom-profiles contract — restated rather than imported so this
 * surface takes no dependency on an unrelated route's module graph.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The same pill without a leading-glyph gap, for a text-only action. */
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";

/**
 * The quick-select affordances (Select all / Clear). Deliberately smaller than
 * the two real actions: they change a selection, they do not write to the
 * modem, and sizing them like `Apply` would put three equal-weight pills in
 * one footer and lose which of them is consequential.
 *
 * Carries no fill or ink of its own — pair with `variant="tonal-neutral"` on
 * `Button`, never `variant="ghost"`. A ghost button has no resting fill at
 * all, so next to a filled `Apply` and an outlined `Restore all` it read as
 * disabled rather than as a third, quieter action. `tonal-neutral` gives it a
 * real (if muted) presence — `surface-container` — instead of asking the
 * reader to discover it by hovering.
 */
export const PILL_QUIET = "h-9 rounded-pill px-3.5 text-xs font-semibold";

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

/**
 * Failover state -> Badge variant + glyph.
 *
 * Keyed onto `BadgeVariant` rather than a class string, so a fifth state
 * without a matching role fails the build instead of shipping untinted.
 *
 * Every state carries a DISTINCT glyph. `ready` and `fallback` are the pair
 * that makes this mandatory rather than tidy: `success-container` and
 * `warning-container` measure 1.03:1 apart and are the SAME surface under
 * deuteranopia, so the glyph is the only channel separating "the safety net is
 * armed" from "the safety net has fired and your lock is not in force".
 */
export const FAILOVER_BADGE: Record<
  "disabled" | "fallback" | "monitoring" | "ready",
  { variant: BadgeVariant; glyph: MaterialSymbolName; spin?: boolean }
> = {
  // Deliberately off, not broken. `muted`, never `destructive`.
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  // Degraded but running: the modem is connected, just not where you told it.
  fallback: { variant: "warning", glyph: "warning" },
  // In progress routes to the BRAND container (the Info-Is-Brand Rule), so a
  // monitoring chip and a primary button differ by shape and glyph rather than
  // by owning two different blues.
  monitoring: { variant: "info", glyph: "progress_activity", spin: true },
  ready: { variant: "success", glyph: "check_circle" },
};

/**
 * Category-card status -> Badge variant + glyph.
 *
 * `unrestricted` is `success` and `locked` is `warning`, which is a deliberate
 * reading of the functional contract rather than a value judgement about
 * locking: a narrowed band list is the state that can cost you the connection,
 * and `warning` means "degraded / constrained", not "you did something wrong".
 * `scenario` is `info` because something else owns the setting right now — a
 * standing condition, not a fault.
 *
 * Keyed on `BandPosture` plus the one non-posture state this map also serves,
 * so a new posture without a chip fails the build here rather than at the two
 * call sites that index it.
 */
export const CATEGORY_BADGE: Record<
  BandPosture | "scenario",
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  scenario: { variant: "info", glyph: "shield" },
  unrestricted: { variant: "success", glyph: "lock_open" },
  locked: { variant: "warning", glyph: "lock" },
  // A category the modem has never reported a supported-band list for — see
  // `categoryPosture`. Muted, same as any other "nothing to report" state.
  //
  // `help`, not `schedule`: a clock reads as pending or scheduled, and this
  // state is neither. It is also the mark `POSTURE_GLYPH.unknown` now carries,
  // deliberately — the rail's disc summarises these rows and has to speak their
  // vocabulary.
  unknown: { variant: "muted", glyph: "help" },
  // The band READ failed. Also `muted` — nothing about the radio is degraded,
  // we simply do not have the answer — but it must not share `help` with
  // `unknown`: the two say different things ("the modem carries no such list"
  // vs "we could not fetch the list it carries"), and no two states in one slot
  // may share a glyph. `visibility_off` is the "we cannot see it" mark and is
  // unused anywhere else on this surface.
  unavailable: { variant: "muted", glyph: "visibility_off" },
};

/** Badge glyph size. Matches the `[&>svg]:size-3` slot `Badge` reserves. */
export const BADGE_GLYPH_SIZE = 12;

export type BandPosture =
  | "locked"
  | "unrestricted"
  | "unknown"
  | "unavailable";

/**
 * One category's posture, derived the same way in the hero's per-category
 * summary and `BandGridCard`'s own status badge — a single definition so the
 * two can never quietly disagree about what "unrestricted" means.
 *
 * `unknown` is a real state, not a loading placeholder: a modem that has not
 * reported a supported-band list yet must not be called "unrestricted" — that
 * would assert "all supported bands available" about a list nobody has seen.
 *
 * -----------------------------------------------------------------------------
 * WHY `hasReading` IS A PARAMETER AND NOT AN INFERENCE
 * -----------------------------------------------------------------------------
 * `locked: []` IS NOT A MODEM STATE. The modem has no concept of an empty band
 * restriction, and `unlockAll` refuses an empty supported list — so an empty
 * locked array only ever arrives one way: `current.sh` failed and the caller
 * fell back to `[]`. That failure is routine rather than exotic (`qcmd` gives a
 * 5s flock budget and the poller re-takes the AT mutex every ~4s, so a page load
 * can simply lose the race).
 *
 * The supported list comes from a DIFFERENT source — the poller snapshot — so it
 * stays fully populated through that failure. The two branches below therefore
 * saw `locked=[] supported=[31 bands]` and reported "Locked · 0 of 31 bands
 * allowed": a failure signature dressed up as a radio state, on the one page
 * whose job is saying what the radio is really set to.
 *
 * Nothing in the two arrays can tell that case apart from a genuine read, which
 * is why the caller has to say. `hasReading` is `currentBands !== null` at the
 * coordinator — a boolean, deliberately, rather than making `locked` nullable
 * and rippling optionality into the chip grids and the pending-change count for
 * no additional truth.
 *
 * The `!hasReading` branch is FIRST and every branch below it is unchanged: an
 * empty locked list from a SUCCESSFUL read still reads `locked`, which is
 * correct for that (contradictory, but genuinely reported) case.
 */
export function categoryPosture(
  locked: number[],
  supported: number[],
  hasReading: boolean,
): BandPosture {
  if (!hasReading) return "unavailable";
  if (supported.length === 0) return "unknown";
  if (locked.length === 0) return "locked";
  return locked.length >= supported.length &&
    locked.every((b) => supported.includes(b))
    ? "unrestricted"
    : "locked";
}

/**
 * The rail disc's glyph, by the modem's OVERALL posture.
 *
 * THE EVERY-CHIP-HAS-A-GLYPH RULE IS HERO-SCOPED, NOT COMPONENT-SCOPED, and
 * that is what set these values. `unrestricted` was `cell_tower` — the
 * same mark `CARRIER_DISC_GLYPH` gives the NR carrier, on the same `bg-primary`
 * fill, one flex row away inside the same hero. A reader would have seen one
 * glyph meaning "no band restrictions" and an identical glyph meaning "this is
 * the 5G leg". `locked` was `settings_input_antenna`, which named the hardware
 * rather than the state at all.
 *
 * They key onto `CATEGORY_BADGE`'s vocabulary instead — `lock` / `lock_open` —
 * and that reuse is correct rather than a collision: the disc SUMMARISES the
 * three rows directly beneath it, so saying the same thing in the same mark is
 * the point. A disc that summarised those rows in a private vocabulary would be
 * the actual defect.
 *
 * `unknown` is `help`, not `schedule`. A clock reads as pending or scheduled,
 * and this state is neither: `categoryPosture` returns `unknown` only when the
 * modem's SUPPORTED-band list is empty, which means "never reported", not "still
 * loading" — a loading rail draws `SKELETON_SHAPE.HERO_DISC` and never reaches
 * this map at all. `CATEGORY_BADGE.unknown` was moved to `help` in the same
 * change so the disc and the rows it summarises cannot disagree.
 *
 * `unavailable` is `visibility_off` and shares `CATEGORY_BADGE.unavailable`'s
 * mark for the same summarising reason — the disc speaks the rows' vocabulary.
 * It must not borrow `unknown`'s `help`: "the modem carries no such list" and
 * "we could not fetch the list it carries" are different facts with different
 * fixes, and the glyph is the only channel separating two `muted` chips.
 *
 * All four are already in the subset allowlist
 * (`components/ui/material-symbol-names.ts`), so this surface needs no font
 * regeneration — which matters, because `icons:subset` fetches from Google and
 * cannot run offline. None of the four is used anywhere else in this hero.
 */
export const POSTURE_GLYPH: Record<BandPosture, MaterialSymbolName> = {
  locked: "lock",
  unrestricted: "lock_open",
  unknown: "help",
  unavailable: "visibility_off",
};

/** The rail row's own short badge label, distinct from the category card's
 *  ("Locked" vs the card's "{{count}} of {{total}} locked") — the rail already
 *  prints the ratio on its own line, so repeating it inside the badge would be
 *  the same number twice in one row. */
export function railStatusKey(posture: BandPosture): string {
  return `band_locking.live.rail_status_${posture}`;
}

// -----------------------------------------------------------------------------
// Skeleton mirrors
// -----------------------------------------------------------------------------

/**
 * Loaded geometry, restated once so the skeletons can mirror it by IMPORT
 * rather than by estimate. The incumbent loading branch guessed `h-9 w-40` for a
 * footer button that renders at 42px, and `size-4` slivers for a control that no
 * longer exists — a skeleton that mirrors nothing makes the handoff jump worse,
 * not better.
 *
 * Sizes are the loaded element's LINE BOX, not its font size: a skeleton sized
 * to the glyph reflows the moment real text lands.
 */
export const SKELETON_SHAPE = {
  /** Card title (18px/600) and description (14px) line boxes. */
  CARD_TITLE: "h-5 w-28",
  CARD_DESC: "h-4 w-52",
  /** The status chip in a card header. */
  CARD_CHIP: "h-5 w-24",
  /** One band chip. */
  CHIP: BAND_CHIP.SKELETON,
  /** How many chip placeholders a loading grid draws. */
  CHIP_COUNT: 12,
  /** The footer's primary action, at the real 42px pill height. */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-44 rounded-pill",
  /** Hero rail: disc and one category row. */
  HERO_DISC: "size-11 rounded-pill",
  RAIL_ROW: "h-[3.375rem] w-full rounded-field",
  /**
   * The failover row and one on-air tile, mirroring the loaded element's height
   * BY IMPORT rather than by a restated number.
   *
   * `ONAIR_TILE` used to read `h-[6.5rem]` — a FIXED 104px asserted about a tile
   * that carried no height at all. See `ONAIR_TILE_MIN_H` for the current
   * measured anatomy and why the shared value is a binding floor rather than a
   * pin.
   */
  HERO_ROW: `${HERO_ROW_MIN_H} w-full rounded-field`,
  ONAIR_TILE: `${ONAIR_TILE_MIN_H} rounded-tile`,
} as const;

// -----------------------------------------------------------------------------
// Category identity
// -----------------------------------------------------------------------------

/**
 * The i18n key stem for a category's card copy and its short name.
 *
 * THIS EXISTS TO KILL A TRANSLATION-INDUCED BUG. The incumbent built toast copy
 * by string surgery on the rendered English title:
 *
 *     toast.success(`${title.replace(" Locking", "")} bands locked successfully`)
 *
 * The moment those titles are translated — which is the first thing any i18n
 * pass does, because they are the most visible strings on the page — the
 * `.replace()` stops matching and the toast reads "LTE Band Locking bands locked
 * successfully" in English beside a translated title. No gate can see that:
 * `i18n:check` grades missing keys as warnings and exits 0, and a literal has no
 * key to be missing in the first place.
 *
 * Keying the short name off the CATEGORY instead of off the rendered title means
 * the two can never drift, in any locale.
 */
export function categoryTitleKey(category: BandCategory): string {
  return `band_locking.categories.${category}.title`;
}

export function categoryDescriptionKey(category: BandCategory): string {
  return `band_locking.categories.${category}.description`;
}

export function categoryShortKey(category: BandCategory): string {
  return `band_locking.short.${category}`;
}

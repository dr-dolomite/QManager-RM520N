"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { bandFrequencyMhz } from "@/lib/band-frequency";
import {
  BAND_CATEGORIES,
  type BandCategory,
  type FailoverState,
} from "@/types/band-locking";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  type CarrierComponent,
} from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  BAND_HERO,
  CARRIER_DISC_GLYPH,
  CATEGORY_BADGE,
  FAILOVER_BADGE,
  HERO_EYEBROW,
  HERO_ONAIR_ABSENT,
  HERO_ONAIR_GRID,
  HERO_ONAIR_PANEL,
  HERO_ONAIR_TILE,
  HERO_RAIL_DISC,
  HERO_RAIL_PANEL,
  HERO_RAIL_ROW,
  HERO_RAIL_ROW_LABEL,
  HERO_RAIL_ROW_RATIO,
  HERO_RAIL_SUBTITLE,
  HERO_RAIL_TITLE,
  HERO_ROW,
  HERO_ROW_LABEL,
  HERO_SPLIT,
  POSTURE_GLYPH,
  SKELETON_SHAPE,
  carrierDiscTone,
  categoryPosture,
  categoryShortKey,
  railStatusKey,
  type BandPosture,
} from "./shapes";

// =============================================================================
// LiveBandHero — what the modem is doing right now
// =============================================================================
// The page's anchor card, and the read-only half of Band Locking. Shape is
// "2a" ("Compact tile grid") from the Band Locking Hero Options design
// exploration (`claude.ai/design/p/681e72a4-…`), picked over the incumbent
// single-column layout for the same reason the exploration's own notes give:
// the old hero stacked three unrelated full-width strips inside one card, so
// the tallest element on the page was also the emptiest, the most valuable
// live fact (what the radio is actually camped on) sat last and smallest, and
// a posture summary restated what each category card's own corner badge
// already said.
//
// -----------------------------------------------------------------------------
// TWO PANELS AND A ROW, ONE HERO
// -----------------------------------------------------------------------------
// Left: `HERO_ONAIR_PANEL`, a fixed 3-column grid of carrier tiles — what the
// radio is doing right now, borrowed in spirit from the dashboard's own
// carrier tiles (`components/dashboard/carrier-aggregation.tsx`).
// Right: `HERO_RAIL_PANEL`, a posture rail naming each category with its real
// ratio and a row that scrolls to the card that changes it.
// Below both, spanning the hero: `HERO_ROW`, the failover switch — see that
// constant for why it is no longer docked to the rail's foot.
// See `shapes.ts` for why both panels are `rounded-card`, not a second
// `rounded-hero`.
//
// -----------------------------------------------------------------------------
// THE TILE BODY IS NEUTRAL AND THE DISC CARRIES THE COLOUR
// -----------------------------------------------------------------------------
// The tile used to paint a saturated identity fill across its whole body. That
// composition is retired here for the reasons `HERO_ONAIR_TILE` records in
// full: it forced a hand-rolled third chip form, it made the meter fight the
// ground it was drawn on, and it structurally excluded the five-stop signal
// ramp from the one measurement the tile exists to report. Colour belongs to
// the reading, not to the container holding it.
//
// Two consequences worth naming at the call site:
//
//   PCC PRIMACY IS NOW ORDER, NOT COLOUR. The lead carrier used to be findable
//   by its strong fill. `sortCarriers()` puts it first instead, which is a
//   channel that survives grayscale, sunlight and every colour-vision
//   deficiency — none of which the fill did.
//
//   THE RAMP REPLACES A RIVAL RSRP SCALE. This file used to length its meter
//   with `lib/carrier-aggregation.ts`'s own dBm→percent mapping, which carries
//   its own floor/ceiling constants beside the `RSRP_THRESHOLDS` every other
//   `/cellular/` surface reads. Quality now routes through the ONE map
//   (`components/cellular/signal-quality-display.ts`) that DESIGN.md names, so
//   this tile and the antenna surfaces cannot disagree about what "fair" is.
//
// -----------------------------------------------------------------------------
// THE ON-AIR GRID READS RAW `carrier_components`, NOT `EnrichedCarrier[]`
// -----------------------------------------------------------------------------
// `lib/radio-info.ts`'s `enrichCarriers()` — the dashboard's own pipeline —
// needs a release-reconciliation history, the current network type and the
// serving NR ARFCN/SCS, none of which this hero receives or needs. A tile here
// answers one question ("is this band actually on air") and disappears the
// instant the modem stops reporting it; it does not need to remember that a
// carrier existed a moment ago.
// =============================================================================

export interface LiveBandHeroProps {
  failover: FailoverState;
  /** Active carrier components from `useModemStatus` (QCAINFO). */
  carrierComponents: CarrierComponent[];
  /** Hardware-supported bands per category (from `policy_band`). */
  supportedBands: Record<BandCategory, number[]>;
  /** Bands currently configured on the modem per category (`ue_capability_band`). */
  lockedBands: Record<BandCategory, number[]>;
  /**
   * False when `current.sh` failed and `lockedBands` is the coordinator's `[]`
   * fallback rather than the modem's answer.
   *
   * `supportedBands` comes from the poller snapshot and survives that failure
   * intact, so without this flag the rail printed a fully-populated denominator
   * against a fabricated zero — "Locked · 0 of 31 bands allowed". See
   * `categoryPosture` in `shapes.ts`.
   */
  hasCurrentReading: boolean;
  onToggleFailover: (enabled: boolean) => Promise<boolean>;
  isLoading: boolean;
  /** True when a Custom SIM Profile or Connection Scenario owns radio config. */
  isGated?: boolean;
}

/** Which of the four failover states is in force. Order is significant. */
function failoverKey(
  failover: FailoverState,
): "disabled" | "fallback" | "monitoring" | "ready" {
  if (!failover.enabled) return "disabled";
  // `activated` outranks `watcher_running`: a watcher that has already fired is
  // reporting a fallback, not progress, even while it keeps running.
  if (failover.activated) return "fallback";
  if (failover.watcher_running) return "monitoring";
  return "ready";
}

/**
 * On-air carriers, ordered PCC first then by radio family (LTE before NR) —
 * the LTE leg is the anchor in NSA, so it is the one a reader looks for first
 * when a 5G connection misbehaves. `Array.prototype.sort` is stable, so
 * carriers within the same rank keep the order the radio reported them in.
 *
 * THIS IS NOW THE ONLY CHANNEL CARRYING LEAD PRIMACY. The tile body used to
 * mark the PCC with a strong identity fill; the body is neutral now, so
 * position is what says which carrier anchors the camp. Do not "tidy" this
 * back to the order the modem reported.
 */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const leadRank = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const techRank = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return leadRank(a) - leadRank(b) || techRank(a) - techRank(b);
  });
}

/**
 * The absent radio leg named beside a lone carrier, filling the grid's second
 * cell instead of leaving it bare. The fixed 3-column `HERO_ONAIR_GRID` no
 * longer needs a dedicated solo layout to avoid stretching a lone tile — a
 * single grid item just takes one column — so this cell's only job now is to
 * be informative, not to hold the row's shape together.
 *
 * IT RENDERS ONLY IN THE SOLO CASE, deliberately. It is a layout device that
 * happens to be informative, not a standing "what you are missing" panel: with
 * four LTE carriers aggregated the grid already fills its row honestly, and
 * adding a fifth cell saying "no 5G" there would be an editorial claim that the
 * absence is a fault. At one carrier the cell has to exist for the row to read
 * at all, so it may as well say the useful thing.
 *
 * `technology` is the lone carrier's own radio, so the cell names the OTHER
 * one: an LTE-only camp is missing its NR leg, an SA camp is missing its LTE
 * anchor. Both are real, reportable states of this modem.
 */
function AbsentLegCell({ technology }: { technology: "LTE" | "NR" }) {
  const { t } = useTranslation("cellular");
  // The lone carrier is LTE => the NR leg is what is absent, and vice versa.
  const absent = technology === "LTE" ? "nr" : "lte";
  return (
    <div className={HERO_ONAIR_ABSENT.ROOT} role="listitem">
      {/* Same glyph as the on-air EMPTY state, and that reuse is safe rather
          than sloppy: the two are mutually exclusive by construction (the empty
          state replaces the whole grid; this cell only exists when the grid has
          exactly one tile), so they can never share a frame and be confused for
          each other. The allowlist has no `signal_cellular_nodata`, and adding
          one costs a font re-subset that `icons:subset` can only do online. */}
      <span className={HERO_ONAIR_ABSENT.DISC} aria-hidden="true">
        <MaterialSymbol name="signal_cellular_off" size={20} />
      </span>
      <p className={HERO_ONAIR_ABSENT.TITLE}>
        {t(`band_locking.live.absent_${absent}_title`)}
      </p>
      <p className={HERO_ONAIR_ABSENT.BODY}>
        {t(`band_locking.live.absent_${absent}_body`)}
      </p>
      {/* Borrowed from `radio_info.bands.scanner.link`, not duplicated under
          `band_locking.*` — the same convention this tile already uses for
          `units.mhz` and `detail.pci`. It is the identical sentence pointing at
          the identical route, already translated in all five locales; a second
          key would only be a second thing to translate and a second thing to
          drift. */}
      <Link href="/cellular/cell-scanner" className={HERO_ONAIR_ABSENT.LINK}>
        {t("radio_info.bands.scanner.link")}
        <MaterialSymbol name="chevron_right" size={16} />
      </Link>
    </div>
  );
}

/** Scrolls a category's `BandGridCard` into view. A rail row's chevron only
 *  earns its place if it actually goes somewhere — see `HERO_RAIL_ROW`. */
function scrollToCategory(category: BandCategory) {
  document
    .getElementById(`band-locking-card-${category}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LiveBandHero({
  failover,
  carrierComponents,
  supportedBands,
  lockedBands,
  hasCurrentReading,
  onToggleFailover,
  isLoading,
  isGated = false,
}: LiveBandHeroProps) {
  const { t } = useTranslation("cellular");

  const onAir = useMemo(
    () => sortCarriers(carrierComponents),
    [carrierComponents],
  );
  const totalMhz = useMemo(
    () => onAir.reduce((sum, c) => sum + (c.bandwidth_mhz > 0 ? c.bandwidth_mhz : 0), 0),
    [onAir],
  );

  // One posture per category, not one number summed across three unrelated
  // band lists — see `categoryPosture` for why the summed headline this
  // replaced could not be acted on.
  const postures = useMemo(
    () =>
      BAND_CATEGORIES.map((category) => ({
        category,
        posture: categoryPosture(
          lockedBands[category],
          supportedBands[category],
          hasCurrentReading,
        ),
      })),
    [lockedBands, supportedBands, hasCurrentReading],
  );

  const restrictedCount = postures.filter((p) => p.posture === "locked").length;
  const unrestrictedCount = postures.filter(
    (p) => p.posture === "unrestricted",
  ).length;
  const reportedCount = restrictedCount + unrestrictedCount;

  /**
   * The modem's AGGREGATE posture — a value this page did not previously have.
   *
   * `categoryPosture()` is per-category, and the subtitle below has FOUR
   * branches where `POSTURE_GLYPH` has three keys, so there was nothing for the
   * disc to index and it hard-coded `settings_input_antenna` for every state. A
   * single-slot indicator that cannot indicate: locked, unrestricted and
   * never-reported all wore one mark, and the disc's `bg-primary` fill said
   * "brand", not "state".
   *
   * The collapse from four subtitle branches to three glyph states happens on
   * one rule: ANY RESTRICTION AT ALL IS A LOCKED POSTURE. The disc answers "is
   * this modem restricted?", and partial is still yes — so `all` and `partial`
   * share `locked` while the subtitle keeps telling them apart in words.
   *
   * `unknown` means the modem has NEVER REPORTED a supported-band list, not that
   * we are waiting for one: `categoryPosture` returns it only for an empty
   * supported list, and a loading rail draws a skeleton disc instead of reaching
   * this map at all.
   *
   * `unavailable` is checked FIRST and cannot be derived from the counts. A
   * failed read makes all three categories `unavailable`, which leaves both
   * counters at zero — arithmetically identical to "the modem reported no
   * supported bands", so the disc would have claimed `unknown` while the
   * supported lists sat fully populated one column away.
   */
  const overallPosture: BandPosture = !hasCurrentReading
    ? "unavailable"
    : reportedCount === 0
      ? "unknown"
      : restrictedCount === 0
        ? "unrestricted"
        : "locked";

  const subtitle =
    overallPosture === "unavailable"
      ? t("band_locking.live.rail_subtitle_unavailable")
      : overallPosture === "unknown"
        ? t("band_locking.live.rail_subtitle_unknown")
        : overallPosture === "unrestricted"
          ? t("band_locking.live.rail_subtitle_none")
          : restrictedCount === postures.length
            ? t("band_locking.live.rail_subtitle_all")
            : t("band_locking.live.rail_subtitle_partial", {
                count: restrictedCount,
                total: postures.length,
              });

  const handleToggle = async (checked: boolean) => {
    const ok = await onToggleFailover(checked);
    if (ok) {
      toast.success(
        checked
          ? t("band_locking.live.failover_toast_enabled")
          : t("band_locking.live.failover_toast_disabled"),
      );
    } else {
      toast.error(t("band_locking.live.failover_toast_error"));
    }
  };

  const status = FAILOVER_BADGE[failoverKey(failover)];

  return (
    <section className={BAND_HERO} aria-label={t("band_locking.live.title")}>
      <div className={HERO_SPLIT}>
        {/* --- On air now --------------------------------------------------- */}
        <div className={HERO_ONAIR_PANEL}>
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex size-2" aria-hidden="true">
              <span className="animate-live-ping absolute inset-0 rounded-pill bg-success motion-reduce:animate-none" />
              <span className="relative size-2 rounded-pill bg-success" />
            </span>
            <span className={HERO_EYEBROW}>
              {t("band_locking.live.on_air")}
            </span>
            {onAir.length > 0 ? (
              <span className="ml-auto text-xs text-on-surface-variant tabular-nums">
                {t("band_locking.live.on_air_summary", {
                  count: onAir.length,
                  mhz: totalMhz,
                })}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className={HERO_ONAIR_GRID}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className={SKELETON_SHAPE.ONAIR_TILE} />
              ))}
            </div>
          ) : onAir.length === 0 ? (
            /* The shared `/cellular/` condition primitive, not a hand-rolled
               block — this surface was the last one on the route still drawing
               its own.

               `tone="neutral"` and `ariaRole="status"`: nothing is WRONG. The
               modem simply is not camped on anything right now, which `warning`
               would overstate and `destructive` would misreport as a fault the
               user has to fix. Neutral is the honest reading, and it is the same
               call `radio/states.tsx` makes for its own `unknown` mode.

               No `spin`, deliberately — a spinner on a standing condition
               advertises work that is not happening.

               `rounded-tile` steps the block down from the primitive's own
               `rounded-hero` (40px), which would out-round the `rounded-card`
               panel hosting it. `bg-surface` overrides the neutral tone's
               `bg-surface-container`, which is byte-identical to this panel's
               own ground and would leave the block with no visible edge; it also
               matches `HERO_ONAIR_ABSENT`, so every "not a carrier" cell in this
               panel sits on one surface. */
            <ConditionScreen
              tone="neutral"
              glyph="signal_cellular_off"
              ariaRole="status"
              title={t("band_locking.live.on_air_empty_title")}
              description={t("band_locking.live.on_air_empty_body")}
              className="rounded-tile bg-surface py-10"
            />
          ) : (
            <div className={HERO_ONAIR_GRID} role="list">
              {onAir.map((c) => {
                const quality = getSignalQuality(c.rsrp, RSRP_THRESHOLDS);
                // `null` for `none`, and that single null drives all three
                // channels below: no meter fill, no ramp ink on the numeral, and
                // the em-dash instead of a reading.
                //
                // THE NULL IS DECIDED HERE, UPSTREAM OF `signalToProgress`, and
                // it has to be. That function returns 0 — not null — for a
                // missing reading, so feeding it straight to `MetricBar` would
                // make `hasReading` true, render a fill, and the ramp-floor
                // branch would give it a visible stub: a red dot beside a red
                // numeral, inventing a signal problem for a carrier the modem
                // reported nothing about. `metric-bar.tsx` documents that exact
                // bug on its own `value` prop.
                const rsrpTone = qualityMeterTone(quality);
                const rsrpPercent =
                  rsrpTone === null
                    ? null
                    : signalToProgress(c.rsrp, RSRP_THRESHOLDS);
                const freqMhz = bandFrequencyMhz(c.technology, c.band);
                const detailSegments = [
                  c.earfcn === null
                    ? null
                    : `${t("band_locking.live.tile_earfcn")} ${c.earfcn}`,
                  c.pci === null
                    ? null
                    : `${t("radio_info.bands.detail.pci")} ${c.pci}`,
                ].filter((segment): segment is string => segment !== null);
                const secondaryMetrics = [
                  c.rsrq === null
                    ? null
                    : `${t("radio_info.bands.metric.rsrq")} ${t("band_locking.live.tile_rsrq", { value: c.rsrq })}`,
                  c.sinr === null
                    ? null
                    : `${t("radio_info.bands.metric.sinr")} ${t("band_locking.live.tile_sinr", { value: c.sinr })}`,
                ].filter((segment): segment is string => segment !== null);

                return (
                  <div
                    key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}`}
                    role="listitem"
                    className={HERO_ONAIR_TILE.ROOT}
                    // The visible `nr`/`lte` and `PCC`/`SCC` tags this tile used
                    // to carry are gone — the disc's fill and glyph say which
                    // radio, and `sortCarriers()`'s ordering says which carrier
                    // leads (see `HERO_ONAIR_TILE`'s header comment in
                    // `shapes.ts`) — but that fact still needs to reach a screen
                    // reader in words, so it moves here.
                    aria-label={`${t(`band_locking.live.tile_tech_${c.technology}`)} ${c.type}`}
                  >
                    {/* Channel bandwidth, pinned to the tile's top-right
                        corner — `absolute`, out of `TOP`'s flow entirely. See
                        `HERO_ONAIR_TILE.BANDWIDTH` for why. */}
                    <span className={HERO_ONAIR_TILE.BANDWIDTH}>
                      {t("radio_info.bands.units.mhz", {
                        value: c.bandwidth_mhz,
                      })}
                    </span>

                    {/* Disc centred against the band/EARFCN text pair. */}
                    <div className={HERO_ONAIR_TILE.TOP}>
                      <span
                        aria-hidden="true"
                        className={`${HERO_ONAIR_TILE.DISC} ${carrierDiscTone(c.technology)}`}
                      >
                        <MaterialSymbol
                          name={CARRIER_DISC_GLYPH[c.technology]}
                          size={20}
                          filled
                        />
                      </span>
                      <div className={HERO_ONAIR_TILE.TEXT}>
                        {/* Band designator + centre frequency, one row. */}
                        <div className={HERO_ONAIR_TILE.BAND_ROW}>
                          <span className={HERO_ONAIR_TILE.BAND}>{c.band}</span>
                          {freqMhz === null ? null : (
                            <span className={HERO_ONAIR_TILE.FREQ}>
                              {t("radio_info.bands.units.mhz", {
                                value: freqMhz,
                              })}
                            </span>
                          )}
                        </div>

                        {/* EARFCN / PCI — omits whatever the modem did not
                            report for THIS component rather than padding with
                            a placeholder. Separate flex children with a real
                            gap, not a joined separator glyph, so the segments
                            space themselves consistently regardless of font
                            metrics. */}
                        {detailSegments.length > 0 ? (
                          <div className={HERO_ONAIR_TILE.DETAIL}>
                            {detailSegments.map((segment) => (
                              <span key={segment}>{segment}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* RSRP tightly paired with its own bar — the bar IS the
                        RSRP reading, drawn as a length — then RSRQ/SINR beneath
                        at a reduced gap. Pinned to the tile's floor as one
                        group, replacing the old lone `mt-auto` meter. */}
                    <div className={HERO_ONAIR_TILE.METRICS_GROUP}>
                      <div className={HERO_ONAIR_TILE.READING}>
                        <div className={HERO_ONAIR_TILE.RSRP_ROW}>
                          {/* THE FIGURE AND THE BAR BELOW IT ARE ONE OBJECT. The
                              ramp's numeral ink is only legal beside a bar whose
                              LENGTH carries the same reading — adjacent ramp stops
                              sit below the 0.05 CVD separation floor by design, so
                              a tinted numeral alone would be a colour-only channel
                              (DESIGN.md > The signal quality ramp). With no
                              reading, `qualityInkClass("none")` returns neutral
                              ink, so the em-dash carries no ramp colour at all. */}
                          <span
                            className={`${HERO_ONAIR_TILE.RSRP} ${qualityInkClass(quality)}`}
                          >
                            {c.rsrp === null
                              ? t("band_locking.live.tile_no_value")
                              : t("band_locking.live.tile_rsrp", {
                                  value: c.rsrp,
                                })}
                          </span>
                          <span className={HERO_ONAIR_TILE.RSRP_UNIT}>
                            {t("radio_info.bands.metric.rsrp")}
                          </span>
                          {/* The non-chromatic channel, and the third leg of the
                              ink/bar pair. Announced for an absent reading too: an
                              empty track and a full one differ by pixels no screen
                              reader can see. Borrowed from `radio_info.bands.*`,
                              the same convention this tile already uses for
                              `units.mhz` and `detail.pci` — those six keys already
                              match the `SignalQuality` union exactly, so a
                              `band_locking.*` copy would only be a seventh thing
                              to translate and a seventh thing to drift. */}
                          <span className="sr-only">
                            {t(`radio_info.bands.quality.${quality}`)}
                          </span>
                        </div>

                        {/* `aria-hidden`: the bar is the ramp ink's required second
                            visual channel, and its reading is already announced in
                            words by the `sr-only` quality label above.

                            THE SCALE SATURATES, DELIBERATELY. `signalToProgress`
                            maps [floor, excellent] => [0, 100], so the top of this
                            bar is `RSRP_THRESHOLDS.excellent` (-80 dBm) and EVERY
                            reading at or above it pins at 100% — a more optimistic
                            read than the `lib/carrier-aggregation.ts` scale this
                            replaced. Do not patch that here: the canonical map
                            already lengths
                            the bars on `tower-locking` and both antenna surfaces,
                            so a local remap would be the sixth rival RSRP scale
                            this change exists to delete. Fix it for the whole
                            family or not at all. */}
                        <div aria-hidden="true">
                          <MetricBar
                            value={rsrpPercent}
                            max={100}
                            // Unreachable, and REQUIRED — `MetricBar` is
                            // higher-is-worse, so omitting these or leaving them at
                            // a real threshold would paint a strong signal
                            // `destructive`. `colorOverride` pins the tone instead.
                            warnAt={101}
                            dangerAt={101}
                            // Null passes straight through, never a fallback colour
                            // — with no reading there is no fill for it to tint.
                            colorOverride={rsrpTone}
                            // The tile is `bg-surface`, so the default `muted` track
                            // would nearly vanish against it.
                            track="surface-container-high"
                          />
                        </div>
                      </div>

                      {secondaryMetrics.length > 0 ? (
                        <div className={HERO_ONAIR_TILE.SECONDARY}>
                          {secondaryMetrics.map((segment) => (
                            <span key={segment}>{segment}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {/* One carrier => name the absent leg rather than leave it
                  as a bare gap in the grid. */}
              {onAir.length === 1 ? (
                <AbsentLegCell technology={onAir[0].technology} />
              ) : null}
            </div>
          )}
        </div>

        {/* --- Lock posture rail --------------------------------------------- */}
        <div className={HERO_RAIL_PANEL}>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Skeleton className={SKELETON_SHAPE.HERO_DISC} />
            ) : (
              <span className={HERO_RAIL_DISC} aria-hidden="true">
                {/* One glyph per posture, no sharing. See `overallPosture` for
                    why this stopped being a hard-coded mark. */}
                <MaterialSymbol
                  name={POSTURE_GLYPH[overallPosture]}
                  size={22}
                  filled
                />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={HERO_RAIL_TITLE}>
                {t("band_locking.live.eyebrow")}
              </span>
              {isLoading ? (
                <Skeleton className="h-3.5 w-40" />
              ) : (
                <span className={HERO_RAIL_SUBTITLE}>{subtitle}</span>
              )}
            </div>
          </div>

          {/* Natural height, deliberately. The rows are NOT stretched to fill
              the panel — see `HERO_SPLIT` for why the panels align to
              `items-start` instead now that the failover row has left the
              rail's foot. */}
          <div className="flex flex-col gap-2">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className={SKELETON_SHAPE.RAIL_ROW} />
                ))
              : postures.map(({ category, posture }) => {
                  const badge = CATEGORY_BADGE[posture];
                  // No ratio for a failed read. The denominator is real (it
                  // comes from the poller) and the numerator is not, so pairing
                  // them produced "0 of 31 bands allowed" — a fabricated count
                  // wearing the authority of a measured one. The row says it
                  // could not read instead, which is the fact we actually have.
                  const ratio =
                    posture === "unavailable"
                      ? t("band_locking.live.rail_unavailable")
                      : t("band_locking.live.rail_ratio", {
                          count: lockedBands[category].length,
                          total: supportedBands[category].length,
                        });
                  const statusLabel = t(railStatusKey(posture));
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => scrollToCategory(category)}
                      className={HERO_RAIL_ROW}
                      aria-label={`${t(categoryShortKey(category))} — ${ratio} — ${statusLabel}`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className={HERO_RAIL_ROW_LABEL}>
                          {t(categoryShortKey(category))}
                        </span>
                        <span className={HERO_RAIL_ROW_RATIO}>{ratio}</span>
                      </div>
                      <Badge variant={badge.variant} className="ml-auto flex-none">
                        <MaterialSymbol
                          name={badge.glyph}
                          size={BADGE_GLYPH_SIZE}
                        />
                        {statusLabel}
                      </Badge>
                      <MaterialSymbol
                        name="chevron_right"
                        size={20}
                        className="text-on-surface-variant flex-none transition-transform duration-[var(--duration-quick)] ease-out group-hover:translate-x-0.5"
                      />
                    </button>
                  );
                })}
          </div>
        </div>
      </div>

      {/* --- Failover ---------------------------------------------------------
          A HERO-LEVEL ROW, spanning both panels, not the rail's last child.

          `lock.sh` arms ONE watcher for the modem regardless of which category
          was written, so failover is a property of the modem rather than of any
          one of the rail's three category rows — docked to that list it read as
          a fourth category. And on a narrow container the hero drops to one
          column and the rail stacks LAST, which buried the one control that
          decides whether a mistaken lock is recoverable underneath everything it
          protects.

          THE HELP COPY STAYS IN ITS TOOLTIP. Promoting it to a standing line
          was tried and reverted: `69df6ac` ("drop over-explanatory info copy
          from lock/scanner surfaces") deliberately deleted a standing
          explanatory line from this exact panel, and this copy is written in
          on-demand-help register — it explains a hypothetical in 22 words and
          restates the premise of the four-state chip beside the switch. Extra
          width is not a reason to spend it on prose. */}
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
      ) : (
        <div className={HERO_ROW}>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className={HERO_ROW_LABEL}>
              {t("band_locking.live.failover_label")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A 22px disc whose `before:` overlay reaches the 44px this
                    project requires on coarse pointers, without adding a
                    layout box that would push the label off-centre. */}
                <button
                  type="button"
                  aria-label={t("band_locking.live.failover_help_label")}
                  className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring/50 relative grid size-[1.375rem] place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-[11px] before:content-[''] focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  <MaterialSymbol name="info" size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <p>{t("band_locking.live.failover_help")}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Badge variant={status.variant}>
              <MaterialSymbol
                name={status.glyph}
                size={BADGE_GLYPH_SIZE}
                className={
                  status.spin
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {t(`band_locking.live.failover_state.${failoverKey(failover)}`)}
            </Badge>
            <Switch
              id="band-failover"
              checked={failover.enabled}
              onCheckedChange={handleToggle}
              disabled={isGated}
              aria-label={t("band_locking.live.failover_label")}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default LiveBandHero;

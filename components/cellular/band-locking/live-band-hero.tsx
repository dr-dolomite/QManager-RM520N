"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { rsrpToPercent } from "@/lib/carrier-aggregation";
import {
  BAND_CATEGORIES,
  type BandCategory,
  type FailoverState,
} from "@/types/band-locking";
import type { CarrierComponent } from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  BAND_HERO,
  CATEGORY_BADGE,
  FAILOVER_BADGE,
  HERO_EYEBROW,
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
  HERO_SPLIT,
  SKELETON_SHAPE,
  carrierMeterTone,
  carrierTileTone,
  categoryPosture,
  categoryShortKey,
  railStatusKey,
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
// TWO PANELS, ONE HERO
// -----------------------------------------------------------------------------
// Left: `HERO_ONAIR_PANEL`, a wrapping grid of carrier tiles — what the radio
// is doing right now, borrowed in spirit from the dashboard's own carrier
// tiles (`components/dashboard/carrier-aggregation.tsx`) but cut to a single
// metric line, because this is half of a hero, not the whole page. Right:
// `HERO_RAIL_PANEL`, a posture rail naming each category with its real ratio
// and a row that scrolls to the card that changes it, with failover at its
// foot because it is the safety net for the locks beside it, not a fourth
// setting. See `shapes.ts` for why both panels are `rounded-card`, not a
// second `rounded-hero`.
//
// -----------------------------------------------------------------------------
// THE ON-AIR GRID READS RAW `carrier_components`, NOT `EnrichedCarrier[]`
// -----------------------------------------------------------------------------
// `lib/radio-info.ts`'s `enrichCarriers()` — the dashboard's own pipeline —
// needs a release-reconciliation history, the current network type and the
// serving NR ARFCN/SCS, none of which this hero receives or needs. A tile here
// answers one question ("is this band actually on air") and disappears the
// instant the modem stops reporting it; it does not need to remember that a
// carrier existed a moment ago. Tone still comes from the SAME two shared
// primitives the dashboard uses (`rsrpToPercent`, and the identity-not-quality
// rule in `carrierTileTone`/`carrierMeterTone`), so the two surfaces cannot
// quietly disagree about what a tile's colour means, even though neither
// imports the other's component.
// =============================================================================

export interface LiveBandHeroProps {
  failover: FailoverState;
  /** Active carrier components from `useModemStatus` (QCAINFO). */
  carrierComponents: CarrierComponent[];
  /** Hardware-supported bands per category (from `policy_band`). */
  supportedBands: Record<BandCategory, number[]>;
  /** Bands currently configured on the modem per category (`ue_capability_band`). */
  lockedBands: Record<BandCategory, number[]>;
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
 */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const leadRank = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const techRank = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return leadRank(a) - leadRank(b) || techRank(a) - techRank(b);
  });
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
        posture: categoryPosture(lockedBands[category], supportedBands[category]),
      })),
    [lockedBands, supportedBands],
  );

  const restrictedCount = postures.filter((p) => p.posture === "locked").length;
  const unrestrictedCount = postures.filter(
    (p) => p.posture === "unrestricted",
  ).length;
  const reportedCount = restrictedCount + unrestrictedCount;

  const subtitle =
    reportedCount === 0
      ? t("band_locking.live.rail_subtitle_unknown")
      : restrictedCount === 0
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
              <span className="ml-auto font-mono text-xs text-on-surface-variant tabular-nums">
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
            <div className="flex items-center gap-3.5 rounded-tile bg-surface px-5 py-5">
              <span className="bg-surface-container-high text-on-surface-variant grid size-11 flex-none place-items-center rounded-pill">
                <MaterialSymbol name="signal_cellular_off" size={22} />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">
                  {t("band_locking.live.on_air_empty_title")}
                </p>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  {t("band_locking.live.on_air_empty_body")}
                </p>
              </div>
            </div>
          ) : (
            <div className={HERO_ONAIR_GRID} role="list">
              {onAir.map((c) => {
                const isLead = c.type === "PCC";
                const pct = rsrpToPercent(c.rsrp);
                return (
                  <div
                    key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}`}
                    role="listitem"
                    className={`${HERO_ONAIR_TILE.ROOT} ${carrierTileTone(c.technology, isLead)}`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] opacity-85">
                      <span>
                        {t(
                          `band_locking.live.tile_tech_${c.technology}`,
                        )}{" "}
                        {c.type}
                      </span>
                      <span className="ml-auto font-mono tabular-nums">
                        {t("radio_info.bands.units.mhz", {
                          value: c.bandwidth_mhz,
                        })}
                      </span>
                    </div>
                    <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
                      {c.band}
                    </span>
                    <div className="flex items-baseline gap-1.5 font-mono text-xs tabular-nums opacity-85">
                      <span className="text-sm font-semibold">
                        {c.rsrp === null
                          ? t("band_locking.live.tile_no_value")
                          : t("band_locking.live.tile_rsrp", { value: c.rsrp })}
                      </span>
                      <span>
                        {c.pci === null
                          ? null
                          : `${t("radio_info.bands.detail.pci")} ${c.pci}`}
                      </span>
                    </div>
                    <div className={HERO_ONAIR_TILE.METER_TRACK}>
                      <div
                        className={`${HERO_ONAIR_TILE.METER_FILL} ${carrierMeterTone(c.technology)}`}
                        style={{ transform: `scaleX(${pct / 100})` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-on-surface-variant flex items-center gap-2.5 text-xs">
            <MaterialSymbol name="info" size={16} className="flex-none" />
            <span>{t("band_locking.live.on_air_note")}</span>
          </div>
        </div>

        {/* --- Lock posture rail --------------------------------------------- */}
        <div className={HERO_RAIL_PANEL}>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Skeleton className={SKELETON_SHAPE.HERO_DISC} />
            ) : (
              <span className={HERO_RAIL_DISC} aria-hidden="true">
                <MaterialSymbol name="settings_input_antenna" size={22} filled />
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

          <div className="flex flex-col gap-2">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className={SKELETON_SHAPE.RAIL_ROW} />
                ))
              : postures.map(({ category, posture }) => {
                  const badge = CATEGORY_BADGE[posture];
                  const ratio = t("band_locking.live.rail_ratio", {
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

          {/* --- Failover ---------------------------------------------------
              The safety net for every category, so it lives at the foot of the
              rail rather than with any one category row. */}
          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
          ) : (
            <div className={HERO_ROW}>
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="text-sm font-semibold">
                  {t("band_locking.live.failover_label")}
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* A 30px disc whose `before:` overlay reaches the 44px this
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
        </div>
      </div>
    </section>
  );
}

export default LiveBandHero;

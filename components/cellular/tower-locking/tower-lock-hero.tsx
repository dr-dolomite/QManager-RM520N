"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { rsrpToPercent } from "@/lib/carrier-aggregation";
import type { CarrierComponent } from "@/types/modem-status";
import {
  rsrpToQualityPercent,
  type TowerFailoverState,
  type TowerModemState,
} from "@/types/tower-locking";

import {
  BADGE_GLYPH_SIZE,
  FAILOVER_BADGE,
  FIELD_CONTROL,
  HERO_EYEBROW,
  HERO_HELP_BUTTON,
  HERO_ONAIR_ABSENT,
  HERO_ONAIR_GRID,
  HERO_ONAIR_PANEL,
  HERO_ONAIR_TILE,
  HERO_RAIL_DISC,
  HERO_RAIL_PANEL,
  HERO_RAIL_ROW,
  HERO_RAIL_ROW_LABEL,
  HERO_RAIL_ROW_TARGET,
  HERO_RAIL_SUBTITLE,
  HERO_RAIL_TITLE,
  HERO_REFRESH_BUTTON,
  HERO_ROW,
  HERO_ROW_LAST,
  HERO_SPLIT,
  HERO_STALENESS,
  LEG_BADGE,
  PERSIST_BADGE,
  SKELETON_SHAPE,
  TOWER_HERO,
  TOWER_LEGS,
  carrierMeterTone,
  carrierPillTone,
  carrierTileTone,
  failoverKey,
  legShortKey,
  persistPosture,
  type LegPosture,
  type TowerLeg,
} from "./shapes";

// =============================================================================
// TowerLockHero — what the modem is doing right now
// =============================================================================
// The page's anchor card, and the read-only half of Tower Locking. It absorbs
// the incumbent "Tower Locking Settings" card, which does not survive as a card
// for a reason worth stating: nine of its twelve rows were read-only status and
// the other three were settings that apply to BOTH radios at once. Sitting it
// in a 2x2 grid beside the two lock forms said it was the same kind of object
// as them, and it is not — this reports, they change.
//
// -----------------------------------------------------------------------------
// TWO PANELS, TWO CLOCKS
// -----------------------------------------------------------------------------
// Left: what the radio is camped on THIS INSTANT, straight off
// `carrier_components` in the ~4s poller snapshot.
// Right: the lock target read back from `AT+QNWLOCK`, which `status.sh` fetches
// ONCE ON MOUNT and never polls.
//
// Those two numbers sit inches apart and one of them can be an hour old, so the
// rail prints an explicit "as of HH:MM" and offers a re-read. See `shapes.ts` >
// THE TWO CLOCKS for why the answer is a timestamp rather than a poll interval:
// `status.sh` costs three AT commands on the same `/tmp/qmanager_at.lock` mutex
// the poller already contends for.
//
// -----------------------------------------------------------------------------
// THE TILES ARE THE PICKER
// -----------------------------------------------------------------------------
// Tower locking targets an (EARFCN, PCI) pair, and every carrier tile already
// displays exactly that pair. Making the user re-type those digits into a text
// box below is the whole reason a parallel "Simple Mode" dropdown had to exist.
// So each tile carries a "use this cell" control that fills the matching leg's
// form.
//
// The TILE ITSELF IS NOT A BUTTON, deliberately — it is painted in an identity
// fill (NR blue / LTE violet) and the Identity-Never-Acts Rule is explicit that
// no control is ever tinted by those. The action is a pill inside the tile,
// drawn in the tile's own ink. See `shapes.ts` for the full argument.
// =============================================================================

export interface TowerLockHeroProps {
  modemState: TowerModemState | null;
  failover: TowerFailoverState | null;
  /** Persist as the CONFIG believes it. The chip reports the MODEM instead. */
  configPersist: boolean;
  failoverThreshold: number;
  /** Live QCAINFO carriers from `useModemStatus`. */
  carrierComponents: CarrierComponent[];
  /** RSRP of the leg the modem is actually registered on, for the quality row. */
  activeRsrp: number | null;
  /** Which legs can currently accept a lock target from a tile. */
  canTarget: Record<TowerLeg, { ok: boolean; reasonKey: string | null }>;
  isLoading: boolean;
  isRefreshing: boolean;
  isSavingFailover: boolean;
  lastSyncedAt: number | null;
  onPickCarrier: (carrier: CarrierComponent) => void;
  onTogglePersist: (enabled: boolean) => Promise<boolean>;
  onToggleFailover: (enabled: boolean) => Promise<boolean>;
  onThresholdChange: (threshold: number) => Promise<boolean>;
  onRefresh: () => void;
}

/**
 * One leg's posture from the MODEM's read-back, not the config file's
 * intention. `unknown` when nothing has been read yet — `status.sh` cannot
 * distinguish a failed `AT+QNWLOCK` query from "not locked", so a confident
 * "Unlocked" before the first successful read would be asserting something
 * nobody checked.
 */
function legPosture(
  modemState: TowerModemState | null,
  leg: TowerLeg,
): LegPosture {
  if (!modemState) return "unknown";
  if (leg === "lte") return modemState.lte_locked ? "locked" : "unlocked";
  return modemState.nr_locked ? "locked" : "unlocked";
}

/**
 * Camped-on carriers, ordered PCC first then LTE before NR — the LTE leg is the
 * anchor in NSA, so it is the one a reader looks for first when a 5G connection
 * misbehaves. `Array.prototype.sort` is stable, so carriers within one rank keep
 * the order the radio reported them in.
 */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const leadRank = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const techRank = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return leadRank(a) - leadRank(b) || techRank(a) - techRank(b);
  });
}

/** Which leg a carrier would be locked on. */
function legForCarrier(c: CarrierComponent): TowerLeg {
  return c.technology === "LTE" ? "lte" : "nr_sa";
}

/**
 * The absent radio leg named beside a lone carrier, so the grid's second column
 * says something instead of sitting blank. Renders ONLY in the solo case: with
 * several carriers aggregated the row already fills honestly, and adding a cell
 * saying "no 5G" there would be an editorial claim that the absence is a fault.
 */
function AbsentLegCell({ technology }: { technology: "LTE" | "NR" }) {
  const { t } = useTranslation("cellular");
  // The lone carrier is LTE => the NR leg is what is absent, and vice versa.
  const absent = technology === "LTE" ? "nr" : "lte";
  return (
    <div className={HERO_ONAIR_ABSENT.ROOT} role="listitem">
      <span className={HERO_ONAIR_ABSENT.DISC} aria-hidden="true">
        <MaterialSymbol name="signal_cellular_off" size={20} />
      </span>
      <p className={HERO_ONAIR_ABSENT.TITLE}>
        {t(`tower_locking.live.absent_${absent}_title`)}
      </p>
      <p className={HERO_ONAIR_ABSENT.BODY}>
        {t(`tower_locking.live.absent_${absent}_body`)}
      </p>
    </div>
  );
}

/** Scrolls a leg's card into view. A rail chevron only earns its place if it
 *  actually goes somewhere. */
function scrollToLeg(leg: TowerLeg) {
  document
    .getElementById(`tower-locking-card-${leg}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function TowerLockHero({
  modemState,
  failover,
  configPersist,
  failoverThreshold,
  carrierComponents,
  activeRsrp,
  canTarget,
  isLoading,
  isRefreshing,
  isSavingFailover,
  lastSyncedAt,
  onPickCarrier,
  onTogglePersist,
  onToggleFailover,
  onThresholdChange,
  onRefresh,
}: TowerLockHeroProps) {
  const { t, i18n } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const onAir = useMemo(
    () => sortCarriers(carrierComponents),
    [carrierComponents],
  );
  const totalMhz = useMemo(
    () =>
      onAir.reduce(
        (sum, c) => sum + (c.bandwidth_mhz > 0 ? c.bandwidth_mhz : 0),
        0,
      ),
    [onAir],
  );

  const hasActiveLock =
    (modemState?.lte_locked ?? false) || (modemState?.nr_locked ?? false);

  // --- Failover threshold -----------------------------------------------------
  // Local string state so a half-typed value is never sent, synced from props by
  // render-time adjustment rather than an effect.
  const [thresholdInput, setThresholdInput] = useState(
    String(failoverThreshold),
  );
  const [prevThreshold, setPrevThreshold] = useState(failoverThreshold);
  if (failoverThreshold !== prevThreshold) {
    setPrevThreshold(failoverThreshold);
    setThresholdInput(String(failoverThreshold));
  }

  const parsedThreshold = Number.parseInt(thresholdInput, 10);
  const thresholdValid =
    !Number.isNaN(parsedThreshold) &&
    parsedThreshold >= 0 &&
    parsedThreshold <= 100;
  const thresholdDirty = thresholdInput !== String(failoverThreshold);

  const handleThresholdSave = async () => {
    if (!thresholdValid) return;
    const ok = await onThresholdChange(parsedThreshold);
    if (ok) {
      markSaved();
      toast.success(t("tower_locking.live.threshold_toast_saved"));
    } else {
      toast.error(t("tower_locking.live.threshold_toast_error"));
    }
  };

  const handlePersist = async (checked: boolean) => {
    const ok = await onTogglePersist(checked);
    if (ok) {
      toast.success(
        checked
          ? t("tower_locking.live.persist_toast_enabled")
          : t("tower_locking.live.persist_toast_disabled"),
      );
    } else {
      toast.error(t("tower_locking.live.persist_toast_error"));
    }
  };

  const handleFailover = async (checked: boolean) => {
    const ok = await onToggleFailover(checked);
    if (ok) {
      toast.success(
        checked
          ? t("tower_locking.live.failover_toast_enabled")
          : t("tower_locking.live.failover_toast_disabled"),
      );
    } else {
      toast.error(t("tower_locking.live.failover_toast_error"));
    }
  };

  // --- Rail summary -----------------------------------------------------------
  const lteLocked = modemState?.lte_locked ?? false;
  const nrLocked = modemState?.nr_locked ?? false;
  const subtitle = !modemState
    ? t("tower_locking.live.rail_subtitle_unknown")
    : lteLocked && nrLocked
      ? t("tower_locking.live.rail_subtitle_both")
      : lteLocked
        ? t("tower_locking.live.rail_subtitle_lte")
        : nrLocked
          ? t("tower_locking.live.rail_subtitle_nr")
          : t("tower_locking.live.rail_subtitle_none");

  /** The lock target line under a rail row, read back from the modem. */
  const targetLine = (leg: TowerLeg): string => {
    if (!modemState) return t("tower_locking.live.rail_target_none");
    if (leg === "lte") {
      const cells = modemState.lte_cells ?? [];
      if (!modemState.lte_locked || cells.length === 0) {
        return t("tower_locking.live.rail_target_none");
      }
      if (cells.length === 1) {
        return t("tower_locking.live.rail_target_pair", {
          channel: `${t("tower_locking.live.tile_earfcn")} ${cells[0].earfcn}`,
          pci: cells[0].pci,
        });
      }
      return t("tower_locking.live.rail_target_cells", {
        count: cells.length,
      });
    }
    const cell = modemState.nr_cell;
    if (!modemState.nr_locked || !cell) {
      return t("tower_locking.live.rail_target_none");
    }
    return t("tower_locking.live.rail_target_pair", {
      channel: `${t("tower_locking.live.tile_arfcn")} ${cell.arfcn}`,
      pci: cell.pci,
    });
  };

  const failState = failoverKey(
    failover ?? { enabled: false, activated: false, watcher_running: false },
    hasActiveLock,
  );
  const failBadge = FAILOVER_BADGE[failState];

  const persistState = persistPosture(modemState);
  const persistBadge = PERSIST_BADGE[persistState];

  const qualityPct =
    activeRsrp === null ? null : rsrpToQualityPercent(activeRsrp);

  const syncedLabel =
    lastSyncedAt === null
      ? t("tower_locking.live.synced_never")
      : t("tower_locking.live.synced_at", {
          time: new Date(lastSyncedAt).toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });

  return (
    <section className={TOWER_HERO} aria-label={t("tower_locking.live.title")}>
      <div className={HERO_SPLIT}>
        {/* --- Camped on now ------------------------------------------------ */}
        <div className={HERO_ONAIR_PANEL}>
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex size-2" aria-hidden="true">
              <span className="animate-live-ping bg-success absolute inset-0 rounded-pill motion-reduce:animate-none" />
              <span className="bg-success relative size-2 rounded-pill" />
            </span>
            <span className={HERO_EYEBROW}>
              {t("tower_locking.live.camped_on")}
            </span>
            {onAir.length > 0 ? (
              <span className="text-on-surface-variant ml-auto font-mono text-xs tabular-nums">
                {t("tower_locking.live.camped_summary", {
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
            <div className="rounded-tile bg-surface flex items-center gap-3.5 px-5 py-5">
              <span className="bg-surface-container-high text-on-surface-variant grid size-11 flex-none place-items-center rounded-pill">
                <MaterialSymbol name="signal_cellular_off" size={22} />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">
                  {t("tower_locking.live.camped_empty_title")}
                </p>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  {t("tower_locking.live.camped_empty_body")}
                </p>
              </div>
            </div>
          ) : (
            <div className={HERO_ONAIR_GRID} role="list">
              {onAir.map((c) => {
                const isLead = c.type === "PCC";
                const pct = rsrpToPercent(c.rsrp);
                const meter = carrierMeterTone(c.technology, isLead);
                const pill = carrierPillTone(c.technology, isLead);
                const action = carrierPillTone(c.technology, isLead, true);
                const leg = legForCarrier(c);
                const gate = canTarget[leg];
                // A cell with no PCI or no channel cannot be a lock target at
                // all — the AT command needs both halves of the pair.
                const addressable = c.pci !== null && c.earfcn !== null;
                const pickable = addressable && gate.ok;

                return (
                  <div
                    key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}`}
                    role="listitem"
                    className={`${HERO_ONAIR_TILE.ROOT} ${carrierTileTone(c.technology, isLead)}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${HERO_ONAIR_TILE.PILL} ${pill}`}>
                        {t(`tower_locking.live.tile_tech_${c.technology}`)}{" "}
                        {c.type}
                      </span>
                      <span className="ml-auto font-mono text-xs font-semibold tabular-nums opacity-85">
                        {c.band}
                      </span>
                    </div>

                    {/* PCI is the headline on THIS surface, where the band is
                        the headline on Band Locking's otherwise-identical tile.
                        The reader here is choosing a physical cell, and PCI is
                        its name. */}
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium opacity-75">
                        {t("tower_locking.live.tile_pci")}
                      </span>
                      <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
                        {c.pci ?? t("tower_locking.live.tile_no_value")}
                      </span>
                    </div>

                    {/* Channel, then the three quality readings. Segments the
                        modem did not report for THIS component are omitted
                        rather than padded with a placeholder — separate flex
                        children with a real gap, not a joined separator glyph,
                        so spacing stays even regardless of font metrics. */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums opacity-70">
                      <span>
                        {c.technology === "LTE"
                          ? t("tower_locking.live.tile_earfcn")
                          : t("tower_locking.live.tile_arfcn")}{" "}
                        {c.earfcn ?? t("tower_locking.live.tile_no_value")}
                      </span>
                      <span>
                        {c.rsrp === null
                          ? t("tower_locking.live.tile_no_value")
                          : t("tower_locking.live.tile_rsrp", {
                              value: c.rsrp,
                            })}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums opacity-70">
                      {c.rsrq === null ? null : (
                        <span>
                          {t("radio_info.bands.metric.rsrq")}{" "}
                          {t("tower_locking.live.tile_rsrq", {
                            value: c.rsrq,
                          })}
                        </span>
                      )}
                      {c.sinr === null ? null : (
                        <span>
                          {t("radio_info.bands.metric.sinr")}{" "}
                          {t("tower_locking.live.tile_sinr", {
                            value: c.sinr,
                          })}
                        </span>
                      )}
                    </div>

                    <div
                      className={`${HERO_ONAIR_TILE.METER_TRACK} ${meter.track}`}
                    >
                      <div
                        className={`${HERO_ONAIR_TILE.METER_FILL} ${meter.fill}`}
                        style={{ transform: `scaleX(${pct / 100})` }}
                      />
                    </div>

                    {/* The picker. Disabled rather than absent when the leg
                        cannot take a target — silently dropping it would leave
                        the user to infer the rule. */}
                    {addressable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={!pickable}
                            onClick={() => onPickCarrier(c)}
                            className={`${HERO_ONAIR_TILE.ACTION} ${action}`}
                            aria-label={t("tower_locking.live.tile_use_a11y", {
                              band: c.band,
                              pci: c.pci,
                              leg: t(legShortKey(leg)),
                            })}
                          >
                            <MaterialSymbol name="add" size={16} />
                            {t("tower_locking.live.tile_use")}
                          </button>
                        </TooltipTrigger>
                        {pickable ? null : (
                          <TooltipContent className="max-w-64">
                            <p>{gate.reasonKey ? t(gate.reasonKey) : null}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })}
              {onAir.length === 1 ? (
                <AbsentLegCell technology={onAir[0].technology} />
              ) : null}
            </div>
          )}

          <div className="text-on-surface-variant mt-auto flex items-center gap-2.5 text-xs">
            <MaterialSymbol name="info" size={16} className="flex-none" />
            <span>{t("tower_locking.live.camped_note")}</span>
          </div>
        </div>

        {/* --- Lock posture rail --------------------------------------------- */}
        <div className={HERO_RAIL_PANEL}>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Skeleton className={SKELETON_SHAPE.HERO_DISC} />
            ) : (
              <span className={HERO_RAIL_DISC} aria-hidden="true">
                <MaterialSymbol name="cell_tower" size={22} filled />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={HERO_RAIL_TITLE}>
                {t("tower_locking.live.eyebrow")}
              </span>
              {isLoading ? (
                <Skeleton className={SKELETON_SHAPE.HERO_SUBTITLE} />
              ) : (
                <span className={HERO_RAIL_SUBTITLE}>{subtitle}</span>
              )}
            </div>
          </div>

          {/* One row per radio leg, showing the target the MODEM reports. */}
          <div className="flex flex-col gap-2">
            {isLoading
              ? TOWER_LEGS.map((leg) => (
                  <Skeleton key={leg} className={SKELETON_SHAPE.RAIL_ROW} />
                ))
              : TOWER_LEGS.map((leg) => {
                  const posture = legPosture(modemState, leg);
                  const badge = LEG_BADGE[posture];
                  const statusLabel = t(
                    `tower_locking.live.leg_status_${posture}`,
                  );
                  const target = targetLine(leg);
                  return (
                    <button
                      key={leg}
                      type="button"
                      onClick={() => scrollToLeg(leg)}
                      className={HERO_RAIL_ROW}
                      aria-label={`${t(legShortKey(leg))} — ${target} — ${statusLabel}`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className={HERO_RAIL_ROW_LABEL}>
                          {t(legShortKey(leg))}
                        </span>
                        <span className={HERO_RAIL_ROW_TARGET}>{target}</span>
                      </div>
                      <Badge
                        variant={badge.variant}
                        className="ml-auto flex-none"
                      >
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

          {/* Freshness. See THE TWO CLOCKS — the rows above can be far older
              than the tiles on the left, and nothing else on screen says so. */}
          {isLoading ? null : (
            <div className={HERO_STALENESS}>
              <MaterialSymbol name="schedule" size={14} className="flex-none" />
              <span className="tabular-nums">{syncedLabel}</span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                aria-label={t("tower_locking.live.refresh")}
                className={`ml-auto ${HERO_REFRESH_BUTTON}`}
              >
                <MaterialSymbol
                  name="refresh"
                  size={18}
                  className={
                    isRefreshing
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                />
              </button>
              <span className="sr-only" aria-live="polite">
                {isRefreshing ? t("tower_locking.a11y.refreshing") : ""}
              </span>
            </div>
          )}

          {/* --- Settings that belong to no single leg ---------------------- */}
          {isLoading ? (
            <>
              <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
              <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
            </>
          ) : (
            <>
              {/* Persist. The CHIP reports the modem's read-back; the SWITCH
                  drives the config. They can disagree, and when they do the
                  `split` chip is the only thing that would tell you. */}
              <div className={HERO_ROW}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="text-sm font-semibold">
                    {t("tower_locking.live.persist_label")}
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("tower_locking.live.persist_label")}
                        className={HERO_HELP_BUTTON}
                      >
                        <MaterialSymbol name="info" size={18} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">
                      <p>
                        {persistState === "split"
                          ? t("tower_locking.live.persist_split_help")
                          : t("tower_locking.live.persist_help")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <Badge variant={persistBadge.variant}>
                    <MaterialSymbol
                      name={persistBadge.glyph}
                      size={BADGE_GLYPH_SIZE}
                    />
                    {t(`tower_locking.live.persist_state_${persistState}`)}
                  </Badge>
                  <Switch
                    id="tower-persist"
                    checked={configPersist}
                    onCheckedChange={handlePersist}
                    aria-label={t("tower_locking.live.persist_label")}
                  />
                </div>
              </div>

              {/* Failover. It releases BOTH radios, so it belongs to the rail
                  rather than to either leg card. */}
              <div className={HERO_ROW}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="text-sm font-semibold">
                    {t("tower_locking.live.failover_label")}
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t(
                          "tower_locking.live.failover_help_label",
                        )}
                        className={HERO_HELP_BUTTON}
                      >
                        <MaterialSymbol name="info" size={18} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">
                      <p>{t("tower_locking.live.failover_help")}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <Badge variant={failBadge.variant}>
                    <MaterialSymbol
                      name={failBadge.glyph}
                      size={BADGE_GLYPH_SIZE}
                    />
                    {t(`tower_locking.live.failover_state_${failState}`)}
                  </Badge>
                  <Switch
                    id="tower-failover"
                    checked={failover?.enabled ?? false}
                    onCheckedChange={handleFailover}
                    disabled={isSavingFailover}
                    aria-label={t("tower_locking.live.failover_label")}
                  />
                </div>
              </div>

              {/* Threshold + the live quality it is compared against, in one
                  row: the number only means something next to the reading it
                  gates, and the incumbent put them in two rows four apart. */}
              <div className={HERO_ROW_LAST}>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold">
                      {t("tower_locking.live.threshold_label")}
                    </p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("tower_locking.live.threshold_label")}
                          className={HERO_HELP_BUTTON}
                        >
                          <MaterialSymbol name="info" size={18} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72">
                        <p>{t("tower_locking.live.threshold_help")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-on-surface-variant text-xs">
                    {t("tower_locking.live.quality_label")}
                    {": "}
                    <span className="font-mono tabular-nums">
                      {qualityPct === null
                        ? t("tower_locking.live.quality_unknown")
                        : t("tower_locking.live.quality_value", {
                            value: qualityPct,
                          })}
                    </span>
                  </span>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <Input
                    id="tower-failover-threshold"
                    inputMode="numeric"
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleThresholdSave();
                    }}
                    aria-invalid={!thresholdValid || undefined}
                    aria-label={t("tower_locking.live.threshold_label")}
                    className={`${FIELD_CONTROL} w-20 text-center font-mono tabular-nums`}
                  />
                  {thresholdDirty || saved ? (
                    <SaveButton
                      onClick={handleThresholdSave}
                      isSaving={false}
                      saved={saved}
                      label={t("common:actions.update")}
                      disabled={!thresholdValid}
                      className="h-[2.625rem] rounded-pill px-4 text-sm font-semibold"
                    />
                  ) : null}
                </div>

                {thresholdValid ? null : (
                  <p
                    role="alert"
                    className="text-destructive-on-surface w-full text-xs"
                  >
                    {t("tower_locking.live.threshold_invalid")}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default TowerLockHero;

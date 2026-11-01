"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  type CarrierComponent,
  type SignalQuality,
} from "@/types/modem-status";
import type { TowerModemState } from "@/types/tower-locking";

import {
  CAMPED_ABSENT,
  CARRIER_GRID,
  CARRIER_TILE,
  SKELETON_SHAPE,
  STRIP_PANEL,
  VERDICT_ROW,
  VERDICT_TONE,
  matchVerdict,
  type TowerLeg,
  type TowerMatchVerdict,
} from "./shapes";

// =============================================================================
// TowerLiveStrip — the match verdict, then every carrier the radio is camped on
// =============================================================================
// The verdict (is the radio on the cell the modem was told to hold?) sits above the carrier tiles; each tile's button
// locks, adds to the LTE lock, or removes at once, and a lock-target tile wears an inset ring and a filled lock.
// =============================================================================

const K = "tower_locking";

/** Literal keys: `i18n:check` cannot see an interpolated stem. */
const VERDICT_COPY: Record<TowerMatchVerdict, { title: string; body: string }> =
  {
    on_target: {
      title: `${K}.live.verdict_on_target_title`,
      body: `${K}.live.verdict_on_target_body`,
    },
    off_target: {
      title: `${K}.live.verdict_off_target_title`,
      body: `${K}.live.verdict_off_target_body`,
    },
    unverified: {
      title: `${K}.live.verdict_unverified_title`,
      body: `${K}.live.verdict_unverified_body`,
    },
    unlocked: {
      title: `${K}.live.verdict_unlocked_title`,
      body: `${K}.live.verdict_unlocked_body`,
    },
    unknown: {
      title: `${K}.live.verdict_unknown_title`,
      body: `${K}.live.verdict_unknown_body`,
    },
  };

export interface CanTarget {
  ok: boolean;
  /** Why not, already translated; shown in the tile's tooltip. */
  reason: string | null;
}

/**
 * What a tile's button does: `lock` (nothing locked yet), `add` (join the LTE lock), `replace` (NR swaps its one
 * cell), `unlock` (this tile is the lock).
 */
export type TileAction = "lock" | "add" | "replace" | "unlock";

export interface TowerLiveStripProps {
  modemState: TowerModemState | null;
  carrierComponents: CarrierComponent[];
  canTarget: Record<TowerLeg, CanTarget>;
  /** A lock write is in flight on that radio. */
  busy: Record<TowerLeg, boolean>;
  isLoading: boolean;
  onActCarrier: (carrier: CarrierComponent, action: TileAction) => void;
}

const ACTION_GLYPH = {
  lock: "lock_open",
  add: "add",
  replace: "lock_open",
  unlock: "lock",
} as const;

const ACTION_LABEL: Record<TileAction, string> = {
  lock: `${K}.live.tile_lock`,
  add: `${K}.live.tile_add`,
  replace: `${K}.live.tile_replace`,
  unlock: `${K}.live.tile_unlock`,
};

function actionFor(
  c: CarrierComponent,
  modemState: TowerModemState | null,
  isTarget: boolean,
): TileAction {
  if (isTarget) return "unlock";
  if (c.technology === "LTE") {
    return modemState?.lte_locked ? "add" : "lock";
  }
  return modemState?.nr_locked ? "replace" : "lock";
}

/** The word that backs the ramp ink and the bar for assistive tech. */
const QUALITY_LABEL: Record<SignalQuality, string> = {
  excellent: "radio_info.bands.quality.excellent",
  good: "radio_info.bands.quality.good",
  fair: "radio_info.bands.quality.fair",
  poor: "radio_info.bands.quality.poor",
  bad: "radio_info.bands.quality.bad",
  none: "radio_info.bands.quality.none",
};

/** PCC first, then LTE before NR (the LTE leg anchors NSA). */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const lead = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const tech = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return lead(a) - lead(b) || tech(a) - tech(b);
  });
}

function legFor(c: CarrierComponent): TowerLeg {
  return c.technology === "LTE" ? "lte" : "nr_sa";
}

function isLockTarget(
  c: CarrierComponent,
  modemState: TowerModemState | null,
): boolean {
  if (modemState === null || c.earfcn === null || c.pci === null) return false;
  if (c.technology === "LTE") {
    if (!modemState.lte_locked) return false;
    return (modemState.lte_cells ?? []).some(
      (cell) => cell.earfcn === c.earfcn && cell.pci === c.pci,
    );
  }
  if (!modemState.nr_locked || modemState.nr_cell === null) return false;
  return (
    modemState.nr_cell.arfcn === c.earfcn && modemState.nr_cell.pci === c.pci
  );
}

export function TowerLiveStrip({
  modemState,
  carrierComponents,
  canTarget,
  busy,
  isLoading,
  onActCarrier,
}: TowerLiveStripProps) {
  const { t } = useTranslation("cellular");

  const onAir = useMemo(
    () => sortCarriers(carrierComponents),
    [carrierComponents],
  );

  const verdict = matchVerdict(modemState, onAir);
  const verdictTone = VERDICT_TONE[verdict];
  const verdictCopy = VERDICT_COPY[verdict];

  // One tile per carrier; two when nothing has loaded yet.
  const skeletonTiles = onAir.length > 0 ? onAir.length : 2;

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.VERDICT} />
      ) : (
        <div role="status" className={`${VERDICT_ROW.ROOT} ${verdictTone.fill}`}>
          <span
            aria-hidden="true"
            className={`${VERDICT_ROW.DISC} ${verdictTone.disc}`}
          >
            <MaterialSymbol name={verdictTone.glyph} size={16} filled />
          </span>
          <span className={VERDICT_ROW.TITLE}>{t(verdictCopy.title)}</span>
          <p className={VERDICT_ROW.BODY}>{t(verdictCopy.body)}</p>
        </div>
      )}

    <div className={STRIP_PANEL}>
      {isLoading ? (
        <div className={CARRIER_GRID}>
          {Array.from({ length: skeletonTiles }).map((_, i) => (
            <Skeleton key={i} className={SKELETON_SHAPE.CARRIER_TILE} />
          ))}
        </div>
      ) : onAir.length === 0 ? (
        <div className="flex items-center gap-3.5 rounded-tile bg-surface px-4 py-4">
          <span className="bg-surface-container-high text-on-surface-variant grid size-11 flex-none place-items-center rounded-pill">
            <MaterialSymbol name="signal_cellular_off" size={22} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-semibold">
              {t(`${K}.live.camped_empty_title`)}
            </p>
            <p className="text-on-surface-variant text-xs leading-relaxed">
              {t(`${K}.live.camped_empty_body`)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className={CARRIER_GRID} role="list">
            {onAir.map((c) => {
              const leg = legFor(c);
              const gate = canTarget[leg];
              const addressable = c.pci !== null && c.earfcn !== null;
              const locked = isLockTarget(c, modemState);
              const quality = getSignalQuality(c.rsrp, RSRP_THRESHOLDS);
              const tone = qualityMeterTone(quality);
              const percent =
                tone === null
                  ? null
                  : signalToProgress(c.rsrp, RSRP_THRESHOLDS);
              const action = actionFor(c, modemState, locked);
              // An unlock is always allowed; a blocked leg only stops a lock.
              const usable = !busy[leg] && (locked || gate.ok);
              const blockedReason = busy[leg] ? null : gate.reason;
              const actionLabel = t(ACTION_LABEL[action], {
                band: c.band,
                pci: c.pci,
              });

              return (
                <div
                  key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}-${c.pci ?? "x"}`}
                  role="listitem"
                  className={`${CARRIER_TILE.ROOT} ${locked ? CARRIER_TILE.MATCH : ""}`}
                >
                  <div className={CARRIER_TILE.HEAD}>
                    {/* Identity (which radio), never health. */}
                    <Tag
                      variant={c.technology === "LTE" ? "lte" : "nr"}
                      className="flex-none"
                    >
                      {c.technology === "LTE"
                        ? t(`${K}.live.tile_tech_LTE`)
                        : t(`${K}.live.tile_tech_NR`)}{" "}
                      {c.type}
                    </Tag>
                    <span className={CARRIER_TILE.BAND}>{c.band}</span>

                    {addressable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-disabled={!usable || undefined}
                            onClick={
                              usable ? () => onActCarrier(c, action) : undefined
                            }
                            className={`${CARRIER_TILE.ACTION} ${
                              action === "unlock"
                                ? CARRIER_TILE.ACTION_ON
                                : CARRIER_TILE.ACTION_IDLE
                            }`}
                            aria-label={
                              usable || !blockedReason
                                ? actionLabel
                                : `${actionLabel} (${blockedReason})`
                            }
                          >
                            {/* The glyph, not a dimmed button, separates
                                "you can" from "you cannot". */}
                            {busy[leg] ? (
                              <MaterialSymbol
                                name="progress_activity"
                                size={18}
                                className="motion-safe:animate-spin"
                              />
                            ) : (
                              <MaterialSymbol
                                name={
                                  gate.ok || locked
                                    ? ACTION_GLYPH[action]
                                    : "do_not_disturb_on"
                                }
                                size={18}
                                filled={action === "unlock"}
                              />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 text-pretty">
                          <p>{usable || !blockedReason ? actionLabel : blockedReason}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>

                  <div className={CARRIER_TILE.BODY}>
                    <span className={CARRIER_TILE.PCI_LABEL}>
                      {t(`${K}.live.tile_pci`)}
                    </span>
                    <span className={CARRIER_TILE.PCI_VALUE}>
                      {c.pci ?? t(`${K}.live.tile_no_value`)}
                    </span>
                    {/* Ramp ink is legal only beside the bar whose length
                        carries the same reading, plus the quality word. */}
                    <div className={CARRIER_TILE.METER}>
                      <div className="w-14 min-w-6 shrink" aria-hidden="true">
                        <MetricBar
                          value={percent}
                          max={100}
                          warnAt={101}
                          dangerAt={101}
                          colorOverride={tone}
                          track="surface-container-high"
                        />
                      </div>
                      <span
                        className={`${CARRIER_TILE.RSRP} ${qualityInkClass(quality)}`}
                      >
                        {c.rsrp === null
                          ? t(`${K}.live.tile_no_value`)
                          : t(`${K}.live.tile_rsrp`, { value: c.rsrp })}
                      </span>
                    </div>
                    <span className="sr-only">{t(QUALITY_LABEL[quality])}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* One carrier on air: name the radio that is not, as a note and
              not a tile, so it never enters the reading order as a carrier. */}
          {onAir.length === 1 ? (
            <p className={CAMPED_ABSENT}>
              <MaterialSymbol
                name="signal_cellular_off"
                size={16}
                className="flex-none"
              />
              {onAir[0].technology === "LTE"
                ? t(`${K}.live.absent_nr_title`)
                : t(`${K}.live.absent_lte_title`)}
            </p>
          ) : null}
        </div>
      )}
    </div>
    </div>
  );
}

export default TowerLiveStrip;

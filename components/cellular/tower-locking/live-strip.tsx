"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CarrierComponent } from "@/types/modem-status";
import type { TowerModemState } from "@/types/tower-locking";

import {
  CAMPED_ABSENT,
  CAMPED_LEAD,
  CAMPED_SCC,
  HERO_EYEBROW,
  HERO_REFRESH_BUTTON,
  SKELETON_SHAPE,
  STRIP_FOOTNOTE,
  STRIP_GRID,
  STRIP_HEAD,
  STRIP_PANEL,
  VERDICT_BLOCK,
  VERDICT_TONE,
  legShortKey,
  matchVerdict,
  type TowerLeg,
  type TowerMatchVerdict,
} from "./shapes";

// =============================================================================
// TowerLiveStrip — the hero's premise
// =============================================================================
// Two parts, read as one clause:
//
//     VERDICT   ▸   CAMPED ON NOW
//
// This is what survives of a three-column MATCH LINE that used to lead the page:
// locked target, verdict, camped on now. Its left column has been deleted, and
// deleting it is the point. That column printed which leg was locked and to
// which (channel, PCI) pairs — the same two facts the leg cards below already
// carry in their status chip and their form fields — so a reader met the same
// numbers twice before reaching a single control, and the read-only half of a
// settings page was the tallest thing on it.
//
// The ONE fact that column carried alone was the modem's own AT read-back, as
// against the config the forms are seeded from. That did not disappear: it moved
// into the leg card that owns it, inches from the values it can contradict,
// where a disagreement is actually actionable. See `READBACK` in `shapes.ts`.
//
// What is left is genuinely irreducible. The verdict is the only fact this page
// computes that neither source carries alone, and the camped list is the
// evidence behind it — plus every row in it is a lock target one click from a
// form, which is why it stays on screen rather than collapsing to a count.
//
// -----------------------------------------------------------------------------
// SMALLER, NOT LESSER
// -----------------------------------------------------------------------------
// The verdict dropped from a 176px centred tile to a left-aligned block, and the
// camped lead from a 172px identity-filled tile to two compressed lines. Every
// READING survived: PCI still leads, and the channel, RSRP, RSRQ and SINR are all
// still on the lead. Rank now comes from ANATOMY — two lines against the
// secondaries' one — instead of from area.
//
// The one thing genuinely cut is the lead's signal meter, and it earned that: at
// row scale it drew a 4px identity-coloured bar across the full width of the
// block, which reads as a coloured bottom border rather than a gauge. It was also
// the third channel reporting what the badge and the dBm figure already report,
// and the secondaries never had one — so every carrier row now says "how strong"
// exactly one way. See `CAMPED_LEAD` in `shapes.ts`.
//
// Losing the identity fill is what made the shrink clean rather than cramped.
// A saturated `bg-primary` / `bg-lte` block forces every control inside it to be
// drawn as an alpha over its own ink, because a role colour on an identity
// ground is either invisible or brand-on-brand; three tone helpers existed only
// to serve that. On `bg-surface` the pick button is an ordinary neutral control,
// and identity travels on the `Badge variant="nr"|"lte"` each row already had —
// the one element in this system whose fill and ink are guaranteed to agree.
//
// -----------------------------------------------------------------------------
// TWO CLOCKS, AND WHY THE STAMP IS ON THE VERDICT
// -----------------------------------------------------------------------------
// Left: the lock target read back from `AT+QNWLOCK`, which `status.sh` fetches
// ONCE ON MOUNT and never polls — three AT commands on the same
// `/tmp/qmanager_at.lock` mutex the poller already contends for.
// Right: what the radio is camped on THIS INSTANT, straight off
// `carrier_components` in the ~4s poller snapshot.
//
// The verdict is computed from BOTH, so it is only ever as fresh as its stalest
// operand. That is why "as of HH:MM" and the re-read control sit ON the verdict
// rather than in a corner of the page: a conclusion drawn across two clocks has
// to wear the slower one.
// =============================================================================

export interface TowerLiveStripProps {
  modemState: TowerModemState | null;
  /** Live QCAINFO carriers from `useModemStatus`. */
  carrierComponents: CarrierComponent[];
  /** Which legs can currently accept a lock target from a carrier. */
  canTarget: Record<TowerLeg, { ok: boolean; reasonKey: string | null }>;
  isLoading: boolean;
  isRefreshing: boolean;
  lastSyncedAt: number | null;
  onPickCarrier: (carrier: CarrierComponent) => void;
  onRefresh: () => void;
}

/**
 * Verdict -> its two copy keys, written out as LITERALS rather than built as
 * `` `verdict_${v}_title` ``.
 *
 * `i18n:check` grades a missing key as a warning and exits 0, so a key it
 * cannot see statically is a key nothing will ever tell you about. An
 * interpolated stem is invisible to it; these are not. Same reasoning as the
 * leg cards' status labels — see `docs/reference/i18n.md`.
 */
const VERDICT_COPY: Record<TowerMatchVerdict, { title: string; body: string }> =
  {
    on_target: {
      title: "tower_locking.live.verdict_on_target_title",
      body: "tower_locking.live.verdict_on_target_body",
    },
    off_target: {
      title: "tower_locking.live.verdict_off_target_title",
      body: "tower_locking.live.verdict_off_target_body",
    },
    unverified: {
      title: "tower_locking.live.verdict_unverified_title",
      body: "tower_locking.live.verdict_unverified_body",
    },
    unlocked: {
      title: "tower_locking.live.verdict_unlocked_title",
      body: "tower_locking.live.verdict_unlocked_body",
    },
    unknown: {
      title: "tower_locking.live.verdict_unknown_title",
      body: "tower_locking.live.verdict_unknown_body",
    },
  };

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

/** Literal keys, for the reason `VERDICT_COPY` spells out. */
function techKey(technology: "LTE" | "NR"): string {
  return technology === "LTE"
    ? "tower_locking.live.tile_tech_LTE"
    : "tower_locking.live.tile_tech_NR";
}

function channelKey(technology: "LTE" | "NR"): string {
  return technology === "LTE"
    ? "tower_locking.live.tile_earfcn"
    : "tower_locking.live.tile_arfcn";
}

export function TowerLiveStrip({
  modemState,
  carrierComponents,
  canTarget,
  isLoading,
  isRefreshing,
  lastSyncedAt,
  onPickCarrier,
  onRefresh,
}: TowerLiveStripProps) {
  const { t, i18n } = useTranslation("cellular");

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

  // `sortCarriers` already put the PCC first, so the lead is index 0 and the
  // secondaries are the tail. Deriving it any other way would let the panel and
  // the sort disagree about which carrier leads.
  const lead = onAir[0] ?? null;
  const secondaries = onAir.slice(1);

  const verdict = matchVerdict(modemState, onAir);
  const verdictTone = VERDICT_TONE[verdict];
  const verdictCopy = VERDICT_COPY[verdict];

  const syncedLabel =
    lastSyncedAt === null
      ? t("tower_locking.live.synced_never")
      : t("tower_locking.live.synced_at", {
          time: new Date(lastSyncedAt).toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });

  /** The picker gate for one carrier: addressable at all, then leg-permitted. */
  const pickState = (c: CarrierComponent) => {
    // A cell with no PCI or no channel cannot be a lock target at all — the AT
    // command needs both halves of the pair.
    const addressable = c.pci !== null && c.earfcn !== null;
    const gate = canTarget[legForCarrier(c)];
    return { addressable, gate, pickable: addressable && gate.ok };
  };

  return (
    <div className={STRIP_GRID}>
      {/* --- 1. The verdict ------------------------------------------------
          The only fact on this page neither source carries on its own. */}
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.VERDICT} />
      ) : (
        <div role="status" className={`${VERDICT_BLOCK.ROOT} ${verdictTone.fill}`}>
          <div className={VERDICT_BLOCK.HEAD}>
            <span
              aria-hidden="true"
              className={`${VERDICT_BLOCK.DISC} ${verdictTone.disc}`}
            >
              <MaterialSymbol name={verdictTone.glyph} size={20} filled />
            </span>
            <span className={VERDICT_BLOCK.TITLE}>{t(verdictCopy.title)}</span>
          </div>
          <p className={VERDICT_BLOCK.BODY}>{t(verdictCopy.body)}</p>

          {/* The verdict spans two clocks, so it wears the slower one. See
              TWO CLOCKS above — this is not a decoration, it is the qualifier
              that makes the claim honest. */}
          <div className={VERDICT_BLOCK.STAMP}>
            <MaterialSymbol name="schedule" size={14} className="flex-none" />
            <span className="min-w-0 flex-1 tabular-nums">{syncedLabel}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label={t("tower_locking.live.refresh")}
              className={HERO_REFRESH_BUTTON}
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
        </div>
      )}

      {/* --- 2. Camped on now --------------------------------------------- */}
      <div className={STRIP_PANEL}>
        <div className={STRIP_HEAD}>
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
          <div className="flex flex-col gap-1.5">
            <Skeleton className={SKELETON_SHAPE.PCC_BLOCK} />
            <Skeleton className={SKELETON_SHAPE.SCC_ROW} />
          </div>
        ) : lead === null ? (
          <div className="rounded-tile bg-surface flex items-center gap-3.5 px-4 py-4">
            <span className="bg-surface-container-high text-on-surface-variant grid size-11 flex-none place-items-center rounded-pill">
              <MaterialSymbol name="signal_cellular_off" size={22} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-semibold">
                {t("tower_locking.live.camped_empty_title")}
              </p>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                {t("tower_locking.live.camped_empty_body")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* The lead carrier, at full anatomy in two lines. PCI is the
                headline: the reader here is choosing a physical cell, and PCI
                is its name. */}
            {(() => {
              const { addressable, gate, pickable } = pickState(lead);
              return (
                <div className={CAMPED_LEAD.ROOT}>
                  <div className={CAMPED_LEAD.HEAD}>
                    <Badge
                      variant={lead.technology === "LTE" ? "lte" : "nr"}
                      className="flex-none"
                    >
                      {t(techKey(lead.technology))} {lead.type}
                    </Badge>
                    <span className={CAMPED_LEAD.BAND}>{lead.band}</span>
                    <span className={CAMPED_LEAD.LABEL}>
                      {t("tower_locking.live.tile_pci")}
                    </span>
                    <span className={CAMPED_LEAD.VALUE}>
                      {lead.pci ?? t("tower_locking.live.tile_no_value")}
                    </span>

                    {/* Disabled rather than absent when the leg cannot take a
                        target — silently dropping it would leave the user to
                        infer the rule. */}
                    {addressable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={!pickable}
                            onClick={() => onPickCarrier(lead)}
                            className={CAMPED_LEAD.ACTION}
                            aria-label={t("tower_locking.live.tile_use_a11y", {
                              band: lead.band,
                              pci: lead.pci,
                              leg: t(legShortKey(legForCarrier(lead))),
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

                  {/* Readings the modem did not report for THIS component are
                      omitted rather than padded with a placeholder — separate
                      flex children with a real gap, not a joined separator
                      glyph, so spacing stays even regardless of font metrics. */}
                  <div className={CAMPED_LEAD.DETAIL}>
                    <span>
                      {t(channelKey(lead.technology))}{" "}
                      {lead.earfcn ?? t("tower_locking.live.tile_no_value")}
                    </span>
                    <span>
                      {lead.rsrp === null
                        ? t("tower_locking.live.tile_no_value")
                        : t("tower_locking.live.tile_rsrp", {
                            value: lead.rsrp,
                          })}
                    </span>
                    {lead.rsrq === null ? null : (
                      <span>
                        {t("radio_info.bands.metric.rsrq")}{" "}
                        {t("tower_locking.live.tile_rsrq", {
                          value: lead.rsrq,
                        })}
                      </span>
                    )}
                    {lead.sinr === null ? null : (
                      <span>
                        {t("radio_info.bands.metric.sinr")}{" "}
                        {t("tower_locking.live.tile_sinr", {
                          value: lead.sinr,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* The secondaries, one line each. */}
            {secondaries.length > 0 ? (
              <div className={CAMPED_SCC.LIST} role="list">
                {secondaries.map((c) => {
                  const { addressable, gate, pickable } = pickState(c);
                  return (
                    <div
                      key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}`}
                      role="listitem"
                      className={CAMPED_SCC.ROW}
                    >
                      <Badge
                        variant={c.technology === "LTE" ? "lte" : "nr"}
                        className="flex-none"
                      >
                        {t(techKey(c.technology))} {c.type}
                      </Badge>
                      <span className={CAMPED_SCC.LABEL}>{c.band}</span>
                      <span className={CAMPED_SCC.VALUE}>
                        {t("tower_locking.live.tile_pci")}{" "}
                        {c.pci ?? t("tower_locking.live.tile_no_value")}
                      </span>
                      <span className={CAMPED_SCC.META}>
                        {c.rsrp === null
                          ? t("tower_locking.live.tile_no_value")
                          : t("tower_locking.live.tile_rsrp", {
                              value: c.rsrp,
                            })}
                      </span>
                      {addressable ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={!pickable}
                              onClick={() => onPickCarrier(c)}
                              className={CAMPED_SCC.PICK}
                              aria-label={t("tower_locking.live.tile_use_a11y", {
                                band: c.band,
                                pci: c.pci,
                                leg: t(legShortKey(legForCarrier(c))),
                              })}
                            >
                              <MaterialSymbol name="add" size={18} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">
                            <p>
                              {pickable
                                ? t("tower_locking.live.tile_use")
                                : gate.reasonKey
                                  ? t(gate.reasonKey)
                                  : null}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* One carrier on air: name the radio that is NOT, rather than
                 leaving the space blank. A note and not a block — a second
                 block claiming "no 5G" would read as an editorial judgement
                 that the absence is a fault, and on a modem whose SKU may not
                 support SA it often is not. */
              <p className={CAMPED_ABSENT}>
                <MaterialSymbol
                  name="signal_cellular_off"
                  size={16}
                  className="flex-none"
                />
                {t(
                  lead.technology === "LTE"
                    ? "tower_locking.live.absent_nr_title"
                    : "tower_locking.live.absent_lte_title",
                )}
              </p>
            )}
          </div>
        )}

        <p className={STRIP_FOOTNOTE}>
          <MaterialSymbol name="info" size={16} className="flex-none" />
          <span>{t("tower_locking.live.camped_note")}</span>
        </p>
      </div>
    </div>
  );
}

export default TowerLiveStrip;

"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { CarrierComponent, ModemStatus } from "@/types/modem-status";
import type { FreqLockModemState } from "@/types/frequency-locking";

import {
  BADGE_GLYPH_SIZE,
  CAMPED,
  CARRIER_NOTE_TILE,
  CARRIER_TILE,
  HERO,
  PILL_QUIET,
  SKELETON_SHAPE,
  VERDICT,
  VERDICT_TONE,
  isChannelAllowed,
  type LockPosture,
} from "./shapes";

// =============================================================================
// The live strip — "Right now"
// =============================================================================
// The premise the rest of the page acts on: what the radio is using at this
// moment, and whether that is inside the allow list.
//
// THE TWO CLOCKS. The two halves of this strip are fed by sources that refresh
// at completely different rates, and pretending otherwise would be the
// surface's biggest lie:
//
//   CAMPED ON  `network.carrier_components` from the poller snapshot. Live,
//              re-read every ~2s by `useModemStatus`, and free — it is a cached
//              JSON file read, it never touches the modem.
//   LOCK STATE `status.sh`, which costs three AT round-trips through a mutex
//              shared with the poller. It is read ONCE on mount and once after
//              each write, and never polled. So it can be minutes old, and a
//              tower lock applied on the other page can invalidate it without
//              anything here noticing.
//
// That asymmetry is why the head carries an explicit sync time and a refresh
// control, rather than a "live" badge over the whole strip. Only the right half
// is live.
// =============================================================================

export interface FreqLockHeroProps {
  modemState: FreqLockModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  isRefreshing: boolean;
  lastSyncedAt: number | null;
  towerLockActive: boolean;
  /**
   * Whether `towerLockActive` is a READING or the hook's fail-safe default.
   *
   * The gate is one boolean on purpose - every other component on this page
   * takes only that. This surface is one of the two that EXPLAIN the block, so
   * it is the only place the difference is user-visible: "a tower lock is
   * holding the radio" and "we could not read whether one is" are different
   * facts, and the second must never be printed as the first.
   */
  towerLockStateKnown: boolean;
  onRefresh: () => void;
  /**
   * Stage a carrier into the matching list. `scs` is non-null only for an NR
   * carrier whose spacing the modem actually reported — see `carrierScs`.
   */
  onAddChannel: (
    technology: "LTE" | "NR",
    channel: number,
    scs: number | null,
  ) => void;
}

/**
 * The page-level posture, which is the union of the two legs.
 *
 * `blocked` outranks everything: while a tower lock is active no write on this
 * page can succeed, so leading with "Locked" would describe a state the user
 * cannot currently reach or change.
 */
function heroPosture(
  modemState: FreqLockModemState | null,
  towerLockActive: boolean,
): LockPosture {
  if (towerLockActive) return "blocked";
  if (!modemState) return "unknown";
  return modemState.lte_locked || modemState.nr_locked ? "locked" : "unlocked";
}

/**
 * The subcarrier spacing to seed an NR entry with when this carrier is added,
 * or null when the device has not published one for it.
 *
 * `AT+QCAINFO` does NOT report SCS per carrier — the poller's ten per-carrier
 * fields do not include it. The only SCS the device publishes is `nr.scs`, for
 * the SERVING NR cell, singular. So a carrier carries a real spacing only when
 * it IS that cell; for any other, returning the serving cell's value would be a
 * fabrication rather than an approximation. Null makes the page shell fall back
 * to the common 30 kHz default, which the NR card then lets the user correct.
 */
function carrierScs(
  carrier: CarrierComponent,
  modemData: ModemStatus | null,
): number | null {
  if (carrier.technology !== "NR") return null;
  const servingArfcn = modemData?.nr?.arfcn ?? null;
  const scs = modemData?.nr?.scs ?? null;
  if (servingArfcn === null || scs === null) return null;
  return carrier.earfcn === servingArfcn ? scs : null;
}

/** The dot that marks the live half of the strip. Two spans, so the mark stays
 *  put while its copy expands — scaling the dot itself would make the row's
 *  metrics breathe. */
function LiveDot() {
  return (
    <span className="relative inline-flex size-2 shrink-0 items-center justify-center">
      <span className="bg-success animate-live-ping absolute inline-flex size-2 rounded-pill" />
      <span className="bg-success relative inline-flex size-2 rounded-pill" />
    </span>
  );
}

/**
 * One carrier the radio is on right now.
 *
 * THE TILE SHOWS THE CHANNEL AND NOTHING THAT ISN'T THE CHANNEL. It used to
 * carry a meta line — centre frequency, bandwidth, SCS, PCI — and every one of
 * those was true but none of them was actionable HERE: the only thing this tile
 * does is push its channel number into an allow list, and a frequency lock
 * takes no PCI, no bandwidth and no frequency. Four correct figures competing
 * with the one figure the button acts on made the user work out which number
 * mattered. Band, radio and RSRP stay because they identify and qualify the
 * carrier rather than restate it.
 */
function CarrierTile({
  carrier,
  allowed,
  canAdd,
  onAdd,
}: {
  carrier: CarrierComponent;
  allowed: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation("cellular");
  const isNr = carrier.technology === "NR";

  return (
    <div className={cn(CARRIER_TILE.ROOT, allowed && CARRIER_TILE.MATCH)}>
      <div className={CARRIER_TILE.HEAD}>
        {/* Identity variant, not a status role: this says WHICH radio the tile
            belongs to, never that it is healthy. */}
        <Tag variant={isNr ? "nr" : "lte"}>
          {carrier.technology} {carrier.type}
        </Tag>
        <span className={CARRIER_TILE.META}>{carrier.band}</span>
        {allowed ? (
          <span
            className={cn(CARRIER_TILE.ACTION, CARRIER_TILE.ACTION_HELD)}
            title={t("frequency_locking.slots.in_list")}
          >
            <MaterialSymbol name="lock" size={15} filled />
          </span>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={!canAdd || carrier.earfcn === null}
            onClick={onAdd}
            aria-label={t("frequency_locking.a11y.add_carrier")}
            className={cn(
              CARRIER_TILE.ACTION,
              // A disabled control must not wear the affordance of an enabled
              // one. While a tower lock blocks the page these tiles cannot be
              // added, so they drop to the inert fill rather than staying a
              // filled primary disc that invites the click.
              canAdd && carrier.earfcn !== null
                ? CARRIER_TILE.ACTION_FREE
                : CARRIER_TILE.ACTION_OFF,
            )}
          >
            <MaterialSymbol name="add" size={16} />
          </Button>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className={CARRIER_TILE.VALUE_LABEL}>
          {isNr
            ? t("frequency_locking.slots.arfcn_placeholder")
            : t("frequency_locking.slots.earfcn_placeholder")}
        </span>
        <span className={CARRIER_TILE.VALUE}>{carrier.earfcn ?? "—"}</span>
        {carrier.rsrp !== null ? (
          <span className="text-on-surface-variant ms-auto text-[13px] font-semibold tabular-nums">
            {carrier.rsrp} dBm
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function FreqLockHero({
  modemState,
  modemData,
  isLoading,
  isRefreshing,
  towerLockActive,
  towerLockStateKnown,
  onRefresh,
  onAddChannel,
}: FreqLockHeroProps) {
  const { t } = useTranslation("cellular");

  const posture = heroPosture(modemState, towerLockActive);
  const tone = VERDICT_TONE[posture];

  /** Blocked, but only because the tower state could not be read. Every copy
   *  branch below has to say that rather than assert a lock we never saw. */
  const blockedByUnknown = posture === "blocked" && !towerLockStateKnown;

  // Memoised, not a bare `?? []`: the fallback would allocate a fresh array on
  // every render and invalidate `servingInList` below on every poll tick.
  const carriers = React.useMemo(
    () => modemData?.network?.carrier_components ?? [],
    [modemData?.network?.carrier_components],
  );

  const allowedLte = React.useMemo(
    () => (modemState?.lte_entries ?? []).map((e) => e.earfcn),
    [modemState?.lte_entries],
  );
  const allowedNr = React.useMemo(
    () => (modemState?.nr_entries ?? []).map((e) => e.arfcn),
    [modemState?.nr_entries],
  );

  const verdictTitle =
    posture === "locked"
      ? t("frequency_locking.verdict.locked_title")
      : posture === "blocked"
        ? blockedByUnknown
          ? t("frequency_locking.verdict.blocked_unknown_title")
          : t("frequency_locking.verdict.blocked_title")
        : posture === "unknown"
          ? t("frequency_locking.verdict.unknown_title")
          : t("frequency_locking.verdict.unlocked_title");

  const verdictBody =
    posture === "locked"
      ? t("frequency_locking.verdict.locked_body")
      : posture === "blocked"
        ? blockedByUnknown
          ? t("frequency_locking.verdict.blocked_unknown_body")
          : t("frequency_locking.verdict.blocked_body")
        : posture === "unknown"
          ? t("frequency_locking.verdict.unknown_body")
          : t("frequency_locking.verdict.unlocked_body");

  // Is the carrier the modem is actually on inside the list? Only meaningful
  // once something is locked — with an empty list every channel is allowed, so
  // "in the list" would be trivially true and tell the user nothing.
  const servingInList = React.useMemo(() => {
    if (posture !== "locked" || carriers.length === 0) return null;
    const relevant = carriers.filter((c) =>
      c.technology === "NR" ? allowedNr.length > 0 : allowedLte.length > 0,
    );
    if (relevant.length === 0) return null;
    return relevant.every((c) =>
      isChannelAllowed(c.earfcn, c.technology === "NR" ? allowedNr : allowedLte),
    );
  }, [posture, carriers, allowedLte, allowedNr]);

  return (
    <Card className={HERO.ROOT}>
      <div className={HERO.BODY}>
        <div className={HERO.HEAD}>
          <span className={HERO.TITLE}>{t("frequency_locking.live.title")}</span>

          <Button
            type="button"
            variant="tonal-neutral"
            className={cn(PILL_QUIET, "ms-auto")}
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
            aria-label={t("frequency_locking.a11y.refresh")}
          >
            <MaterialSymbol
              name={isRefreshing ? "progress_activity" : "refresh"}
              size={16}
              className={isRefreshing ? "animate-spin" : undefined}
            />
            {t("frequency_locking.live.refresh")}
          </Button>
        </div>

        <div className={HERO.SPLIT}>
          {/* ---- Verdict rail ------------------------------------------- */}
          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.VERDICT} />
          ) : (
            <div className={cn(VERDICT.ROOT, tone.panel)}>
              <span className={cn(VERDICT.DISC, tone.disc)}>
                {/* The panel tone stays `blocked`'s - the consequence is the
                    same - but the MARK does not. `block` says "a tower lock is
                    holding this"; the unread case has to say "we cannot see",
                    and two states sharing one slot may never share a glyph. */}
                <MaterialSymbol
                  name={blockedByUnknown ? "visibility_off" : tone.glyph}
                  size={22}
                  filled={blockedByUnknown ? false : tone.filled}
                />
              </span>
              <span className={VERDICT.TITLE}>{verdictTitle}</span>
              <span className={VERDICT.BODY}>{verdictBody}</span>

              <div className={VERDICT.FOOT}>
                {posture === "unlocked" ? (
                  <Badge variant="muted">
                    <MaterialSymbol name="check" size={BADGE_GLYPH_SIZE} />
                    {t("frequency_locking.verdict.tower_lock_off")}
                  </Badge>
                ) : null}

                {servingInList !== null ? (
                  <Badge variant={servingInList ? "muted" : "warning"}>
                    <MaterialSymbol
                      name={servingInList ? "check" : "warning"}
                      size={BADGE_GLYPH_SIZE}
                      filled={!servingInList}
                    />
                    {servingInList
                      ? t("frequency_locking.verdict.serving_in_list")
                      : t("frequency_locking.verdict.serving_out_of_list")}
                  </Badge>
                ) : null}

                {/* The honest headline of this feature, and the reason it is
                    stated on the verdict rather than buried in a tooltip:
                    frequency locking has NO failover watcher. Band locking
                    self-heals in ~30s and tower locking in ~80s; this one never
                    does. Only shown while a lock is actually in force, because
                    that is the only time it can cost anything. */}
                {posture === "locked" ? (
                  // `muted`, not `warning`. This chip only ever renders ON the
                  // amber locked panel, and an amber chip on an amber container
                  // is the one place the `warning` role cannot separate itself
                  // from its own background — it washed out in light mode. The
                  // panel already carries the amber; the chip carries the fact,
                  // told apart from its neighbour by glyph rather than by hue,
                  // which is what the Every-Chip-Has-A-Glyph rule is for.
                  <Badge variant="muted">
                    <MaterialSymbol name="block" size={BADGE_GLYPH_SIZE} />
                    {t("frequency_locking.verdict.no_recovery")}
                  </Badge>
                ) : null}
              </div>
            </div>
          )}

          {/* ---- Carriers on air ---------------------------------------- */}
          <div className={CAMPED.ROOT}>
            <div className={CAMPED.HEAD}>
              <LiveDot />
              <span className={CAMPED.LABEL}>
                {t("frequency_locking.live.camped_title")}
              </span>
              {carriers.length > 0 ? (
                <span className={CAMPED.META}>
                  {t("frequency_locking.live.camped_meta", {
                    count: carriers.length,
                    bandwidth: carriers.reduce(
                      (sum, c) => sum + (c.bandwidth_mhz || 0),
                      0,
                    ),
                  })}
                </span>
              ) : null}
            </div>

            {carriers.length === 0 ? (
              <div className={CARRIER_NOTE_TILE}>
                <MaterialSymbol name="signal_disconnected" size={18} />
                <span className="text-sm font-semibold">
                  {t("frequency_locking.live.camped_empty_title")}
                </span>
                <span className="text-xs text-pretty">
                  {t("frequency_locking.live.camped_empty_body")}
                </span>
              </div>
            ) : (
              <div className={CAMPED.GRID}>
                {carriers.map((carrier, index) => (
                  <CarrierTile
                    key={`${carrier.technology}-${carrier.type}-${carrier.earfcn}-${index}`}
                    carrier={carrier}
                    allowed={isChannelAllowed(
                      carrier.earfcn,
                      carrier.technology === "NR" ? allowedNr : allowedLte,
                    )}
                    canAdd={!towerLockActive}
                    onAdd={() => {
                      if (carrier.earfcn === null) return;
                      onAddChannel(
                        carrier.technology,
                        carrier.earfcn,
                        carrierScs(carrier, modemData),
                      );
                    }}
                  />
                ))}

                {/* The spare cell explains the page's one genuinely
                    counter-intuitive rule, in the place where the user is
                    about to act on it. */}
                {carriers.length < 3 ? (
                  <div className={CARRIER_NOTE_TILE}>
                    <MaterialSymbol
                      name={
                        blockedByUnknown
                          ? "visibility_off"
                          : towerLockActive
                            ? "swap_horiz"
                            : "graphic_eq"
                      }
                      size={18}
                    />
                    <span className="text-xs/relaxed text-pretty">
                      {blockedByUnknown
                        ? t("frequency_locking.live.compare_hint_unknown")
                        : towerLockActive
                          ? t("frequency_locking.live.compare_hint")
                          : t("frequency_locking.live.add_hint")}
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {towerLockActive ? (
              <span className={CAMPED.NOTE}>
                {blockedByUnknown
                  ? t("frequency_locking.live.add_blocked_unknown")
                  : t("frequency_locking.live.add_blocked")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default FreqLockHero;

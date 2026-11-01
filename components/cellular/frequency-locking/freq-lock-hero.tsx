"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { CarrierComponent, ModemStatus } from "@/types/modem-status";
import type { FreqLockModemState } from "@/types/frequency-locking";

import {
  CAMPED,
  NOTICE,
  NOTICE_TONE,
  CARRIER_NOTE_TILE,
  CARRIER_TILE,
  HERO,
  SKELETON_SHAPE,
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
// That asymmetry is why Refresh sits in the page header (it re-reads the lock
// state) rather than a "live" badge over the strip. Only the carriers are live.
//
// The strip is just the carriers: a carrier inside the lock list wears a primary
// ring and a filled lock, one outside a list the modem is holding an amber ring.
// The only prose is a notice when something blocks or hides the lock state.
// =============================================================================

export interface FreqLockHeroProps {
  modemState: FreqLockModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  /** The last status read's failure, or null. Shown once, here, rather than
   *  repeated in both lock cards (Copy & Help: say a message once). */
  loadError: string | null;
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
 * `blocked` outranks every READ state: while a tower lock is active no write on this
 * page can succeed, so leading with "Locked" would describe a state the user
 * cannot currently reach or change.
 */
function heroPosture(
  modemState: FreqLockModemState | null,
  towerLockActive: boolean,
): LockPosture {
  // A read that never answered is "unknown" first: the tower flags are only the
  // fail-safe default then, and the verdict must not explain a block it inferred.
  if (!modemState) return "unknown";
  if (towerLockActive) return "blocked";
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
  outside,
  canAdd,
  onAdd,
}: {
  carrier: CarrierComponent;
  allowed: boolean;
  /** On air, but a lock list is in force and this channel is not in it. */
  outside: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation("cellular");
  const isNr = carrier.technology === "NR";

  return (
    <div
      className={cn(
        CARRIER_TILE.ROOT,
        allowed && CARRIER_TILE.MATCH,
        outside && CARRIER_TILE.WARN,
      )}
    >
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
  loadError,
  towerLockActive,
  towerLockStateKnown,
  onAddChannel,
}: FreqLockHeroProps) {
  const { t } = useTranslation("cellular");

  const posture = heroPosture(modemState, towerLockActive);

  /** Blocked, but only because the tower state could not be read. Every copy
   *  branch below has to say that rather than assert a lock we never saw. */
  const blockedByUnknown = posture === "blocked" && !towerLockStateKnown;

  // Memoised, not a bare `?? []`: the fallback would allocate a fresh array on
  // every render and invalidate `servingInList` below on every poll tick.
  const carriers = React.useMemo(
    () => modemData?.network?.carrier_components ?? [],
    [modemData?.network?.carrier_components],
  );

  // Read only while the modem also reports the leg locked: the entry arrays can
  // outlive a release, and a stale list would ring carriers for a lock that is gone.
  const allowedLte = React.useMemo(
    () =>
      modemState?.lte_locked ? modemState.lte_entries.map((e) => e.earfcn) : [],
    [modemState],
  );
  const allowedNr = React.useMemo(
    () =>
      modemState?.nr_locked ? modemState.nr_entries.map((e) => e.arfcn) : [],
    [modemState],
  );

  // Only a state that hides or blocks the lock gets prose. Locked and unlocked
  // are read off the rings, the dots and the cards below.
  const notice =
    posture === "blocked"
      ? blockedByUnknown
        ? {
            tone: NOTICE_TONE.warning,
            title: t("frequency_locking.verdict.blocked_unknown_title"),
            body: t("frequency_locking.verdict.blocked_unknown_body"),
          }
        : {
            tone: NOTICE_TONE.neutral,
            title: t("frequency_locking.verdict.blocked_title"),
            body: t("frequency_locking.verdict.blocked_body"),
          }
      : posture === "unknown"
        ? {
            tone: NOTICE_TONE.warning,
            title: t("frequency_locking.verdict.unknown_title"),
            body: t("frequency_locking.verdict.unknown_body"),
          }
        : null;

  const lockedFor = (c: CarrierComponent) =>
    c.technology === "NR" ? allowedNr : allowedLte;
  const isOutside = (c: CarrierComponent) =>
    lockedFor(c).length > 0 && !isChannelAllowed(c.earfcn, lockedFor(c));
  const anyOutside = carriers.some(isOutside);

  return (
    <Card className={HERO.ROOT}>
      <div className={HERO.BODY}>
        <div className={HERO.HEAD}>
          <CardTitle className={HERO.TITLE}>{t("frequency_locking.live.title")}</CardTitle>
        </div>

        {/* The status read failed over a stale reading. The forms below stay
            usable: a write is a legitimate way out of a failed read, and
            Refresh sits in the page header. With no reading at all the notice
            below already says the status did not answer (say a message once). */}
        {loadError && !isLoading && modemState ? (
          <div
            role="alert"
            className={cn(NOTICE.ROOT, NOTICE_TONE.warning.root)}
          >
            <MaterialSymbol
              name={NOTICE_TONE.warning.glyph}
              size={16}
              filled={NOTICE_TONE.warning.filled}
              className="flex-none"
            />
            <span className={NOTICE.TEXT}>
              <strong className="font-semibold">
                {t("frequency_locking.error.load_title")}
              </strong>{" "}
              {t("frequency_locking.error.load_body")}
            </span>
          </div>
        ) : null}

        {!isLoading && notice ? (
          <div role="status" className={cn(NOTICE.ROOT, notice.tone.root)}>
            <MaterialSymbol
              name={blockedByUnknown ? "visibility_off" : notice.tone.glyph}
              size={16}
              filled={blockedByUnknown ? false : notice.tone.filled}
              className="flex-none"
            />
            <span className={NOTICE.TEXT}>
              <strong className="font-semibold">{notice.title}</strong>{" "}
              {notice.body}
            </span>
          </div>
        ) : null}

        {/* Gated on the SAME `isLoading` as the lock cards below, even though
            `carriers` comes from the fast, free poller snapshot and is usually
            ready well before `modemState` (see THE TWO CLOCKS above). Rendering
            it the instant it arrives would load the strip in two visible
            steps. One strip, one load. */}
        <div className={CAMPED.ROOT}>
          {isLoading ? (
            <div className={CAMPED.GRID}>
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className={SKELETON_SHAPE.CARRIER} />
              ))}
            </div>
          ) : carriers.length === 0 ? (
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
            <>
              <div className={CAMPED.GRID}>
                {carriers.map((carrier, index) => (
                  <CarrierTile
                    key={`${carrier.technology}-${carrier.type}-${carrier.earfcn}-${index}`}
                    carrier={carrier}
                    allowed={isChannelAllowed(carrier.earfcn, lockedFor(carrier))}
                    outside={isOutside(carrier)}
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
              </div>
              {anyOutside ? (
                <p className="text-warning-on-surface inline-flex items-center gap-1.5 text-xs">
                  <MaterialSymbol
                    name="warning"
                    size={16}
                    className="flex-none"
                  />
                  {t("frequency_locking.live.outside_list")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default FreqLockHero;

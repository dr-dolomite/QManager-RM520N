"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { cn } from "@/lib/utils";
import type { DualSlotEntry } from "@/types/cellular-settings";
import { networkTypeLabel } from "@/types/modem-status";
import type { ModemStatus } from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  SIM_STATUS_BADGE,
  SLOT_CHIP,
  SLOT_GLYPH,
  STRIP,
} from "./shapes";

// =============================================================================
// LiveStateStrip — Band A of /cellular/settings
// =============================================================================
// Four tiles under the page header: Network, SIM, Aggregation, Data path. It
// replaces `ModemHeroCard`, an 826-line anchor card that led with AMBR — the
// network-granted rate ceiling, which is the most specialist number on the page,
// is not settable anywhere on it, and cannot be moved by any of the six writable
// fields below. Eighteen distinct facts rendered in that one card.
//
// -----------------------------------------------------------------------------
// ONE CLOCK, AND THAT IS THE WHOLE POINT OF THE SPLIT
// -----------------------------------------------------------------------------
// Every figure in every tile is read from the poller snapshot
// (`/tmp/qmanager_status.json`, ~4s), so the freshness chip in the band header
// is honest about the entire band. The hero could not say that: its rail ran on
// the poller while two of its three columns ran on the settings GET, which does
// not tick at all — which is why it needed two readiness flags, two failure
// branches, a freshness chip deliberately scoped to one band, and a footnote
// whose own JSDoc admitted "the hero has TWO CLOCKS and one of them does not
// tick". The rate ceiling now lives in its own band with its own provenance
// line, and that footnote is deleted rather than reworded.
//
// The ONE fact here that does not come from the poller is `dualSlot`, in the SIM
// tile's caption. It is not a second clock in the sense that mattered: which
// physical card sits in the other slot is a hardware fact that changes when
// someone opens the device, not a reading that goes stale between polls. It is
// also allowed to disagree with the tile's own value during a slot apply — see
// below, where that disagreement is the information.
//
// -----------------------------------------------------------------------------
// THE SIM TILE DELIBERATELY OVERLAPS THE `sim_slot` CONTROL BELOW IT
// -----------------------------------------------------------------------------
// This is not the duplication the hero had. The hero rendered radio power and
// the active slot as read-only rows sourced from `saved` — the exact object the
// controls ~400px below were bound to, so the two could never disagree and the
// row said nothing the control did not. Radio power is gone from this band
// entirely for that reason.
//
// The slot stays, and switches source. The TILE reports the slot the modem is
// ON (poller); the CONTROL holds the slot the user has ASKED FOR (settings). A
// SIM-slot apply takes ~35s, and for that whole window the two legitimately
// disagree — which is precisely the moment a technician needs to see both.
//
// The cost is stated rather than hidden: the poller SEEDS `network.sim_slot` to
// 1 for roughly the first 60s of its life, so a freshly started poller can show
// "SIM 1" before the modem was ever asked. That is the same class of defect the
// settings GET has (`settings.sh` seeds `sim_slot=1` / `cfun=1` and still
// returns `success:true`), so neither source can currently express "not read";
// the poller is chosen here because the question this tile asks is a live one.
//
// -----------------------------------------------------------------------------
// IDENTITY LIVES ON THE DISC, NEVER ON A TILE BODY
// -----------------------------------------------------------------------------
// `radio/summary-tiles.tsx` reached this through five generations: Gen 2's
// full-width tonal slab measured 623x212 = 132,033px^2 carrying 7.2% ink, and
// Gen 5 removed body tint outright. The hero's rail was that slab, and its own
// JSDoc cited that file as its precedent. Every body here is `STRIP.BODY`; the
// disc is the only coloured element. An unidentified radio (`network.type ===
// ""`) takes the NEUTRAL disc and never claims the 5G blue.
//
// -----------------------------------------------------------------------------
// THE STATE-HONESTY BURDEN, CARRIED FORWARD FROM THE HERO
// -----------------------------------------------------------------------------
//   `network.type` can legitimately be `""` — the serving-cell parse produced no
//                  identifiable RAT. `networkTypeLabel("")` returns "Unknown"
//                  and cannot return "LTE".
//   `carrier`      empty means the poller has published no operator name, which
//                  is NOT the same as "not registered": it is a Tier-2 field
//                  seeded to "" at poller start, so a fully attached modem
//                  reports "" for the first ~60s. The copy states the READ ("No
//                  carrier reported"), never the registration state.
//   `apn`          empty is reported the same way, for the same reason.
//   `.sim`         absent on any device OTA-upgraded from an older poller; falls
//                  back to the `unknown` tone. `sim.status` is the reliable
//                  channel — `sim.inserted` is `0 | 1 | null` on the wire
//                  against a `boolean` type and must not be read.
//   `dualSlot`     `null` is the honest "the modem cannot answer the dual-slot
//                  AT query at all". The caption is OMITTED rather than filled
//                  with a placeholder.
// =============================================================================

const K = "core_settings.basic";

/**
 * The `sim_status` leaf is chosen by a string the poller emits, so the key is
 * assembled from the group root rather than from `K`. A half-interpolated
 * `${K}.sim_status.${status}` is not a key any tool can resolve statically, and
 * this surface's translation coverage is checked by reading call sites.
 */
const SIM_STATUS_GROUP = "core_settings.basic.sim_status";

/** The same, for the slot chip's screen-reader sentence. */
const SIM_SLOTS_GROUP = "core_settings.basic.sim_slots";

/**
 * The live mark on the freshness chip. Two stacked spans so the ping expands
 * while the dot itself stays put — scaling the dot would make the chip's own
 * metrics breathe. Lifted unchanged from the retired hero, which took it from
 * `frequency-locking/freq-lock-hero.tsx`.
 *
 * It runs ONLY on the live branch. A pulse over frozen numbers is a worse lie
 * than no indicator at all, so the stale branch swaps to a static glyph.
 */
function LiveDot() {
  return (
    <span className="relative inline-flex size-2 shrink-0 items-center justify-center">
      <span className="bg-success animate-live-ping absolute inline-flex size-2 rounded-pill" />
      <span className="bg-success relative inline-flex size-2 rounded-pill" />
    </span>
  );
}

/**
 * One tile. There is deliberately no `tone` prop for the BODY: every body on
 * this strip is neutral, so a caller cannot tint one back. Making the wrong
 * thing unreachable is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph,
  disc,
  eyebrow,
  value,
  mono = false,
  badge,
  caption,
}: {
  glyph: MaterialSymbolName;
  /** The disc's fill pair — the only colour a tile is allowed to carry. */
  disc: string;
  eyebrow: string;
  value: string;
  /** True when the value is an identifier the device emits verbatim. */
  mono?: boolean;
  /** An inline chip riding beside the figure (the SIM tile's status). */
  badge?: React.ReactNode;
  caption?: React.ReactNode;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, STRIP.BODY)}>
      <span className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={STRIP.GLYPH} />
      </span>
      <div className={STRIP.TEXT}>
        <span className={STRIP.EYEBROW}>{eyebrow}</span>
        <span className={mono ? STRIP.VALUE_MONO : STRIP.VALUE}>
          <span className={STRIP.VALUE_TEXT}>{value}</span>
          {badge}
        </span>
        {caption ? <span className={STRIP.CAPTION}>{caption}</span> : null}
      </div>
    </div>
  );
}

/**
 * The masked tail of an ICCID: three bullets and the last four digits.
 *
 * NEVER THE FULL NUMBER. An ICCID identifies a subscriber's card and this is a
 * glance readout, not an inventory screen — four digits is enough to tell two
 * cards apart, which is the only question this caption answers. The masking is
 * done HERE and not in the CGI: the backend reports the fact it read, and how
 * much of it a given surface shows is a display decision (Tracked SIMs shows
 * more).
 */
function maskIccid(iccid: string): string | null {
  const digits = iccid.trim();
  if (!digits) return null;
  return digits.length > 4 ? `•••${digits.slice(-4)}` : digits;
}

/**
 * The peer slot, as the SIM tile's caption. Active is a FILLED CHIP with its own
 * glyph; a standby or empty slot is plain inline text with a different one — see
 * `SLOT_CHIP` in shapes.ts for why this is not a status Badge.
 *
 * The visible text is deliberately terse ("SIM 2 •••9681"), so the accessible
 * name restates the whole fact in a sentence: a screen reader gets "SIM 2,
 * standby, card ending 9681" rather than a stream of bullets.
 */
function SlotChip({ entry }: { entry: DualSlotEntry }) {
  const { t } = useTranslation("cellular");

  const tail = maskIccid(entry.iccid);
  const slotLabel = t(`${K}.readout.slot_n`, { slot: entry.slot });
  const glyph = entry.active
    ? SLOT_GLYPH.active
    : tail
      ? SLOT_GLYPH.present
      : SLOT_GLYPH.empty;

  // The empty case is a real one on a single-SIM install and must read as a
  // fact, not as a blank: "SIM 2 Empty".
  const srKey = tail ? (entry.active ? "sr_active" : "sr_standby") : "sr_empty";

  return (
    <span
      className={entry.active ? SLOT_CHIP.ACTIVE : SLOT_CHIP.IDLE}
      aria-label={t(`${SIM_SLOTS_GROUP}.${srKey}`, {
        slot: entry.slot,
        last4: tail ? tail.slice(-4) : "",
      })}
    >
      <MaterialSymbol name={glyph} filled size={SLOT_CHIP.GLYPH} />
      <span aria-hidden>{slotLabel}</span>
      <span aria-hidden className={tail ? SLOT_CHIP.ICCID : undefined}>
        {tail ?? t(`${K}.sim_slots.empty`)}
      </span>
    </span>
  );
}

export interface LiveStateStripProps {
  /** The poller snapshot. `null` while the first read has not landed. */
  status: ModemStatus | null;
  statusLoading: boolean;
  /**
   * The poller's last error, or `null`. Load-bearing: the hook clears
   * `statusLoading` on failure while leaving `status` at `null`, so a readiness
   * flag built as `!loading && data !== null` is `false` FOREVER after a dead
   * poller. Without this the strip shimmers indefinitely — including over the
   * freshness chip, which is the one thing here that would have said so.
   */
  statusError: string | null;
  /** Poller freshness. Drives the band header's chip and nothing else. */
  isStale: boolean;
  /**
   * Both physical slots, from the settings GET. `null` is an EXPECTED state, not
   * an error: the backend omits `dual_slot` entirely on firmware that cannot
   * answer the query, and the caption is omitted rather than rendered empty.
   */
  dualSlot: DualSlotEntry[] | null;
}

export function LiveStateStrip({
  status,
  statusLoading,
  statusError,
  isStale,
  dualSlot,
}: LiveStateStripProps) {
  const { t } = useTranslation("cellular");

  const ready = !statusLoading && status !== null;
  // A read that FAILED and left nothing behind. Distinct from "still loading":
  // the skeleton is a promise, and this is where the promise is broken.
  const failed = !ready && statusError !== null;

  const network = status?.network;
  const networkType = network?.type ?? "";

  const discTone =
    networkType === "LTE"
      ? STRIP.DISC_LTE
      : networkType === "5G-NSA" || networkType === "5G-SA"
        ? STRIP.DISC_NR
        : STRIP.DISC_NEUTRAL;

  const carrier = network?.carrier?.trim() || t(`${K}.strip.carrier_none`);

  const slot = network?.sim_slot ?? null;
  const simStatus = status?.sim?.status ?? "unknown";
  const simTone = SIM_STATUS_BADGE[simStatus] ?? SIM_STATUS_BADGE.unknown;
  // The slot the tile's own value is NOT about. During a ~35s slot apply the
  // settings GET may already report this one active while the poller still
  // reports the other — the chip renders that honestly rather than flattening it.
  const peerSlot =
    dualSlot?.find((entry) => entry.slot !== slot) ??
    (slot === null ? (dualSlot?.[0] ?? null) : null);

  const lteCa = network?.ca_count ?? 0;
  const nrCa = network?.nr_ca_count ?? 0;
  const caActive =
    (network?.ca_active || network?.nr_ca_active) && lteCa + nrCa > 0;

  // The BREAKDOWN, never a sum — `ca_count` and `nr_ca_count` are two
  // independent SCC counts on two radios. And never a ZERO LEG either: a device
  // aggregating two LTE carriers and no NR read "LTE 2 + NR 0", which states an
  // NR aggregation count as a component of an active aggregation. Only the legs
  // actually carrying anything are named.
  const caValue = !caActive
    ? t(`${K}.readout.ca_none`)
    : lteCa > 0 && nrCa > 0
      ? t(`${K}.readout.ca_breakdown`, { lte: lteCa, nr: nrCa })
      : lteCa > 0
        ? t(`${K}.readout.ca_lte_only`, { lte: lteCa })
        : t(`${K}.readout.ca_nr_only`, { nr: nrCa });

  const apn = network?.apn?.trim() || null;

  // The ADDRESS FAMILIES, not the addresses. A compressed IPv6 runs to 39
  // characters and a caption is one truncating line inside a 104px tile, so
  // printing it would degrade to noise exactly where the identifier matters.
  // The APN above it is the identifier this tile is actually about.
  const hasV4 = Boolean(network?.wan_ipv4?.trim());
  const hasV6 = Boolean(network?.wan_ipv6?.trim());
  const ipCaption =
    hasV4 && hasV6
      ? t(`${K}.strip.ip_dual`)
      : hasV4
        ? t(`${K}.strip.ip_v4`)
        : hasV6
          ? t(`${K}.strip.ip_v6`)
          : t(`${K}.strip.ip_none`);

  return (
    <section aria-label={t(`${K}.strip.label`)} className="flex flex-col gap-2">
      <div className={STRIP.HEAD}>
        <span className={STRIP.HEAD_LABEL}>{t(`${K}.strip.label`)}</span>
        {/* Staleness is a property of the READING, not of the radio, so it lives
            in this chip and never dims a disc's identity fill — that would be a
            chromatic health claim about a radio. It is scoped to this band
            because this band is the only thing on the page it is true of. On a
            failed read there is no chip at all: there is no reading for it to be
            a property of. */}
        {ready ? (
          <Badge variant={isStale ? "warning" : "success"}>
            <SwapLabel swapKey={isStale ? "stale" : "live"} className="gap-1.5">
              {isStale ? (
                <MaterialSymbol name="schedule" filled size={BADGE_GLYPH_SIZE} />
              ) : (
                <LiveDot />
              )}
              {t(isStale ? `${K}.strip.stale` : `${K}.strip.live`)}
            </SwapLabel>
          </Badge>
        ) : null}
      </div>

      <div className={TILE_SHAPE.GRID}>
        {ready ? (
          <>
            <Tile
              glyph="cell_tower"
              disc={discTone}
              eyebrow={t(`${K}.strip.network`)}
              value={networkTypeLabel(networkType)}
              caption={carrier}
            />

            <Tile
              glyph="sim_card"
              disc={STRIP.DISC_NEUTRAL}
              eyebrow={t(`${K}.strip.sim`)}
              value={
                slot === null
                  ? t(`${K}.readout.unknown`)
                  : t(`${K}.readout.slot_n`, { slot })
              }
              badge={
                <Badge variant={simTone.variant}>
                  <MaterialSymbol
                    name={simTone.glyph}
                    filled
                    size={BADGE_GLYPH_SIZE}
                  />
                  {t(`${SIM_STATUS_GROUP}.${simStatus}`)}
                </Badge>
              }
              caption={peerSlot ? <SlotChip entry={peerSlot} /> : null}
            />

            <Tile
              glyph="stacked_line_chart"
              disc={STRIP.DISC_SPATIAL}
              eyebrow={t(`${K}.strip.aggregation`)}
              value={caValue}
              caption={
                network?.bandwidth_details?.trim() ||
                t(`${K}.strip.bandwidth_none`)
              }
            />

            <Tile
              glyph="dns"
              disc={STRIP.DISC_NEUTRAL}
              eyebrow={t(`${K}.strip.data_path`)}
              value={apn ?? t(`${K}.readout.no_apn`)}
              mono={apn !== null}
              caption={ipCaption}
            />
          </>
        ) : failed ? (
          // The band keeps the family box and goes NEUTRAL rather than holding a
          // skeleton forever. It spans the grid: four identical "couldn't read"
          // tiles would be one message repeated four times.
          <div
            className={cn(TILE_SHAPE.ROOT, STRIP.BODY, STRIP.NOTICE_SPAN)}
            role="status"
          >
            <span className={cn(TILE_SHAPE.DISC, STRIP.DISC_NEUTRAL)}>
              <MaterialSymbol name="error" filled size={STRIP.GLYPH} />
            </span>
            <div className={STRIP.TEXT}>
              <span className={STRIP.NOTICE_TITLE}>
                {t(`${K}.strip.unavailable_title`)}
              </span>
              <span className={STRIP.CAPTION}>
                {t(`${K}.strip.unavailable_retrying`)}
              </span>
            </div>
          </div>
        ) : (
          // Four skeletons in the SAME grid, mirroring the pin by import rather
          // than by number — a restated height is how a 26px jump at the handoff
          // shipped last time (The Skeleton-Mirror Rule).
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton
              key={index}
              className={cn(TILE_SHAPE.HEIGHT, "rounded-tile")}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default LiveStateStrip;

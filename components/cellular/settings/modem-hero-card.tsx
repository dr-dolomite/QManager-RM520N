"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import {
  staggerRowItem,
  staggerRows,
  transitionEmphasized,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatBitrate } from "@/types/cellular-settings";
import type {
  AmbrData,
  CellularSettings,
  DualSlotEntry,
} from "@/types/cellular-settings";
import { networkTypeLabel } from "@/types/modem-status";
import type { ModemStatus, NetworkType } from "@/types/modem-status";

import {
  AMBR_BLOCK,
  BADGE_GLYPH_SIZE,
  EMPTY_BLOCK,
  GOVERNING_GLYPH,
  GOVERNING_MARK,
  HERO_BODY,
  HERO_BODY_CELL,
  HERO_BODY_PARAMS_CELL,
  HERO_FOOTNOTE,
  HERO_PAD,
  HERO_PARAMS,
  HERO_RAIL,
  HERO_RAIL_TONE,
  HERO_SHELL,
  RATE_CHIP,
  READOUT_ROW,
  SIM_STATUS_BADGE,
  SLOT_CHIP,
  SLOT_GLYPH,
} from "./shapes";

// =============================================================================
// ModemHeroCard — "Current Connection", the read-only anchor of /cellular/settings
// =============================================================================
// One rail over three columns. The rail states the serving technology, the
// carrier and how fresh the reading is; the columns hold the LTE rate limits,
// the 5G rate limits and the parameters the modem is currently running on.
//
// -----------------------------------------------------------------------------
// TWO DATA SOURCES, TWO CLOCKS — AND THE FOOTNOTE EXISTS BECAUSE OF IT
// -----------------------------------------------------------------------------
// The rail and the parameters column come from the poller snapshot
// (`/tmp/qmanager_status.json`, ticks continuously). The two rate columns come
// from the settings GET, which is read on mount and re-read only around a save
// — it does not tick at all. Each half keeps its own loading branch; neither
// may gate the other.
//
// The previous hero carried ONE "Live" chip in its header, describing the
// poller, over a card whose visual majority ran on the manual clock. That was a
// misstatement, not a rounding error. The chip is now scoped to the rail (whose
// facts it is actually about) and the rate columns get `HERO_FOOTNOTE` as their
// own provenance statement.
//
// -----------------------------------------------------------------------------
// A FAILED READ IS A THIRD STATE, NOT A LONGER LOADING STATE
// -----------------------------------------------------------------------------
// Both hooks clear `isLoading` on failure and leave `data` at `null`, so a
// readiness flag built as `!loading && data !== null` is `false` FOREVER after
// a dead poller or a 500 from the settings CGI. This card used to render its
// skeletons off exactly that flag and would shimmer indefinitely — and the one
// honesty channel it owns (the freshness chip) lives on the rail, which is
// precisely the node the skeleton was covering. Each half now takes an explicit
// error prop and states the failure in the failed node's own geometry.
//
// -----------------------------------------------------------------------------
// BOTH RATE BLOCKS RENDER; ONE OF THEM GOVERNS
// -----------------------------------------------------------------------------
// LTE AMBR governs the bearer in BOTH `LTE` and `5G-NSA` (NSA's NR leg is a
// secondary carrier on the LTE-anchored PDN session, with no AMBR of its own).
// NR5G AMBR governs `5G-SA` only. The old hero encoded that by rendering
// exactly one block, which lost the ability to see what the other radio would
// grant; both now render, and `resolveGoverning` marks which one is in force
// through a GLYPH plus a WORD — never a hue. See `GOVERNING_MARK` in shapes.ts
// for why the non-chromatic channel is mandatory here.
//
// -----------------------------------------------------------------------------
// THE STATE-HONESTY BURDEN
// -----------------------------------------------------------------------------
//   `network.type`  can legitimately be `""` — the serving-cell parse produced
//                   no identifiable RAT. `networkTypeLabel("")` returns
//                   "Unknown" and CANNOT return "LTE"; the rail then takes the
//                   NEUTRAL pair, so an unidentified radio never claims the 5G
//                   blue, and NEITHER rate block is marked as governing.
//   `carrier`       empty means the poller has published no operator name. That
//                   is NOT the same as "not registered" and must not be
//                   rendered as such: `carrier` is a Tier-2 field seeded to ""
//                   at poller start, so for the first ~60s of a poller's life a
//                   fully attached modem reports "". The copy states the read
//                   ("No carrier reported"), never the registration state.
//   `apn`           empty is reported the same way, and for the same reason.
//   `cfun`          read from the SETTINGS GET, never the poller. The poller
//   `sim_slot`      seeds both to `1` for the first ~60s of its life, so a
//                   poller-fed "Normal" / "SIM 1" asserts a fact the modem was
//                   never asked for.
//
//                   !! KNOWN BACKEND DEFECT, NOT FIXED HERE. `settings.sh`
//                   seeds `sim_slot="1"` / `cfun="1"` and overwrites them only
//                   when its compound AT query parsed — then returns
//                   `success:true` regardless. So the GET fabricates the same
//                   two values the poller does, and the `readout.unknown`
//                   branch below is currently UNREACHABLE. It is kept because
//                   it is the correct client behaviour the moment the CGI can
//                   express absence (emit `null`, return `success:false` on an
//                   empty read). Do not delete it, and do not read the poller
//                   instead — that source fabricates too.
//   `dualSlot`      absent whenever the modem could not answer the dual-slot AT
//                   query, which is the honest "we did not read this" — unlike
//                   `cfun`/`sim_slot` above, the backend does NOT fabricate a
//                   default here. The row is omitted entirely in that case
//                   rather than rendered with a placeholder value.
//   `.sim`          absent on any device OTA-upgraded from an older poller.
//                   Falls back to the `unknown` tone. `sim.status` is the
//                   reliable channel — `sim.inserted` is `0 | 1 | null` on the
//                   wire against a `boolean` type and must not be read.
//
// DOWNLOAD IS BLUE, UPLOAD IS VIOLET. The rate chips are coloured by DIRECTION,
// not by which radio block they sit in — see `RATE_CHIP` in shapes.ts. The
// arrow glyph is direction's second channel, so the pairing survives
// colour-blindness.
// =============================================================================

export interface ModemHeroCardProps {
  /** The poller snapshot. `null` while the first read has not landed. */
  status: ModemStatus | null;
  statusLoading: boolean;
  /**
   * The poller's last error, or `null`. Load-bearing: the hook clears
   * `statusLoading` on failure while leaving `status` at `null`, so without
   * this the rail and the parameters column shimmer forever.
   */
  statusError: string | null;
  /** The AMBR block from the settings GET. `null` while loading. */
  ambr: AmbrData | null;
  ambrLoading: boolean;
  /** The settings GET's last error, for the same reason as `statusError`. */
  ambrError: string | null;
  /** The modem's serving technology. Governs the rate marker ONLY. */
  networkType: NetworkType;
  /** Poller freshness. Drives the rail's chip and nothing else on this card. */
  isStale: boolean;
  /**
   * The SAVED settings from the CGI GET — never `draft`. A status surface
   * reports saved/live state, never the half-edited form (The State-Honesty
   * Rule). Supplies `cfun` and `sim_slot`.
   */
  saved: CellularSettings | null;
  /**
   * Both physical SIM slots from the SAME settings GET as `saved`, so the two
   * run on one clock — the slot readouts never disagree about which slot is in
   * use because one of them was read later.
   *
   * `null` is an EXPECTED state, not an error: the backend omits `dual_slot`
   * entirely on firmware that cannot answer the dual-slot AT query, and an
   * OTA-upgraded device in that position still renders a complete, working
   * card. The row is omitted rather than rendered empty — see the call site.
   */
  dualSlot: DualSlotEntry[] | null;
}

type Governing = "lte" | "nr5g" | null;

/**
 * Derived from the serving technology ALONE. Array population is evidence a
 * session exists, not evidence it is the governing one — the incumbent's
 * data-driven fallback asserted an LTE anchor from nothing and is deleted.
 */
function resolveGoverning(networkType: NetworkType): Governing {
  if (networkType === "5G-SA") return "nr5g";
  if (networkType === "LTE" || networkType === "5G-NSA") return "lte";
  return null; // "" — the modem could not identify the RAT.
}

/**
 * The live mark on the freshness chip. Two stacked spans so the ping expands
 * while the dot itself stays put — scaling the dot would make the chip's own
 * metrics breathe. Mirrors `frequency-locking/freq-lock-hero.tsx`.
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

interface RateRowProps {
  /** APN (LTE) or DNN (5G). A machine string. */
  name: string;
  dlKbps: number;
  ulKbps: number;
  downLabel: string;
  upLabel: string;
}

function RateRow({ name, dlKbps, ulKbps, downLabel, upLabel }: RateRowProps) {
  return (
    <div className={AMBR_BLOCK.ROW}>
      <span className={AMBR_BLOCK.APN}>{name}</span>
      <div className={AMBR_BLOCK.RATES}>
        <span
          className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_DOWNLOAD)}
          aria-label={`${downLabel} ${formatBitrate(dlKbps)}`}
        >
          <MaterialSymbol
            name="arrow_downward"
            filled
            size={RATE_CHIP.GLYPH}
          />
          {formatBitrate(dlKbps)}
        </span>
        <span
          className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_UPLOAD)}
          aria-label={`${upLabel} ${formatBitrate(ulKbps)}`}
        >
          <MaterialSymbol name="arrow_upward" filled size={RATE_CHIP.GLYPH} />
          {formatBitrate(ulKbps)}
        </span>
      </div>
    </div>
  );
}

/**
 * A column whose read FAILED. Neutral, never an identity fill — painting a
 * radio's hue over a failed read claims a reading that does not exist, exactly
 * as `EMPTY_BLOCK` does for a read that succeeded and came back empty.
 */
function UnavailableBlock({ title, body }: { title: string; body: string }) {
  return (
    <section
      className={cn(EMPTY_BLOCK.ROOT, AMBR_BLOCK.COL_MIN, "justify-center")}
    >
      <MaterialSymbol
        name="error"
        size={EMPTY_BLOCK.GLYPH}
        className="text-on-surface-variant"
      />
      <h3 className={AMBR_BLOCK.TITLE}>{title}</h3>
      <span className={EMPTY_BLOCK.BODY}>{body}</span>
    </section>
  );
}

/**
 * One rate column: LTE or 5G, populated or empty, governing or not.
 *
 * The marker is a chip on the governing block and PLAIN INLINE TEXT on the
 * other. Two glyphs, two shapes, two words, and zero hue difference between the
 * two states within a block — the block's own identity fill is untouched by
 * either. Absence is never the signal: a marker that only ever appeared once
 * would leave the other column ambiguous between "not in use" and "we did not
 * check", which is exactly the `network.type === ""` case.
 */
function RateBlock({
  radio,
  heading,
  entries,
  governing,
  showNsaNote,
  downLabel,
  upLabel,
}: {
  radio: "lte" | "nr5g";
  heading: string;
  entries: AmbrData["lte"] | AmbrData["nr5g"];
  governing: Governing;
  showNsaNote: boolean;
  downLabel: string;
  upLabel: string;
}) {
  const { t } = useTranslation("cellular");
  const K = "core_settings.basic";
  const isLte = radio === "lte";
  const isEmpty = entries.length === 0;

  // `null` is the honest third state: the modem could not identify the RAT, so
  // neither block may claim to be in force and neither may claim not to be.
  const state: "governing" | "idle" | null =
    governing === null ? null : governing === radio ? "governing" : "idle";

  const markerText =
    state === "governing"
      ? t(`${K}.ambr.governing`)
      : state === "idle"
        ? t(`${K}.ambr.not_governing`)
        : null;

  // "In use" read alone is ambiguous, so the group label restates which block
  // it belongs to. With no marker, the label is just the heading — the honest
  // parity with what the eye sees.
  //
  // AN EMPTY NON-GOVERNING BLOCK RENDERS NO MARKER (there is nothing there to
  // be in use or not), so the label must not carry one either. Announcing "Not
  // in use" over a block that makes no governance claim on screen is the same
  // modality asymmetry the `network.type === ""` handling exists to avoid.
  const announcesMarker = markerText !== null && !(isEmpty && state === "idle");
  const groupLabel = announcesMarker
    ? t(`${K}.hero.sr_rate_block`, { radio: heading, state: markerText })
    : heading;

  const marker =
    state === "governing" ? (
      <span
        className={cn(
          GOVERNING_MARK.CHIP,
          isLte ? GOVERNING_MARK.ON_LTE : GOVERNING_MARK.ON_NR,
        )}
      >
        <MaterialSymbol
          name={GOVERNING_GLYPH.governing}
          filled
          size={GOVERNING_MARK.GLYPH}
        />
        {markerText}
      </span>
    ) : state === "idle" ? (
      <span className={GOVERNING_MARK.IDLE}>
        <MaterialSymbol
          name={GOVERNING_GLYPH.idle}
          size={GOVERNING_MARK.GLYPH}
        />
        {markerText}
      </span>
    ) : null;

  if (isEmpty) {
    // NEUTRAL, never the identity fill: painting a radio's hue over no data
    // would claim a reading that does not exist. No chip either — a neutral
    // block wearing an identity-filled chip is a cross-pair, and there is
    // nothing here to be "in use".
    return (
      <section
        role="group"
        aria-label={groupLabel}
        className={cn(EMPTY_BLOCK.ROOT, AMBR_BLOCK.COL_MIN, "justify-center")}
      >
        <MaterialSymbol
          name="signal_cellular_off"
          size={EMPTY_BLOCK.GLYPH}
          className="text-on-surface-variant"
        />
        <h3 className={AMBR_BLOCK.TITLE}>
          {t(isLte ? `${K}.ambr.lte_empty_title` : `${K}.ambr.nr_empty_title`)}
        </h3>
        <span className={EMPTY_BLOCK.BODY}>
          {t(isLte ? `${K}.ambr.lte_empty_reason` : `${K}.ambr.nr_empty_reason`)}
        </span>
        {state === "governing" ? (
          // States what THIS PAGE read, not what the network published. The
          // marker is derived from the LIVE serving technology while the rate
          // arrays were read once on mount, so a hand-off after page open puts
          // an empty column under a governing mark with nothing behind it —
          // "the network has not published a limit" would be a fabricated
          // claim about the network in exactly that case.
          <span className={EMPTY_BLOCK.BODY}>
            {t(`${K}.ambr.governing_unread`)}
          </span>
        ) : null}
      </section>
    );
  }

  return (
    <section
      role="group"
      aria-label={groupLabel}
      className={cn(
        isLte ? AMBR_BLOCK.LTE : AMBR_BLOCK.NR,
        AMBR_BLOCK.COL_MIN,
        // The cell stretches this block to the row height (HERO_BODY_CELL), so
        // its content centres in whatever extra height the parameters column
        // forces. Without this the heading pins to the top and a short block
        // reads as a half-empty box rather than a peer of its neighbours.
        "justify-center",
      )}
    >
      <div className={AMBR_BLOCK.HEADER}>
        <h3 className={AMBR_BLOCK.TITLE}>{heading}</h3>
        {marker}
      </div>
      {showNsaNote ? (
        <p className={AMBR_BLOCK.NOTE}>{t(`${K}.ambr.nsa_note`)}</p>
      ) : null}
      <div className={AMBR_BLOCK.LIST}>
        {entries.map((entry, index) => {
          const name = isLte
            ? (entry as AmbrData["lte"][number]).apn
            : (entry as AmbrData["nr5g"][number]).dnn;
          return (
            <RateRow
              // The index is part of the key deliberately: the CGI emits one
              // entry per PDN session and does not de-duplicate, so two
              // sessions carrying the same APN (a split IMS/internet pair, or
              // two cids configured with one name) would collide on the name
              // alone and React would reconcile the wrong row's rates.
              key={`${name}-${index}`}
              name={name}
              dlKbps={entry.dl_kbps}
              ulKbps={entry.ul_kbps}
              downLabel={downLabel}
              upLabel={upLabel}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * The masked tail of an ICCID: three bullets and the last four digits.
 *
 * NEVER THE FULL NUMBER. An ICCID identifies a subscriber's card and this is a
 * glance readout, not an inventory screen — four digits is enough to tell two
 * cards apart, which is the only question this row answers. The masking is done
 * HERE and not in the CGI: the backend reports the fact it read, and how much of
 * it a given surface shows is a display decision (Tracked SIMs shows more).
 */
function maskIccid(iccid: string): string | null {
  const digits = iccid.trim();
  if (!digits) return null;
  return digits.length > 4 ? `•••${digits.slice(-4)}` : digits;
}

/**
 * One physical slot. Active is a FILLED CHIP with its own glyph; every other
 * slot is plain inline text with a different one — see `SLOT_CHIP` in shapes.ts
 * for why this is not a status Badge.
 *
 * The visible text is deliberately terse ("SIM 1 •••9681"), so the accessible
 * name restates the whole fact in a sentence: a screen reader gets "SIM 1,
 * active, card ending 9681" rather than a stream of bullets.
 */
function SlotChip({ entry }: { entry: DualSlotEntry }) {
  const { t } = useTranslation("cellular");
  const K = "core_settings.basic";

  const tail = maskIccid(entry.iccid);
  const slotLabel = t(`${K}.readout.slot_n`, { slot: entry.slot });
  const glyph = entry.active
    ? SLOT_GLYPH.active
    : tail
      ? SLOT_GLYPH.present
      : SLOT_GLYPH.empty;

  // The empty case is a real one on a single-SIM install and must read as a
  // fact, not as a blank: "SIM 2 Empty" beside "SIM 1 •••9681".
  const srKey = tail
    ? entry.active
      ? "sr_active"
      : "sr_standby"
    : "sr_empty";

  return (
    <span
      className={entry.active ? SLOT_CHIP.ACTIVE : SLOT_CHIP.IDLE}
      aria-label={t(`${K}.sim_slots.${srKey}`, {
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

/** One label/value row in the parameters column. */
function ParamRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={HERO_PARAMS.ROW}>
      <span className={READOUT_ROW.LABEL}>{label}</span>
      <div className={READOUT_ROW.VALUE_GROUP}>{children}</div>
    </div>
  );
}

export function ModemHeroCard({
  status,
  statusLoading,
  statusError,
  ambr,
  ambrLoading,
  ambrError,
  networkType,
  isStale,
  saved,
  dualSlot,
}: ModemHeroCardProps) {
  const { t } = useTranslation("cellular");
  const K = "core_settings.basic";

  const readoutReady = !statusLoading && status !== null;
  const ambrReady = !ambrLoading && ambr !== null;
  // A read that FAILED and left nothing behind. Distinct from "still loading":
  // the skeleton is a promise, and this is where the promise is broken.
  const readoutFailed = !readoutReady && statusError !== null;
  const ambrFailed = !ambrReady && ambrError !== null;

  const governing = resolveGoverning(networkType);
  const unknown = t(`${K}.readout.unknown`);
  const unavailableTitle = t(`${K}.hero.unavailable_title`);

  // --- Band 1: the rail -----------------------------------------------------
  const techLabel = networkTypeLabel(networkType);
  const railTone =
    networkType === "LTE"
      ? { FILL: HERO_RAIL_TONE.LTE, DISC: HERO_RAIL_TONE.LTE_DISC }
      : networkType === "5G-NSA" || networkType === "5G-SA"
        ? { FILL: HERO_RAIL_TONE.NR, DISC: HERO_RAIL_TONE.NR_DISC }
        : { FILL: HERO_RAIL_TONE.NEUTRAL, DISC: HERO_RAIL_TONE.NEUTRAL_DISC };

  const carrier =
    status?.network.carrier?.trim() || t(`${K}.hero.carrier_none`);

  // --- Band 2, column 3: the active parameters ------------------------------
  // `cfun` and `sim_slot` come from `saved`, NEVER from the poller — see the
  // header comment, including the backend defect that currently makes the
  // absent branch unreachable.
  const slot = saved?.sim_slot ?? null;
  const cfunKey =
    saved?.cfun === 1
      ? "normal"
      : saved?.cfun === 0
        ? "radio_off"
        : saved?.cfun === 4
          ? "airplane"
          : null;
  // Radio power reuses the SETTINGS card's own option labels rather than a
  // second copy of "Normal" / "Radio off" / "Airplane" — one string, one place
  // it can drift.
  const radioPowerLabel = cfunKey
    ? t(`${K}.rows.cfun.options.${cfunKey}`)
    : unknown;

  const simStatus = status?.sim?.status ?? "unknown";
  const simTone = SIM_STATUS_BADGE[simStatus] ?? SIM_STATUS_BADGE.unknown;

  const lteCa = status?.network.ca_count ?? 0;
  const nrCa = status?.network.nr_ca_count ?? 0;
  const caActive =
    (status?.network.ca_active || status?.network.nr_ca_active) &&
    lteCa + nrCa > 0;

  // The BREAKDOWN, never a sum — `ca_count` and `nr_ca_count` are two
  // independent SCC counts on two radios. And never a ZERO LEG either: a
  // device aggregating two LTE carriers and no NR read "LTE 2 + NR 0", which
  // states an NR aggregation count as a component of an active aggregation.
  // Only the legs that are actually carrying anything are named.
  const caValue = !caActive
    ? t(`${K}.readout.ca_none`)
    : lteCa > 0 && nrCa > 0
      ? t(`${K}.readout.ca_breakdown`, { lte: lteCa, nr: nrCa })
      : lteCa > 0
        ? t(`${K}.readout.ca_lte_only`, { lte: lteCa })
        : t(`${K}.readout.ca_nr_only`, { nr: nrCa });

  const apn = status?.network.apn?.trim() || null;

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={HERO_PAD}>
        {/* `CardTitle` ships only `leading-none font-semibold` and takes its
            size from the call site. Unsized it inherits 16px, which left the
            anchor card's name the same size as its two peers'. */}
        <CardTitle as="h2" className="text-xl">
          {t(`${K}.hero.title`)}
        </CardTitle>
        <CardDescription>{t(`${K}.hero.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(HERO_PAD, "flex flex-col gap-4")}>
        {/* --- Band 1: the identity rail ---------------------------------
            The motion wrapper is mounted UNCONDITIONALLY and animates once, on
            mount, so this band and the cascade below it run on one rule. It
            was previously gated on `readoutReady`, which meant the rail
            animated on real content while the three columns spent the card's
            authored moment on skeletons and the real columns arrived with no
            motion at all.

            It declares its own initial AND animate: a variants-only child that
            mounts on a swap renders BLANK — a full-height invisible node with
            no error and every check green. */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitionEmphasized}
        >
          {readoutReady ? (
            <div className={cn(HERO_RAIL.ROOT, railTone.FILL)}>
              <span className={cn(HERO_RAIL.DISC, railTone.DISC)}>
                <MaterialSymbol
                  name="cell_tower"
                  filled
                  size={HERO_RAIL.GLYPH}
                />
              </span>
              <div className={HERO_RAIL.TEXT}>
                <span className={HERO_RAIL.TECH}>{techLabel}</span>
                <span className={HERO_RAIL.CARRIER}>{carrier}</span>
              </div>
              <div className={HERO_RAIL.META}>
                {/* Staleness is a property of the READING, not of the radio, so
                    it lives in this chip and never dims the rail's identity
                    fill — that would be a chromatic health claim. */}
                <Badge variant={isStale ? "warning" : "success"}>
                  <SwapLabel
                    swapKey={isStale ? "stale" : "live"}
                    className="gap-1.5"
                  >
                    {isStale ? (
                      <MaterialSymbol
                        name="schedule"
                        filled
                        size={BADGE_GLYPH_SIZE}
                      />
                    ) : (
                      <LiveDot />
                    )}
                    {t(isStale ? `${K}.hero.stale` : `${K}.hero.live`)}
                  </SwapLabel>
                </Badge>
              </div>
            </div>
          ) : readoutFailed ? (
            // The rail keeps its geometry and goes NEUTRAL. No freshness chip:
            // there is no reading for it to be a property of.
            <div className={cn(HERO_RAIL.ROOT, HERO_RAIL_TONE.NEUTRAL)}>
              <span
                className={cn(HERO_RAIL.DISC, HERO_RAIL_TONE.NEUTRAL_DISC)}
              >
                <MaterialSymbol name="error" filled size={HERO_RAIL.GLYPH} />
              </span>
              <div className={HERO_RAIL.TEXT}>
                <span className={HERO_RAIL.NOTICE}>{unavailableTitle}</span>
                <span className={HERO_RAIL.CARRIER}>
                  {t(`${K}.hero.unavailable_retrying`)}
                </span>
              </div>
            </div>
          ) : (
            <Skeleton className={HERO_RAIL.HEIGHT} />
          )}
        </motion.div>

        {/* --- Band 2: the three-column body ------------------------------
            One grid node, loaded and loading alike, with the same three
            children — so the handoff contributes zero layout shift. The
            incumbent applied its tile grid twice, nested, and collapsed the
            whole strip into column 1 at the widest step. */}
        <motion.div
          className={HERO_BODY}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerRowItem} className={HERO_BODY_CELL}>
            {ambrReady ? (
              <RateBlock
                radio="lte"
                heading={t(`${K}.ambr.lte_heading`)}
                entries={ambr.lte}
                governing={governing}
                showNsaNote={networkType === "5G-NSA"}
                downLabel={t(`${K}.ambr.download`)}
                upLabel={t(`${K}.ambr.upload`)}
              />
            ) : ambrFailed ? (
              <UnavailableBlock
                title={unavailableTitle}
                body={t(`${K}.hero.unavailable_static`)}
              />
            ) : (
              <Skeleton className={AMBR_BLOCK.COL_HEIGHT} />
            )}
          </motion.div>

          <motion.div variants={staggerRowItem} className={HERO_BODY_CELL}>
            {ambrReady ? (
              <RateBlock
                radio="nr5g"
                heading={t(`${K}.ambr.nr_heading`)}
                entries={ambr.nr5g}
                governing={governing}
                showNsaNote={false}
                downLabel={t(`${K}.ambr.download`)}
                upLabel={t(`${K}.ambr.upload`)}
              />
            ) : ambrFailed ? (
              <UnavailableBlock
                title={unavailableTitle}
                body={t(`${K}.hero.unavailable_static`)}
              />
            ) : (
              <Skeleton className={AMBR_BLOCK.COL_HEIGHT} />
            )}
          </motion.div>

          <motion.div
            variants={staggerRowItem}
            className={cn(HERO_BODY_CELL, HERO_BODY_PARAMS_CELL)}
          >
            {/* The block shell is the SAME in all three branches — only the
                rows change — so the neutral column does not pop into existence
                on handoff. */}
            <section className={HERO_PARAMS.ROOT}>
              <h3 className={HERO_PARAMS.HEADING}>
                {t(`${K}.hero.params_heading`)}
              </h3>
              {readoutReady ? (
                <>
                  <ParamRow label={t(`${K}.readout.active_slot`)}>
                    <span className={READOUT_ROW.VALUE_TEXT}>
                      {slot === null ? unknown : t(`${K}.readout.slot_n`, { slot })}
                    </span>
                    <Badge variant={simTone.variant}>
                      <MaterialSymbol
                        name={simTone.glyph}
                        filled
                        size={BADGE_GLYPH_SIZE}
                      />
                      {t(`${K}.sim_status.${simStatus}`)}
                    </Badge>
                  </ParamRow>

                  {/* OMITTED, NOT EMPTIED, when the modem did not report the
                      slots. A "SIM slots — Unknown" row on the firmware
                      majority that cannot answer this query at all is noise
                      about a capability rather than a fact about this device;
                      the `readout.unknown` branch above exists for a field the
                      modem is always ASKED for and may fail to answer, which is
                      a different statement. */}
                  {dualSlot && dualSlot.length > 0 ? (
                    <ParamRow label={t(`${K}.sim_slots.label`)}>
                      {dualSlot.map((entry) => (
                        <SlotChip key={entry.slot} entry={entry} />
                      ))}
                    </ParamRow>
                  ) : null}

                  <ParamRow label={t(`${K}.readout.radio_power_label`)}>
                    <span className={READOUT_ROW.VALUE_TEXT}>
                      {radioPowerLabel}
                    </span>
                  </ParamRow>

                  <ParamRow label={t(`${K}.readout.carrier_aggregation`)}>
                    <span
                      className={cn(
                        READOUT_ROW.VALUE_TEXT,
                        !caActive && "text-on-surface-variant",
                      )}
                    >
                      {caValue}
                    </span>
                  </ParamRow>

                  <ParamRow label={t(`${K}.readout.apn_label`)}>
                    <span
                      className={cn(
                        READOUT_ROW.VALUE_MONO,
                        !apn && "text-on-surface-variant",
                      )}
                    >
                      {apn ?? t(`${K}.readout.no_apn`)}
                    </span>
                  </ParamRow>
                </>
              ) : readoutFailed ? (
                <span className={EMPTY_BLOCK.BODY}>
                  {t(`${K}.hero.unavailable_retrying`)}
                </span>
              ) : (
                Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className={READOUT_ROW.HEIGHT} />
                ))
              )}
            </section>
          </motion.div>
        </motion.div>

        {/* Static copy with no data behind it, so it is always rendered — and
            it is the rate columns' only provenance statement. */}
        <p className={HERO_FOOTNOTE}>{t(`${K}.hero.rates_note`)}</p>
      </CardContent>
    </Card>
  );
}

export default ModemHeroCard;

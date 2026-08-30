"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, type TagVariant } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { formatBitrate } from "@/types/cellular-settings";
import type { AmbrData } from "@/types/cellular-settings";
import type { NetworkType } from "@/types/modem-status";

import {
  AMBR_BLOCK,
  EMPTY_BLOCK,
  GOVERNING_GLYPH,
  GOVERNING_MARK,
  RATE_CEILING,
  RATE_CHIP,
} from "./shapes";

// =============================================================================
// RateCeilingDisclosure — Band A2 of /cellular/settings
// =============================================================================
// AMBR, demoted from headline to a summary line with a disclosure.
//
// The retired hero led with this figure across two of its three columns. AMBR is
// the network-granted rate CEILING: the most specialist number on the page, not
// settable anywhere on it, and unmovable by any of the six writable fields
// below. "What will the network let this connection do" is still a legitimate
// glance question, so the GOVERNING pair stays visible. The per-bearer table for
// both radios — two blocks of two figures plus a DNN — is not a glance question,
// and opens on click.
//
// -----------------------------------------------------------------------------
// THIS BAND OWNS ITS OWN CLOCK AND SAYS SO IN WORDS
// -----------------------------------------------------------------------------
// These figures come from the settings GET: read on mount, re-read only around a
// save. They do not tick. The hero carried that admission in `HERO_FOOTNOTE`,
// underneath a card whose only freshness indicator described a DIFFERENT data
// source — the poller — three inches above. Here the provenance line sits under
// the numbers it is about, and nothing on this band claims liveness. That is the
// whole reason the split exists; the footnote is deleted, not reworded.
//
// -----------------------------------------------------------------------------
// BOTH BLOCKS RENDER; ONE OF THEM GOVERNS
// -----------------------------------------------------------------------------
// LTE AMBR governs the bearer in BOTH `LTE` and `5G-NSA` (NSA's NR leg is a
// secondary carrier on the LTE-anchored PDN session, with no AMBR of its own).
// NR5G AMBR governs `5G-SA` only. Rendering exactly one block would lose the
// ability to see what the other radio would grant, so both render and
// `resolveGoverning` marks which is in force through a GLYPH plus a WORD, never
// a hue — see `GOVERNING_MARK` in shapes.ts for why the non-chromatic channel is
// mandatory. ABSENCE IS NOT THE SIGNAL: the idle block says so in words, because
// a marker that only ever appeared once would leave the other block ambiguous
// between "not in use" and "we did not check".
//
// -----------------------------------------------------------------------------
// THE PANEL ANIMATES `grid-template-rows`, WHICH MotionConfig CANNOT SEE
// -----------------------------------------------------------------------------
// `<MotionConfig reducedMotion="user">` collapses transform movement for
// motion/react components. A CSS grid-track transition is neither transform nor
// opacity and is not a motion/react component, so the global switch does not
// reach it and this component has to consult `useReducedMotion()` itself and
// drop the transition class. Exactly the mechanism and the reason recorded in
// 4b4d688 for the frequency-locking skeleton.
//
// DOWNLOAD IS ROSE, UPLOAD IS CYAN. The rate chips are coloured by DIRECTION,
// not by which radio block they sit in — see `RATE_CHIP` in shapes.ts. The arrow
// glyph is direction's second channel, so the pairing survives colour-blindness.
// =============================================================================

const K = "core_settings.basic";

type Governing = "lte" | "nr5g" | null;

/**
 * Derived from the serving technology ALONE. Array population is evidence a
 * session exists, not evidence it is the governing one — a data-driven fallback
 * would assert an LTE anchor from nothing.
 */
function resolveGoverning(networkType: NetworkType): Governing {
  if (networkType === "5G-SA") return "nr5g";
  if (networkType === "LTE" || networkType === "5G-NSA") return "lte";
  return null; // "" — the modem could not identify the RAT.
}

interface RatePairProps {
  dlKbps: number;
  ulKbps: number;
  downLabel: string;
  upLabel: string;
}

/** The down/up chip pair. The summary line and every bearer row wear the same one. */
function RatePair({ dlKbps, ulKbps, downLabel, upLabel }: RatePairProps) {
  return (
    <>
      <span
        className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_DOWNLOAD)}
        aria-label={`${downLabel} ${formatBitrate(dlKbps)}`}
      >
        <MaterialSymbol name="arrow_downward" filled size={RATE_CHIP.GLYPH} />
        {formatBitrate(dlKbps)}
      </span>
      <span
        className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_UPLOAD)}
        aria-label={`${upLabel} ${formatBitrate(ulKbps)}`}
      >
        <MaterialSymbol name="arrow_upward" filled size={RATE_CHIP.GLYPH} />
        {formatBitrate(ulKbps)}
      </span>
    </>
  );
}

interface RateRowProps extends RatePairProps {
  /** APN (LTE) or DNN (5G). A machine string. */
  name: string;
}

function RateRow({ name, ...pair }: RateRowProps) {
  return (
    <div className={AMBR_BLOCK.ROW}>
      <span className={AMBR_BLOCK.APN}>{name}</span>
      <div className={AMBR_BLOCK.RATES}>
        <RatePair {...pair} />
      </div>
    </div>
  );
}

/**
 * One radio's block: LTE or 5G, populated or empty, governing or not.
 *
 * The block is NEUTRAL and its radio identity is an outline `Tag` (The Two-Form
 * Rule). The governing marker is a filled chip on the block that is in force and
 * PLAIN INLINE TEXT on the other — two glyphs, two shapes, two words, and no
 * reliance on hue for the distinction.
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
  const isLte = radio === "lte";
  const isEmpty = entries.length === 0;
  const tagVariant: TagVariant = isLte ? "lte" : "nr";

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

  // "In use" read alone is ambiguous, so the group label restates which block it
  // belongs to. AN EMPTY NON-GOVERNING BLOCK RENDERS NO MARKER — there is
  // nothing there to be in use or not — so the label must not carry one either.
  const announcesMarker = markerText !== null && !(isEmpty && state === "idle");
  const groupLabel = announcesMarker
    ? t(`${K}.rate_ceiling.sr_rate_block`, {
        radio: heading,
        state: markerText,
      })
    : heading;

  const marker =
    state === "governing" ? (
      <span
        className={cn(
          GOVERNING_MARK.CHIP,
          RATE_CEILING.BLOCK_MARK,
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
      <span className={cn(GOVERNING_MARK.IDLE, RATE_CEILING.BLOCK_MARK)}>
        <MaterialSymbol name={GOVERNING_GLYPH.idle} size={GOVERNING_MARK.GLYPH} />
        {markerText}
      </span>
    ) : null;

  return (
    <section role="group" aria-label={groupLabel} className={RATE_CEILING.BLOCK}>
      <div className={AMBR_BLOCK.HEADER}>
        <Tag variant={tagVariant}>{isLte ? "LTE" : "5G NR"}</Tag>
        <h4 className={RATE_CEILING.BLOCK_TITLE}>{heading}</h4>
        {marker}
      </div>

      {showNsaNote ? (
        <p className={AMBR_BLOCK.NOTE}>{t(`${K}.ambr.nsa_note`)}</p>
      ) : null}

      {isEmpty ? (
        <>
          <p className={AMBR_BLOCK.NOTE}>
            {t(isLte ? `${K}.ambr.lte_empty_reason` : `${K}.ambr.nr_empty_reason`)}
          </p>
          {state === "governing" ? (
            // States what THIS PAGE read, not what the network published. The
            // marker is derived from the LIVE serving technology while the rate
            // arrays were read once on mount, so a hand-off after page open puts
            // an empty block under a governing mark with nothing behind it —
            // "the network has not published a limit" would be a fabricated
            // claim about the network in exactly that case.
            <p className={AMBR_BLOCK.NOTE}>{t(`${K}.ambr.governing_unread`)}</p>
          ) : null}
        </>
      ) : (
        <div className={AMBR_BLOCK.LIST}>
          {entries.map((entry, index) => (
            <RateRow
              // The index is part of the key deliberately: the CGI emits one
              // entry per PDN session and does not de-duplicate, so two sessions
              // carrying the same APN (a split IMS/internet pair, or two cids
              // configured with one name) would collide on the name alone and
              // React would reconcile the wrong row's rates.
              key={`${isLte ? (entry as AmbrData["lte"][number]).apn : (entry as AmbrData["nr5g"][number]).dnn}-${index}`}
              name={
                isLte
                  ? (entry as AmbrData["lte"][number]).apn
                  : (entry as AmbrData["nr5g"][number]).dnn
              }
              dlKbps={entry.dl_kbps}
              ulKbps={entry.ul_kbps}
              downLabel={downLabel}
              upLabel={upLabel}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export interface RateCeilingDisclosureProps {
  /** The AMBR block from the settings GET. `null` while loading. */
  ambr: AmbrData | null;
  ambrLoading: boolean;
  /**
   * The settings GET's last error. The hook clears `ambrLoading` on failure
   * while leaving `ambr` at `null`, so without this the band shimmers forever
   * after a 500 from the settings CGI.
   */
  ambrError: string | null;
  /** The modem's serving technology. Governs the in-force marker ONLY. */
  networkType: NetworkType;
}

export function RateCeilingDisclosure({
  ambr,
  ambrLoading,
  ambrError,
  networkType,
}: RateCeilingDisclosureProps) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  const ready = !ambrLoading && ambr !== null;
  const failed = !ready && ambrError !== null;

  const governing = resolveGoverning(networkType);
  const downLabel = t(`${K}.ambr.download`);
  const upLabel = t(`${K}.ambr.upload`);

  if (!ready) {
    return failed ? (
      // Neutral, and it keeps the summary row's box. Painting a radio's hue over
      // a failed read would claim a reading that does not exist.
      <div className={RATE_CEILING.ROOT} role="status">
        <div className={RATE_CEILING.SUMMARY}>
          <span
            className={cn(RATE_CEILING.DISC, RATE_CEILING.DISC_NEUTRAL)}
            aria-hidden
          >
            <MaterialSymbol name="error" filled size={RATE_CEILING.GLYPH} />
          </span>
          <div className={RATE_CEILING.TEXT}>
            <span className={RATE_CEILING.EYEBROW}>
              {t(`${K}.rate_ceiling.eyebrow`)}
            </span>
            <span className={EMPTY_BLOCK.BODY}>
              {t(`${K}.rate_ceiling.unavailable`)}
            </span>
          </div>
        </div>
      </div>
    ) : (
      <Skeleton className={RATE_CEILING.HEIGHT} />
    );
  }

  // The pair the summary leads with. Only the GOVERNING radio's first bearer:
  // the summary answers "what is this connection's ceiling", and a second
  // radio's figure beside it answers a question nobody asked at a glance.
  const governingEntry =
    governing === "lte"
      ? (ambr.lte[0] ?? null)
      : governing === "nr5g"
        ? (ambr.nr5g[0] ?? null)
        : null;

  const inForceTag =
    governing === null
      ? null
      : t(`${K}.rate_ceiling.in_force`, {
          radio: t(
            governing === "lte" ? `${K}.ambr.lte_short` : `${K}.ambr.nr_short`,
          ),
        });

  return (
    <div className={RATE_CEILING.ROOT}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        className={RATE_CEILING.SUMMARY}
      >
        <span
          className={cn(RATE_CEILING.DISC, RATE_CEILING.DISC_RATE)}
          aria-hidden
        >
          <MaterialSymbol name="speed" filled size={RATE_CEILING.GLYPH} />
        </span>
        <span className={RATE_CEILING.TEXT}>
          <span className={RATE_CEILING.EYEBROW}>
            {t(`${K}.rate_ceiling.eyebrow`)}
          </span>
          <span className={RATE_CEILING.VALUE}>
            {governingEntry ? (
              <RatePair
                dlKbps={governingEntry.dl_kbps}
                ulKbps={governingEntry.ul_kbps}
                downLabel={downLabel}
                upLabel={upLabel}
              />
            ) : (
              // NOT a zero. `governing === null` means the RAT was unidentified
              // and `governingEntry === null` means the governing radio
              // published no limit — neither is "the ceiling is nothing".
              <span className={EMPTY_BLOCK.BODY}>
                {t(`${K}.rate_ceiling.no_ceiling`)}
              </span>
            )}
            {inForceTag ? <Tag>{inForceTag}</Tag> : null}
          </span>
        </span>
        <MaterialSymbol
          name="expand_more"
          size={RATE_CEILING.GLYPH}
          className={cn(
            RATE_CEILING.CHEVRON,
            open && RATE_CEILING.CHEVRON_OPEN,
          )}
        />
      </button>

      <div
        id={panelId}
        className={cn(RATE_CEILING.PANEL, !reduceMotion && RATE_CEILING.PANEL_MOTION)}
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className={RATE_CEILING.PANEL_CLIP}>
          <div className={RATE_CEILING.INNER}>
            <RateBlock
              radio="lte"
              heading={t(`${K}.ambr.lte_heading`)}
              entries={ambr.lte}
              governing={governing}
              showNsaNote={networkType === "5G-NSA"}
              downLabel={downLabel}
              upLabel={upLabel}
            />
            <RateBlock
              radio="nr5g"
              heading={t(`${K}.ambr.nr_heading`)}
              entries={ambr.nr5g}
              governing={governing}
              showNsaNote={false}
              downLabel={downLabel}
              upLabel={upLabel}
            />
            {/* The band's own provenance. Static copy with no data behind it, so
                it always renders — and it is the only statement anywhere on this
                page about where these figures came from and how old they are. */}
            <p className={cn(RATE_CEILING.PROVENANCE, "@2xl/main:col-span-2")}>
              {t(`${K}.rate_ceiling.provenance`)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RateCeilingDisclosure;

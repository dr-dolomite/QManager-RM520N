"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  EthernetPortIcon,
  GaugeIcon,
  HelpCircleIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UnplugIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { cn } from "@/lib/utils";

import {
  BAND,
  CAPTION,
  DISC_DOWN,
  DISC_NEUTRAL,
  DISC_TRANSITION,
  DISC_UP,
  EYEBROW,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
} from "./shapes";
import type { EthernetStatus } from "./types";

// =============================================================================
// LinkStateStrip — Band A of /local-network/ethernet
// =============================================================================
// Four tiles under the page header: link state, negotiated rate, duplex,
// negotiation. It replaces `EthernetTiles`, which gave one tile to each field of
// `ethernet.sh`'s JSON — the shape of the payload rather than the shape of the
// question. Speed and duplex are not independent facts; they are properties of
// one negotiated link, and the retired code already knew it (it printed "N/A"
// into both when the link was down).
//
// -----------------------------------------------------------------------------
// ONE CLOCK, AND THAT IS WHAT THE BAND CHIP IS HONEST ABOUT
// -----------------------------------------------------------------------------
// Every figure here is read from the same 10s GET, so the unresponsive chip in
// the band header is true of the whole band rather than of one column of it.
// There is NO healthy half to that chip: the same request retired the "live"
// pill on `/cellular/` and `/cellular/settings`, because every figure on a band
// like this is a poll read and "live" is its resting state, not news. Staleness
// is the one moment the band can mislead — the figures are FROZEN while still
// looking current — so the warning half stays.
//
// It is a property of the READING, so it never dims a tile or a disc, and it
// does not render at all on a failed first read: there is no reading for it to
// be a property of.
//
// -----------------------------------------------------------------------------
// THE NEGOTIATION TILE NOW REPORTS THE PHY, NOT THE SAVED SETTING
// -----------------------------------------------------------------------------
// `auto_negotiation` was fetched, typed and stored by the retired components and
// rendered nowhere; the tile carrying its name printed `speed_limit` — the saved
// setting — instead. So the surface reported configuration under a live fact's
// label while discarding the live fact (The State-Honesty Rule).
//
// Both are shown now, and the split is the information: the VALUE is what the
// PHY is doing, and the CAPTION is what it was told to do. On a healthy device
// they agree; when they disagree — a forced limit that the PHY did not take —
// that disagreement is exactly what a technician opened the page to see.
//
// -----------------------------------------------------------------------------
// COLOUR
// -----------------------------------------------------------------------------
// Every body is `TILE.BODY` and there is no `tone` prop to make an exception.
// One disc changes at runtime — the link tile's — because the link is the only
// thing here with a functional state. The negotiated rate is deliberately
// NEUTRAL: a rate is not a direction, not a radio and not a signal quality, so
// no hue in the system is honest for it, and minting one is the failure mode the
// whole colour system exists to prevent (The Neutral-Default Rule). Its retired
// `downlink-container` cited "Downlink Rose's second meaning", which DESIGN.md
// deleted on 2026-08-16.
//
// The three link states never share a glyph. `success-container` and
// `warning-container` measure 1.03:1 apart and are identical under deuteranopia,
// so the glyph is the channel that actually carries the state.
// =============================================================================

const K = "ethernet";

/**
 * The saved limit's own label, for the negotiation tile's caption.
 *
 * A record of LITERAL key strings rather than an interpolated `option_${limit}`:
 * a half-assembled key is not something any tool can resolve statically, and
 * this surface's translation coverage is checked by reading call sites.
 *
 * The keys live under `settings` because that is where the dropdown that writes
 * them lives, and the caption should read back the exact words the control
 * offered.
 */
const LIMIT_LABEL_KEY: Record<string, string> = {
  "10": `${K}.settings.option_10`,
  "100": `${K}.settings.option_100`,
  "1000": `${K}.settings.option_1000`,
  "2500": `${K}.settings.option_2500`,
};

/**
 * One tile. There is deliberately no body-tone prop: every body on this strip is
 * neutral, so a caller cannot tint one back. Making the wrong thing unreachable
 * is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph: Glyph,
  disc = DISC_NEUTRAL,
  animate = false,
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill pair — the only colour a tile is allowed to carry. */
  disc?: string;
  /**
   * True only for the link tile, whose disc genuinely changes at runtime. A
   * transition on a disc that never moves is a declaration that never fires.
   */
  animate?: boolean;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, animate && DISC_TRANSITION, disc)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{children}</span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/**
 * The band's third state: one tile spanning the grid.
 *
 * Four identical "couldn't read" tiles would be one message repeated four times,
 * and the bespoke centred error card this replaces was a second vocabulary for
 * the same event. The band keeps the family box and goes neutral rather than
 * shimmering — a skeleton is a promise that data is on its way.
 */
function NoticeTile({
  glyph: Glyph,
  title,
  body,
}: {
  glyph: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_NEUTRAL)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={CAPTION}>{body}</span>
      </div>
    </div>
  );
}

/**
 * `"2500Mb/s"` -> `"2.5 Gbps"`. Returns the em-dash placeholder rather than a
 * translated "N/A" when there is no reading — the tile's caption already says
 * why, and an abbreviation reads as a value where a dash reads as an absence.
 */
function formatSpeed(speed: string): string {
  if (!speed || speed === "Unknown") return VALUE_NONE;
  const match = speed.match(/^(\d+)Mb\/s$/);
  if (match) {
    const mbps = parseInt(match[1], 10);
    if (mbps >= 1000) return `${mbps / 1000} Gbps`;
    return `${mbps} Mbps`;
  }
  return speed;
}

function formatDuplex(duplex: string): string {
  if (!duplex || duplex === "Unknown") return VALUE_NONE;
  return duplex.charAt(0).toUpperCase() + duplex.slice(1);
}

export interface LinkStateStripProps {
  /** The GET's payload. `null` while the first read has not landed. */
  status: EthernetStatus | null;
  /** True until the first read resolves, either way. */
  isLoading: boolean;
  /**
   * True when the most recent poll failed. Load-bearing: the shell used to
   * swallow every error once it had data, so a dead 10s poll and a healthy one
   * rendered identically, forever.
   */
  pollFailed: boolean;
}

export function LinkStateStrip({
  status,
  isLoading,
  pollFailed,
}: LinkStateStripProps) {
  const { t } = useTranslation("common");

  // A missing `interface_present` means TRUE. An older backend does not send the
  // field at all, and reading absence as "no NIC" would blank a working page on
  // every un-updated device.
  const present = status?.interface_present !== false;
  const ready = status !== null;
  // A read that FAILED and left nothing behind. Distinct from "still loading":
  // the skeleton is a promise, and this is where the promise is broken.
  const failed = !ready && !isLoading && pollFailed;

  const isConnected = status?.link_status === "up";

  // The link tile's tone and glyph follow the link, never aesthetics. Unknown is
  // reachable in principle (the field is a string on the wire) even though
  // `ethernet.sh` currently collapses everything that is not "up" to "down", and
  // it takes the neutral disc rather than claiming either verdict.
  const linkSpec = isConnected
    ? {
        disc: DISC_UP,
        glyph: CheckCircle2Icon,
        value: t(`${K}.tiles.link.value_up`),
        caption: t(`${K}.tiles.link.caption_up`),
      }
    : status?.link_status === "down"
      ? {
          disc: DISC_DOWN,
          glyph: UnplugIcon,
          value: t(`${K}.tiles.link.value_down`),
          caption: t(`${K}.tiles.link.caption_down`),
        }
      : {
          disc: DISC_NEUTRAL,
          glyph: HelpCircleIcon,
          value: t(`${K}.tiles.link.value_unknown`),
          caption: t(`${K}.tiles.link.caption_unknown`),
        };

  const rate = isConnected ? formatSpeed(status?.speed ?? "") : VALUE_NONE;
  const duplex = isConnected ? formatDuplex(status?.duplex ?? "") : VALUE_NONE;

  // The ceiling answers the question the page could not answer before: am I
  // getting the port's full speed, or is something capping me? `supports_2500`
  // was already fetched and only decided whether one dropdown option existed.
  const rateCaption = !isConnected
    ? t(`${K}.tiles.speed.caption_down`)
    : status?.supports_2500
      ? t(`${K}.tiles.speed.caption_ceiling`, {
          ceiling: t(`${K}.settings.option_2500`),
        })
      : t(`${K}.tiles.speed.caption`);

  // The VALUE is the PHY's live state; the CAPTION is the saved limit.
  const autoNeg = status?.auto_negotiation;
  const negotiationValue =
    autoNeg === "on"
      ? t(`${K}.tiles.negotiation.value_auto`)
      : autoNeg === "off"
        ? t(`${K}.tiles.negotiation.value_forced`)
        : t(`${K}.tiles.negotiation.value_unknown`);

  // An unrecognised limit falls through to "no limit set" with `auto`. The CGI
  // validates the file against the same five values on read, so the only way to
  // reach the fallback is a backend that has stopped honouring its own contract.
  const limitKey = status ? LIMIT_LABEL_KEY[status.speed_limit] : undefined;
  const negotiationCaption = limitKey
    ? t(`${K}.tiles.negotiation.caption_limited`, { speed: t(limitKey) })
    : t(`${K}.tiles.negotiation.caption_auto`);

  return (
    <section
      aria-label={t(`${K}.strip.label`)}
      className="flex flex-col gap-2"
    >
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
        {ready && present && pollFailed ? (
          <Badge variant="warning">
            <TriangleAlertIcon className={BAND.GLYPH} aria-hidden="true" />
            {t(`${K}.strip.unresponsive`)}
          </Badge>
        ) : null}
      </div>

      <div className={TILE.GRID}>
        {ready && !present ? (
          // A DESIGNED outcome, not a fault — which is why the copy states the
          // hardware fact rather than apologising for a failure.
          <NoticeTile
            glyph={EthernetPortIcon}
            title={t(`${K}.strip.absent_title`)}
            body={t(`${K}.strip.absent_body`)}
          />
        ) : ready ? (
          // Only the rate ticks. Duplex and negotiation are CATEGORIES and the
          // link state is a category too — dipping a value that holds steady for
          // hours invents an event that did not happen.
          <TickGroup>
            <Tile
              glyph={linkSpec.glyph}
              disc={linkSpec.disc}
              animate
              eyebrow={t(`${K}.tiles.link.label`)}
              caption={linkSpec.caption}
            >
              <span className={VALUE_TEXT}>{linkSpec.value}</span>
            </Tile>

            <Tile
              glyph={GaugeIcon}
              eyebrow={t(`${K}.tiles.speed.label`)}
              caption={rateCaption}
            >
              <TickingValue value={rate} className={VALUE_TEXT}>
                {rate}
              </TickingValue>
            </Tile>

            <Tile
              glyph={ArrowLeftRightIcon}
              eyebrow={t(`${K}.tiles.duplex.label`)}
              caption={t(
                isConnected
                  ? `${K}.tiles.duplex.caption`
                  : `${K}.tiles.duplex.caption_down`,
              )}
            >
              <span className={VALUE_TEXT}>{duplex}</span>
            </Tile>

            <Tile
              glyph={SlidersHorizontalIcon}
              eyebrow={t(`${K}.tiles.negotiation.label`)}
              caption={negotiationCaption}
            >
              <span className={VALUE_TEXT}>{negotiationValue}</span>
            </Tile>
          </TickGroup>
        ) : failed ? (
          <NoticeTile
            glyph={CircleAlertIcon}
            title={t(`${K}.strip.unavailable_title`)}
            body={t(`${K}.strip.unavailable_body`)}
          />
        ) : (
          // Four skeletons in the SAME grid, mirroring the pin BY IMPORT rather
          // than by number — a restated height is how a 26px jump at the handoff
          // shipped last time (The Skeleton-Mirror Rule).
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        )}
      </div>
    </section>
  );
}

export default LinkStateStrip;

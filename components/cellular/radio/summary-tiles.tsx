"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { cn } from "@/lib/utils";
import type { RadioMode, RadioSummary } from "@/lib/radio-info";

// =============================================================================
// Summary tiles — four figures, four tonal tiles
// =============================================================================
// 2026-08-16. This surface has now been through three compositions and is back
// on the first one, deliberately and with different paint. The history matters
// because each generation fixed something real, and the version that ships has
// to keep those fixes rather than rewind past them.
//
//   Gen 1  four tiles, all four tinted, the NETWORK tile on the STRONG FILL
//          (`bg-primary` / `bg-lte`). Two of the four wore an identity hue over
//          a figure that spans both radios.
//   Gen 2  one 2/5 tonal anchor + a 3/5 neutral box. Measured on the live
//          device at 1914px the anchor was 623x212 = 132,033px^2 carrying
//          9,526px^2 of ink — 7.2%. A large empty purple slab.
//   Gen 3  a 1/5 identity rail + a 4/5 box of grouped rows. Correct by the
//          canon and quieter (44,441px^2, -66%), but it traded the at-a-glance
//          four-figure read for a list, and the four-tile grid is what the
//          product actually wants here.
//
// Gen 4 is Gen 1's LAYOUT with Gen 2/3's diagnosis applied to the paint.
//
// WHAT ACTUALLY MADE GEN 1 LOUD — and it was not the tile count. It was that
// the network tile used the STRONG FILL across a whole 92px tile. M3 spends
// strong fills on compact emphasis (FABs, chips, selected states) and gives
// large surfaces CONTAINERS; dark mode made the inversion shout, because
// `--lte` was oklch(0.8 ...) on an oklch(0.155) ground. So every tile BODY is
// now a container and the strong fill survives only on the 52px disc, which is
// the one element small enough to want it. In dark mode that is a ~0.47
// lightness drop on the loudest block — far more "toned down" than any token
// nudge could deliver, and the tokens were quieted as well
// (`app/globals.css` > Dark identity fills).
//
// COLOUR DISCIPLINE — a tile is tinted only if the hue encodes something TRUE.
//
//   Network type  IDENTITY. `primary-container` when an NR leg is registered,
//                 `lte-container` when it is LTE-only. The hue IS the fact,
//                 and it is the only tile allowed a radio hue.
//   Bandwidth     DOWNLINK ROSE. `totalMhz` sums across both legs, so no radio
//                 hue can be honest here — but rose does not mean a radio. It
//                 means throughput and capacity, and aggregate channel width
//                 is exactly the pipe. See The Direction-Is-Not-A-Radio Rule.
//   Carriers      UPLINK CYAN, which already owns counts system-wide
//                 (DESIGN.md > Tertiary). A count is what this tile reports.
//   Active MIMO   SPATIAL AZURE. Its value literally reads `LTE 1x2 | NR 2x4`,
//                 naming both radios in its own string, so no identity hue is
//                 honest — and layers are neither a direction nor a capacity,
//                 so neither of those axes fits either. It shipped neutral for
//                 exactly one revision on that reasoning. The resolution was
//                 not to bend one of the other three axes onto it but to give
//                 the thing it actually reports — antennas and spatial streams
//                 — an axis of its own, which the per-antenna surfaces share.
//
// Under the Functional-Color Promise a user who learned violet = LTE on the
// dashboard CA strip must not meet a violet block that means something else.
// Gen 1 broke that twice (bandwidth in NR blue while summing NR+LTE, MIMO in
// LTE violet while reporting both); that is the defect this generation keeps
// fixed while getting the grid back.
//
// FOUR TILES, FOUR AXES, and that is the whole system on one surface: radio
// identity, capacity, count, spatial. None of the four borrows a hue from
// another's axis, which is the property that was missing when this strip last
// had four colours — back then bandwidth wore NR blue while summing NR+LTE and
// MIMO wore LTE violet while reporting both legs.
//
// The honest constraint worth recording: there was no free hue. Every gap in
// the circle is inside 40 degrees of something, so Spatial Azure is a
// deliberate, measured amendment to that rule rather than a slot that happened
// to be open — see the token comment in `app/globals.css`.
//
// WHAT COLOUR CAN AND CANNOT DO HERE, measured rather than assumed. Simulating
// deuteranopia and protanopia across this system's container tones in DARK
// mode, nearly every pair collapses below the 0.05 separation floor — including
// pairs that already ship (success/warning, warning/destructive, uplink vs a
// plain surface-container). Light mode is clean. So on a dark tile the body
// tint is decoration and the GLYPH plus the LABEL are the information. That is
// why all four tiles carry distinct glyphs, and why the disc — a strong fill,
// where the same simulation shows every pair separating cleanly — is where the
// remaining colour is spent.
//
// Ink pairing: a tile is either a FILL pair (`bg-primary` + `text-primary-
// foreground`) or a CONTAINER pair, never crossed. The glyph disc always
// INVERTS its tile's pairing, so the icon pops instead of dissolving into a
// same-tone circle, and it survives grayscale either way.
//
// Geometry lives in `components/cellular/tile-shape.ts` — shared with Antenna
// Statistics' context tiles and the SMS Center strip, so the skeleton in
// `states.tsx` is a real mirror rather than an estimate (Skeleton-Mirror Rule).
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";
const CAPTION = "text-xs text-on-surface-variant";

// Each disc inverts to its tile's FILL pair so the glyph lifts off its own
// container. `bg-*-container` bodies, `bg-*` discs — never the reverse.
const BANDWIDTH_TILE = "bg-downlink-container text-on-downlink-container";
const BANDWIDTH_DISC = "bg-downlink text-downlink-foreground";
const CARRIERS_TILE = "bg-uplink-container text-on-uplink-container";
const CARRIERS_DISC = "bg-uplink text-uplink-foreground";
const MIMO_TILE = "bg-spatial-container text-on-spatial-container";
const MIMO_DISC = "bg-spatial text-spatial-foreground";

function Tile({
  glyph,
  label,
  children,
  caption,
  tone = NEUTRAL_TILE,
  disc = NEUTRAL_DISC,
  captionClassName = CAPTION,
}: {
  glyph: MaterialSymbolName;
  label: string;
  children: React.ReactNode;
  caption: React.ReactNode;
  tone?: string;
  disc?: string;
  captionClassName?: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, tone)}>
      <span className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span
          className={cn(
            "text-xs font-semibold",
            // On a tonal container the label is tinted from the container's
            // own ink, never toward gray — `on-surface-variant` belongs to the
            // neutral ramp and would be a cross-pair here.
            tone === NEUTRAL_TILE ? "text-on-surface-variant" : "opacity-85",
          )}
        >
          {label}
        </span>
        {children}
        <span className={cn("truncate", captionClassName)}>{caption}</span>
      </div>
    </div>
  );
}

// Headline step (600 / text-xl). The mock's 19px belongs to the pre-auth card
// scale, which DESIGN.md scopes to `/` and `/login/` and nowhere else.
const VALUE = "text-xl font-semibold leading-[1.1]";
const TABULAR_VALUE = cn(VALUE, "tabular-nums");

// -----------------------------------------------------------------------------
// Network type — the one identity tile
// -----------------------------------------------------------------------------
// The mock hardcodes "5G NR + LTE" with a `5g` glyph. LTE-only, SA and unknown
// are all states this modem really reports, so the tile branches on RadioMode.
//
// `5g` is not in MATERIAL_SYMBOL_NAMES, and per DESIGN.md the "5G"/"4G+" marks
// are TYPOGRAPHIC, not icons — they ship as text. So the disc carries
// `cell_tower` (the radio itself) and the mark is a Badge in the matching
// identity variant.
//
// The tile body is the CONTAINER and the Badge is the container's own ink
// inverted, which is what stops the mark from being a third statement of the
// same fact at the same volume.

type NetworkTileSpec = {
  tone: string;
  disc: string;
  markVariant: "nr" | "lte" | "muted";
  markKey: string;
  valueKey: string;
  captionKey: string;
};

// The tile's VALUE reads from the shared `radio_info.network_type.*` keys, the
// same ones the Cellular information card's "Network type" row uses. Both render
// simultaneously, two inches apart, so a second key set for one fact is a visible
// contradiction waiting to happen — an earlier draft had this tile saying "5G
// standalone" while the row said "5G NR SA". The CAPTIONS stay tile-local: they
// are elaboration the row has no space for, not a restatement of the same fact.
const NETWORK_TILE: Record<RadioMode, NetworkTileSpec> = (() => {
  const nsa: NetworkTileSpec = {
    tone: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    markVariant: "nr",
    markKey: "radio_info.tiles.network.mark_5g",
    valueKey: "radio_info.network_type.nsa",
    captionKey: "radio_info.tiles.network.caption_nsa",
  };
  const sa: NetworkTileSpec = {
    ...nsa,
    valueKey: "radio_info.network_type.sa",
    captionKey: "radio_info.tiles.network.caption_sa",
  };
  const lte: NetworkTileSpec = {
    tone: "bg-lte-container text-on-lte-container",
    disc: "bg-lte text-lte-foreground",
    markVariant: "lte",
    markKey: "radio_info.tiles.network.mark_4g",
    valueKey: "radio_info.network_type.lte",
    captionKey: "radio_info.tiles.network.caption_lte",
  };
  // Non-registered modes never reach the tiles (the shell swaps in a state
  // screen instead), but the map is total so an unhandled mode can only ever
  // degrade to the honest neutral tile — never to a confident "5G NR + LTE".
  const unknown: NetworkTileSpec = {
    tone: NEUTRAL_TILE,
    disc: NEUTRAL_DISC,
    markVariant: "muted",
    markKey: "radio_info.common.not_available",
    valueKey: "radio_info.network_type.unknown",
    captionKey: "radio_info.tiles.network.caption_unknown",
  };
  return {
    loading: unknown,
    "no-sim": unknown,
    "no-service": unknown,
    searching: unknown,
    unknown,
    "registered-lte": lte,
    "registered-nsa": nsa,
    "registered-sa": sa,
  };
})();

export interface SummaryTilesProps {
  mode: RadioMode;
  summary: RadioSummary;
  /** `device.mimo` verbatim — a compound string such as `LTE 1x2 | NR 2x4`. */
  mimo: string | null;
}

export function SummaryTiles({ mode, summary, mimo }: SummaryTilesProps) {
  const { t } = useTranslation("cellular");

  const net = NETWORK_TILE[mode] ?? NETWORK_TILE.unknown;
  const isIdentityTile = net.tone !== NEUTRAL_TILE;

  // Bandwidth: `totalMhz` is legitimately null when the modem reports no usable
  // QCAINFO line. A null total renders as a word, never as 0 MHz.
  const hasBandwidth = summary.totalMhz !== null && summary.totalMhz > 0;
  const breakdown = summary.breakdownMhz.filter((n) => n > 0);

  // `device.mimo` can be "-", "" or a two-part compound. Split on the pipe so a
  // two-part value wraps into two lines instead of overflowing the tile.
  const rawMimo = (mimo ?? "").trim();
  const mimoParts =
    rawMimo && rawMimo !== "-"
      ? rawMimo.split("|").map((part) => part.trim()).filter(Boolean)
      : [];

  /* A WORD, not a bare em dash. `not_available` (—) rendered at a tile's value
     size reads as a rendering failure rather than as a fact the modem declined
     to report, and unlike MetricCell's dash it is not aria-hidden, so a screen
     reader announced "em dash". `cellular-information-card.tsx` argues the
     same case. Sized one step BELOW a real reading: an absent value should not
     out-weigh the figures beside it just because the sentence is longer. */
  const unavailable = (
    <span className="text-sm font-semibold opacity-85">
      {t("radio_info.common.value_unavailable")}
    </span>
  );

  return (
    <div className={TILE_SHAPE.GRID}>
      <Tile
        glyph="cell_tower"
        label={t("radio_info.tiles.network.label")}
        tone={net.tone}
        disc={net.disc}
        caption={t(net.captionKey)}
        captionClassName={isIdentityTile ? "text-xs opacity-85" : CAPTION}
      >
        <span className="flex items-baseline gap-2">
          <Badge
            variant={net.markVariant}
            className={cn(VALUE, "px-2.5 py-0.5")}
          >
            {t(net.markKey)}
          </Badge>
          <span className={cn(VALUE, "truncate")}>{t(net.valueKey)}</span>
        </span>
      </Tile>

      <Tile
        glyph="graphic_eq"
        label={t("radio_info.tiles.bandwidth.label")}
        tone={BANDWIDTH_TILE}
        disc={BANDWIDTH_DISC}
        caption={
          // A breakdown of ONE is not a breakdown: on a single-carrier link
          // "15 MHz" under "15 MHz" restates the value it sits beside and reads
          // as a rendering fault. The unit label carries it instead.
          hasBandwidth
            ? breakdown.length > 1
              ? // Was `breakdown.join(" + ")` → "20 + 20 + 100", unitless and
                // unattributed, which reads as an arithmetic expression rather
                // than a per-carrier breakdown.
                t("radio_info.tiles.bandwidth.caption_breakdown", {
                  parts: breakdown.join(" + "),
                })
              : t("radio_info.tiles.bandwidth.caption_single")
            : t("radio_info.tiles.bandwidth.caption_unavailable")
        }
        captionClassName={cn(
          "text-xs opacity-85",
          hasBandwidth && breakdown.length > 1 && "tabular-nums",
        )}
      >
        {hasBandwidth ? (
          <span className="flex items-baseline gap-1">
            <span className={TABULAR_VALUE}>{summary.totalMhz}</span>
            <span className="text-sm font-semibold">
              {t("radio_info.tiles.bandwidth.unit")}
            </span>
          </span>
        ) : (
          unavailable
        )}
      </Tile>

      <Tile
        glyph="layers"
        label={t("radio_info.tiles.carriers.label")}
        tone={CARRIERS_TILE}
        disc={CARRIERS_DISC}
        captionClassName="text-xs opacity-85"
        caption={
          summary.carrierCount > 0
            ? t("radio_info.tiles.carriers.caption", {
                lte: summary.lteCount,
                nr: summary.nrCount,
              })
            : t("radio_info.tiles.carriers.caption_none")
        }
      >
        <span className={cn(VALUE, "tabular-nums")}>
          {/* Counts come from grouping the components array (summariseRadio),
              never from network.ca_count / nr_ca_count — those under-report:
              the live device shows nr_ca_count 0 while carrying a real NR
              carrier. */}
          {t("radio_info.tiles.carriers.value", { count: summary.carrierCount })}
        </span>
      </Tile>

      {/* `alt_route`, not `settings_input_antenna`. The aerial glyph is already
          worn by BOTH surfaces this tile links out to
          (`antenna-statistics/context-tiles.tsx` and
          `antenna-alignment/states.tsx`), so the tile was wearing its own
          destination's mark — and it drew a rabbit-ear TV aerial for a 4x4
          spatial-multiplexing readout. `alt_route` draws one path splitting
          into parallel legs, which is what MIMO physically is. */}
      <Tile
        glyph="alt_route"
        label={t("radio_info.tiles.mimo.label")}
        tone={MIMO_TILE}
        disc={MIMO_DISC}
        captionClassName="text-xs opacity-85"
        caption={
          mimoParts.length > 0 ? (
            <Link
              href="/cellular/antenna-statistics"
              // Hover lifts the link toward the container's FULL ink rather
              // than toward `on-surface`, which belongs to the neutral ramp and
              // is a cross-pair on a tinted tile (Container-Pair Rule).
              className={cn(
                "font-semibold underline underline-offset-2 opacity-100",
                "transition-opacity duration-(--duration-quick) ease-out hover:opacity-80",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              )}
            >
              {t("radio_info.tiles.mimo.caption_link")}
            </Link>
          ) : (
            t("radio_info.tiles.mimo.caption_unavailable")
          )
        }
      >
        {mimoParts.length > 0 ? (
          // Two legs stack rather than truncate: `LTE 1x4 | NR 2x4` is two
          // facts, and dropping the second one silently is worse than a taller
          // tile. UL x DL layer counts, not antenna-array notation.
          <span className="flex flex-col leading-[1.15]">
            {mimoParts.map((part) => (
              <span
                key={part}
                className={cn(
                  "truncate font-mono font-semibold tabular-nums",
                  // Two legs drop two ramp steps so the stacked pair fits the
                  // 34px value budget inside the 104px tile TILE_SHAPE pins and
                  // the skeleton mirrors. At `text-base` the pair measured 40px
                  // and pushed the whole ROW to 118 — the grid stretches every
                  // sibling to the tallest, so one overflowing tile silently
                  // resizes the other three.
                  mimoParts.length > 1 ? "text-sm" : "text-xl",
                )}
              >
                {part}
              </span>
            ))}
          </span>
        ) : (
          unavailable
        )}
      </Tile>
    </div>
  );
}

export default SummaryTiles;

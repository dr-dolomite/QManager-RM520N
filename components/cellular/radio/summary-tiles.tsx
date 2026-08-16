"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Tag, type TagVariant } from "@/components/ui/tag";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { cn } from "@/lib/utils";
import type { RadioMode, RadioSummary } from "@/lib/radio-info";

// =============================================================================
// Summary tiles — four figures, four neutral tiles, four coloured discs
// =============================================================================
// This surface has now been through five compositions. The history matters
// because each generation fixed something real, and the version that ships has
// to keep those fixes rather than rewind past them.
//
//   Gen 1  four tiles, all four tinted, the NETWORK tile on the STRONG FILL
//          (`bg-primary` / `bg-lte`). Two of the four wore an identity hue over
//          a figure that spans both radios.
//   Gen 2  one 2/5 tonal anchor + a 3/5 neutral box. Measured on the live
//          device at 1914px the anchor was 623x212 = 132,033px^2 carrying
//          9,526px^2 of ink — 7.2%. A large empty purple slab.
//   Gen 3  a 1/5 identity rail + a 4/5 box of grouped rows. Quieter (44,441
//          px^2, -66%), but it traded the at-a-glance four-figure read for a
//          list, and the four-tile grid is what the product actually wants.
//   Gen 4  Gen 1's LAYOUT with the strong fills demoted to the disc: four
//          `*-container` bodies, four `*` discs.
//
// GEN 5 REMOVES THE BODY TINT ENTIRELY. Every tile body is now `NEUTRAL_TILE`
// and the disc is the only coloured element on the strip.
//
// Gen 4's diagnosis was right about the strong fill and wrong about what was
// left. Four pale bodies at near-identical container lightness encode CATEGORY
// without encoding IMPORTANCE, so the strip flattened to equal weight and the
// eye had nowhere to land — four things shouting politely at the same volume.
// A neutral body with a saturated disc gives each tile a focal point at ~1/8th
// the tinted area, and gives the strip a reading order again. This is The
// Data-Ink Rule at tile scale: colour belongs to the reading, not to the
// container holding it (DESIGN.md > Components > Tiles).
//
// It also settles an argument the tint kept losing. Gen 4's own comment had to
// justify each body hue as "encoding something TRUE", and one of the four never
// really did: Carriers wore UPLINK CYAN on the reasoning that cyan "owns counts
// system-wide". A count is not a direction. That gave cyan a second meaning and
// made the whole direction axis untrue — a carrier-count tile in upload cyan,
// two clicks from a latency card where the same cyan meant upload beside an
// up-arrow. Carriers is now NEUTRAL, per The Neutral-Default Rule: a figure
// with no honest hue stays neutral.
//
// WHAT EACH DISC ENCODES — and a disc is coloured only where the hue is true.
//
//   Network type  IDENTITY FILL. `bg-primary` when an NR leg is registered,
//                 `bg-lte` when it is LTE-only. The only radio hue on the
//                 strip. The Glyph-Disc Rule puts identity on the STRONG fill
//                 rather than the pale container precisely here: in light mode
//                 the identity containers collapse under simulation and the
//                 fills do not.
//   Bandwidth     DOWNLINK ROSE. `totalMhz` sums across both legs, so no radio
//                 hue is honest — but rose means direction, not radio, and
//                 aggregate channel width is the pipe. Direction-Is-Not-A-Radio.
//   Carriers      NEUTRAL. A count is not a direction and not a state.
//   Active MIMO   SPATIAL AZURE. Its value literally reads `LTE 1x2 | NR 2x4`,
//                 naming both radios in its own string, so no identity hue is
//                 honest — and layers are neither a direction nor a state, so
//                 spatial is its own axis, shared with the per-antenna surfaces.
//
// IDENTITY IS NOW TWO CHANNELS, NEITHER OF THEM A BLOCK. The network tile
// carries its radio in the disc's fill and in an OUTLINE TAG on the mark
// ("5G" / "4G"), which is the Two-Form Rule's identity half. It was a filled
// `Badge variant="nr"` — a pale `primary-container` block that was byte-
// identical to `variant="info"`, so the 5G mark and an informational chip were
// literally the same object.
//
// WHAT COLOUR CAN AND CANNOT DO HERE, measured rather than assumed. Simulating
// deuteranopia and protanopia across this system's CONTAINER tones in dark mode,
// nearly every pair collapses below the 0.05 separation floor — including pairs
// that already ship. The same simulation shows every STRONG-FILL pair separating
// cleanly. That asymmetry is the whole argument for spending the strip's colour
// on 52px discs instead of 104px bodies, and it is why all four tiles still
// carry distinct glyphs: the glyph and the label are the information, and the
// disc's hue is the reinforcement.
//
// Geometry lives in `components/cellular/tile-shape.ts` — shared with Antenna
// Statistics' context tiles and the SMS Center strip, so the skeleton in
// `states.tsx` is a real mirror rather than an estimate (Skeleton-Mirror Rule).
// =============================================================================

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";
const CAPTION = "text-xs text-on-surface-variant";

// Disc fills. Each is a FILL pair (`bg-X` + `text-X-foreground`), never a
// container pair — the disc is the one element on this strip small enough to
// want a strong fill, and the pair is never crossed.
const BANDWIDTH_DISC = "bg-downlink text-downlink-foreground";
const MIMO_DISC = "bg-spatial text-spatial-foreground";

function Tile({
  glyph,
  label,
  children,
  caption,
  disc = NEUTRAL_DISC,
  captionClassName,
}: {
  glyph: MaterialSymbolName;
  label: string;
  children: React.ReactNode;
  caption: React.ReactNode;
  /**
   * The disc's fill pair. There is deliberately no `tone` prop: the body is
   * neutral on every tile, so a caller cannot tint one back. Making the wrong
   * thing unreachable is cheaper than a comment asking nobody to do it.
   */
  disc?: string;
  /**
   * Extra caption classes. Type only — the caption's COLOUR is fixed at
   * `on-surface-variant` by `CAPTION` and is not a caller's decision. The one
   * live use is `tabular-nums` on the bandwidth breakdown.
   */
  captionClassName?: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <span className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-xs font-semibold text-on-surface-variant">
          {label}
        </span>
        {children}
        <span className={cn("truncate", CAPTION, captionClassName)}>
          {caption}
        </span>
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
// `cell_tower` (the radio itself) and the mark is an outline `Tag` in the
// matching identity variant.
//
// Two identity channels, neither of them a block: the disc's strong FILL and
// the tag's OUTLINE, on a neutral body. The mark was a filled `Badge`, whose
// pale `primary-container` fill was byte-identical to `variant="info"` — so the
// 5G mark and an informational chip rendered as the same object.

type NetworkTileSpec = {
  disc: string;
  markVariant: TagVariant;
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
    disc: NEUTRAL_DISC,
    markVariant: "neutral",
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
    <span className="text-sm font-semibold text-on-surface-variant">
      {t("radio_info.common.value_unavailable")}
    </span>
  );

  return (
    <div className={TILE_SHAPE.GRID}>
      <Tile
        glyph="cell_tower"
        label={t("radio_info.tiles.network.label")}
        disc={net.disc}
        caption={t(net.captionKey)}
      >
        <span className="flex items-baseline gap-2">
          <Tag variant={net.markVariant} className={cn(VALUE, "px-2.5 py-0.5")}>
            {t(net.markKey)}
          </Tag>
          <span className={cn(VALUE, "truncate")}>{t(net.valueKey)}</span>
        </span>
      </Tile>

      <Tile
        glyph="graphic_eq"
        label={t("radio_info.tiles.bandwidth.label")}
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
        /* No `disc` — Carriers is the one tile with no honest hue. It reports a
           COUNT, which is neither a direction, a radio, nor a state. It wore
           uplink cyan on the reasoning that cyan "owns counts"; that gave the
           direction axis a second meaning and is the exact defect The
           Direction-Is-Not-A-Radio Rule names. Neutral-Default Rule. */
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
        disc={MIMO_DISC}
        caption={
          mimoParts.length > 0 ? (
            <Link
              href="/cellular/antenna-statistics"
              // The tile body is neutral now, so the link takes the brand INK
              // on that neutral ground rather than an opacity step off a
              // container's ink. Primary is the only hue in the system that
              // acts, and this is the strip's one action — so the colour is
              // honest here in a way it would not be on a static caption.
              // Hover deepens the ink; opacity is not doing the work anymore.
              className={cn(
                "font-semibold text-primary-on-surface underline underline-offset-2",
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

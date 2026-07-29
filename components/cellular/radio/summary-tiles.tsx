"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import type { RadioMode, RadioSummary } from "@/lib/radio-info";

// =============================================================================
// Summary tiles — the four figures above the two cards
// =============================================================================
// Mock reference: `reimagine/Cellular and Radio Information.dc.html` lines
// 53-87. Anatomy is kept (52px circular glyph disc → eyebrow → large value →
// caption); every VALUE in the mock is a fabrication and is re-derived here.
//
// COLOUR DISCIPLINE (DESIGN.md > Identity-Chip Rule).
// The mock paints all four tiles: primary, primary-container, uplink-container
// and — for Active MIMO — `--sc`, which ships here as `lte-container`. That
// last one asserts "this is the 4G LTE leg" about a figure that is not about
// LTE at all (live value is a compound `LTE 1x2 | NR 2x4`), and the same
// objection applies more weakly to painting Bandwidth and Carrier aggregation
// in brand hues they do not own.
//
// So exactly ONE tile carries colour, and it is the only one whose subject IS
// a radio: Network type, filled in the identity role of the radio actually
// registered (NR blue / LTE violet). The other three are neutral
// `surface-container`. This also buys the page a real focal point instead of
// four competing saturated blocks, which is what makes a degraded state
// legible rather than festive.
//
// Ink pairing: a tile is either a FILL pair (`bg-primary` + `text-primary-
// foreground`) or a CONTAINER pair, never crossed. The glyph disc inside a
// filled tile is a full container pair of the same role, so it survives
// grayscale instead of relying on a white-alpha scrim like the mock's.
// =============================================================================

/**
 * Shared geometry. `states.tsx` imports these so the skeleton is a pure
 * crossfade into the real tiles with no layout jump (Skeleton-Mirror Rule).
 */
export const TILE_SHAPE = {
  /** Grid wrapper. Container queries, not the mock's fixed 4-up at 1320px. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  /**
   * One tile. The text column, not the 52px disc, sets the height: eyebrow
   * (16) + 3 + value (22) + 3 + caption (16) = 60, plus py-4 either side = 92.
   * The floor is pinned so a tile whose caption happens to be short still
   * matches, and so HEIGHT below is a real mirror rather than an estimate.
   */
  ROOT: "flex min-h-[5.75rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's resolved height, for the skeleton. */
  HEIGHT: "h-[5.75rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
} as const;

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";
const CAPTION = "text-xs text-on-surface-variant";

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
const MONO_VALUE = cn(VALUE, "font-mono tabular-nums");

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
    tone: "bg-primary text-primary-foreground",
    disc: "bg-primary-container text-on-primary-container",
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
    tone: "bg-lte text-lte-foreground",
    disc: "bg-lte-container text-on-lte-container",
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
  // QCAINFO line. A null total renders as an em dash, never as 0 MHz.
  const hasBandwidth = summary.totalMhz !== null && summary.totalMhz > 0;
  const breakdown = summary.breakdownMhz.filter((n) => n > 0);

  // `device.mimo` can be "-", "" or a two-part compound. Split on the pipe so a
  // two-part value wraps into two lines instead of overflowing the tile.
  const rawMimo = (mimo ?? "").trim();
  const mimoParts =
    rawMimo && rawMimo !== "-"
      ? rawMimo.split("|").map((part) => part.trim()).filter(Boolean)
      : [];

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
          <Badge variant={net.markVariant} className="font-semibold">
            {t(net.markKey)}
          </Badge>
          <span className={cn(VALUE, "truncate")}>{t(net.valueKey)}</span>
        </span>
      </Tile>

      <Tile
        glyph="graphic_eq"
        label={t("radio_info.tiles.bandwidth.label")}
        caption={
          hasBandwidth && breakdown.length > 0
            ? breakdown.join(" + ")
            : t("radio_info.tiles.bandwidth.caption_unavailable")
        }
        captionClassName={cn(
          CAPTION,
          hasBandwidth && breakdown.length > 0 && "font-mono tabular-nums",
        )}
      >
        {hasBandwidth ? (
          <span className="flex items-baseline gap-1">
            <span className={MONO_VALUE}>{summary.totalMhz}</span>
            <span className="text-sm font-semibold">
              {t("radio_info.tiles.bandwidth.unit")}
            </span>
          </span>
        ) : (
          <span className={MONO_VALUE}>{t("radio_info.common.not_available")}</span>
        )}
      </Tile>

      <Tile
        glyph="layers"
        label={t("radio_info.tiles.carriers.label")}
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

      <Tile
        glyph="settings_input_antenna"
        label={t("radio_info.tiles.mimo.label")}
        caption={
          mimoParts.length > 0 ? (
            <Link
              href="/cellular/antenna-statistics"
              className="font-semibold underline underline-offset-2 hover:text-on-surface"
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
                  // Two legs drop one ramp step (Headline -> Title) so the pair
                  // still fits the 84px tile the skeleton mirrors.
                  mimoParts.length > 1 ? "text-base" : "text-xl",
                )}
              >
                {part}
              </span>
            ))}
          </span>
        ) : (
          <span className={MONO_VALUE}>{t("radio_info.common.not_available")}</span>
        )}
      </Tile>
    </div>
  );
}

export default SummaryTiles;

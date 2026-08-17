"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import { cn } from "@/lib/utils";
import {
  ANTENNA_PORTS,
  hasAntennaData,
  isPortReporting,
  type SignalPerAntenna,
} from "@/types/modem-status";

// =============================================================================
// Context strip — three figures, three neutral tiles, coloured discs
// =============================================================================
// Users arrive here from the Radio Information MIMO tile, whose link text is
// literally "Per-antenna detail" — so the first thing this page owes them is the
// bridge between that tile and these four chains: how many layers the modem says
// it is running, which radios are up, and how many chains are actually
// reporting. Geometry is imported from `components/cellular/tile-shape` rather
// than restated, so this strip stays dimensionally identical to every other tile
// strip in the `/cellular/` family.
//
// THE BODIES ARE NEUTRAL AND THE DISC IS THE ONLY COLOURED ELEMENT. This strip
// used to ship Gen-4 tinting — a `spatial-container` MIMO body and an
// `uplink-container` chain-count body — while `radio/summary-tiles.tsx`, which
// shares this exact geometry and sits one click upstream, had already moved to
// neutral bodies. Two dimensionally-identical strips were arguing about the
// system's central rule in front of the same user.
//
// The rule they were arguing about is The Data-Ink Rule: colour belongs to the
// reading, not to the container holding it. Measured, the case is one-sided —
// across this palette, container tones collapse under deuteranopia and
// protanopia simulation in nearly every pair, and every strong-FILL pair
// separates cleanly. So a 104px pale body spends its area encoding a category
// nobody can reliably read, while a 52px saturated disc encodes the same
// category legibly and gives the tile a focal point at ~1/8th the tinted area
// (DESIGN.md > Components > Tiles, and The Data-Ink Rule).
//
// The count tile's old `uplink-container` was the worse half. A count is not a
// direction — that is The Direction-Is-Not-A-Radio Rule named in as many words —
// and the sibling strip deleted the same cyan from its Carriers tile for exactly
// this reason. Chains reporting is now neutral, per The Neutral-Default Rule.
//
// WHAT EACH DISC ENCODES:
//
//   Active MIMO   SPATIAL AZURE. The value reads `LTE 1x2 | NR 2x4`, naming both
//                 radios in its own string, so no identity hue is honest — and
//                 layers are neither a direction nor a state.
//   Serving mode  IDENTITY FILL, on the STRONG fill rather than the pale
//                 container (The Glyph-Disc Rule): `bg-primary` while an NR leg
//                 is up, `bg-lte` when the link is LTE-only, neutral when there
//                 is no service to name.
//   Chains        NEUTRAL. A count is not a direction and not a state.
//
// GLYPHS MEAN THE SAME THING HERE AS ON THE SIBLING STRIP. `alt_route` (one path
// splitting into parallel legs — what MIMO physically is) and `cell_tower` are
// the marks `radio/summary-tiles.tsx` uses for the same two figures. The aerial
// stays on this page, where it is honest, but on the CHAINS tile: `layers` used
// to sit there while meaning "carriers" one click away, which is one glyph
// carrying two counts.
// =============================================================================

/**
 * Three tiles, not four — so the grid is local while ROOT/DISC/HEIGHT stay
 * imported. Borrowing `TILE_SHAPE.GRID` would step to `grid-cols-4` at `@5xl`
 * and leave a fourth column of dead air at exactly the width the page is most
 * likely to be read at. `states.tsx` imports this constant for the skeleton.
 */
export const CONTEXT_GRID = "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-3";

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";

// Disc fills. Each is a FILL pair (`bg-X` + `text-X-foreground`), never a
// container pair — the disc is the one element on this strip small enough to
// want a strong fill, and the pair is never crossed.
const MIMO_DISC = "bg-spatial text-spatial-foreground";
const NR_DISC = "bg-primary text-primary-foreground";
const LTE_DISC = "bg-lte text-lte-foreground";

const EYEBROW = "text-xs font-semibold text-on-surface-variant";
const CAPTION = "text-xs text-on-surface-variant";
/** Headline step (600 / text-xl), matching the sibling strip's tile value. */
const VALUE = "text-xl font-semibold leading-[1.1]";

function Tile({
  glyph,
  disc = NEUTRAL_DISC,
  eyebrow,
  children,
  caption,
}: {
  glyph: MaterialSymbolName;
  /**
   * The disc's fill pair. There is deliberately no `tone` prop: the body is
   * neutral on every tile, so a caller cannot tint one back. Making the wrong
   * thing unreachable is cheaper than a comment asking nobody to do it — the
   * same decision `radio/summary-tiles.tsx` made when it dropped its own.
   */
  disc?: string;
  eyebrow: string;
  children: React.ReactNode;
  caption: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, NEUTRAL_TILE)}>
      <span className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className={EYEBROW}>{eyebrow}</span>
        {children}
        <span className={cn(CAPTION, "truncate")}>{caption}</span>
      </div>
    </div>
  );
}

export function ContextTiles({
  signal,
  mimo,
}: {
  signal: SignalPerAntenna | undefined;
  mimo: string | null;
}) {
  const { t } = useTranslation("cellular");

  const lte = hasAntennaData(signal, "lte");
  const nr = hasAntennaData(signal, "nr");
  const mode = lte && nr ? "endc" : nr ? "nr" : lte ? "lte" : ("none" as const);

  // Identity on the disc, and only where it is true: any NR leg is the brand
  // blue, an LTE-only link is Carrier Violet, and "no service" gets no radio
  // hue at all rather than a confident one.
  const modeDisc =
    mode === "endc" || mode === "nr"
      ? NR_DISC
      : mode === "lte"
        ? LTE_DISC
        : NEUTRAL_DISC;

  // A chain counts as live if it reports on EITHER radio: in EN-DC a chain can
  // be carrying LTE while reporting nothing for NR, and it is still in use.
  const live = ANTENNA_PORTS.filter(
    (_, i) =>
      isPortReporting(signal, i, "lte") || isPortReporting(signal, i, "nr")
  ).length;

  // `device.mimo` can be "-", "" or a two-part compound like "LTE 1x4 | NR 2x4".
  // Split on the pipe so a two-part value STACKS rather than truncating: it is
  // two facts, and this is the one page whose entire subject is those chains —
  // silently dropping the second leg here would be the worst possible place
  // for it. Same normalisation the Radio Information tile uses.
  const rawMimo = (mimo ?? "").trim();
  const mimoParts =
    rawMimo && rawMimo !== "-"
      ? rawMimo
          .split("|")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

  /* A WORD, not a figure-sized one. An absent value should not out-weigh the
     readings beside it just because its sentence is longer, so it sits one step
     below a real figure on the neutral ink — the same treatment
     `radio/summary-tiles.tsx` gives its own unavailable values. */
  const unavailable = (
    <span className="truncate text-sm font-semibold text-on-surface-variant">
      {t("antenna_statistics.context.mimo.unavailable")}
    </span>
  );

  return (
    <div className={CONTEXT_GRID}>
      <Tile
        glyph="alt_route"
        disc={MIMO_DISC}
        eyebrow={t("antenna_statistics.context.mimo.label")}
        caption={t("antenna_statistics.context.mimo.caption")}
      >
        {mimoParts.length > 0 ? (
          <span className="flex flex-col leading-[1.15]">
            {mimoParts.map((part) => (
              <span
                key={part}
                className={cn(
                  "truncate font-mono font-semibold tabular-nums",
                  // Two legs drop two ramp steps so the stacked pair fits the
                  // 34px value budget inside the 104px `TILE_SHAPE.ROOT` pins
                  // and the skeleton mirrors. This was `text-base`, which
                  // measured ~40px stacked and pushed the tile past a height
                  // that is a PIN, not a floor — and because the grid stretches
                  // every sibling to the tallest, one overflowing tile silently
                  // resized the other two. `radio/summary-tiles.tsx` carries the
                  // same value at the same step for the same reason.
                  mimoParts.length > 1 ? "text-sm" : "text-xl"
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
      <Tile
        glyph="cell_tower"
        disc={modeDisc}
        eyebrow={t("antenna_statistics.context.mode.label")}
        caption={t("antenna_statistics.context.mode.caption")}
      >
        <span className={cn(VALUE, "truncate")}>
          {t(`antenna_statistics.context.mode.${mode}`)}
        </span>
      </Tile>
      <Tile
        /* The aerial belongs to this page, and this is the tile it describes:
           physical receive chains. It was `layers`, which means "carriers" on
           the strip one click upstream. */
        glyph="settings_input_antenna"
        /* No `disc` — chains reporting is a COUNT, which is neither a
           direction, a radio, nor a state. The Neutral-Default Rule. */
        eyebrow={t("antenna_statistics.context.chains.label")}
        caption={t("antenna_statistics.context.chains.caption")}
      >
        <span className={cn(VALUE, "truncate tabular-nums")}>
          {t("antenna_statistics.context.chains.value", {
            live,
            total: ANTENNA_PORTS.length,
          })}
        </span>
      </Tile>
    </div>
  );
}

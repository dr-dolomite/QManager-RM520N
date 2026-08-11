"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { TILE_SHAPE } from "@/components/cellular/radio/summary-tiles";
import { cn } from "@/lib/utils";
import {
  ANTENNA_PORTS,
  hasAntennaData,
  isPortReporting,
  type SignalPerAntenna,
} from "@/types/modem-status";

// =============================================================================
// Context strip
//
// Users arrive here from the Radio Information MIMO tile, whose link text is
// literally "Per-antenna detail" — so the first thing this page owes them is the
// bridge between that tile and these four chains: how many layers the modem says
// it is running, which radios are up, and how many chains are actually
// reporting. Geometry is imported from `radio/summary-tiles` rather than
// restated, so the strip is dimensionally identical to the one they just left.
// =============================================================================

/**
 * Three tiles, not four — so the grid is local while ROOT/DISC/HEIGHT stay
 * imported. Borrowing `TILE_SHAPE.GRID` would step to `grid-cols-4` at `@5xl`
 * and leave a fourth column of dead air at exactly the width the page is most
 * likely to be read at. `states.tsx` imports this constant for the skeleton.
 */
export const CONTEXT_GRID =
  "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-3";

/** Tone pairs. A tile is a fill pair or a container pair, never crossed, and the
 *  glyph disc always inverts its tile's pairing so the icon cannot dissolve into
 *  a same-tone circle (DESIGN.md > Tiles). */
const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";
/** Matches the Radio Information MIMO tile exactly — same concept, same hue. */
const MIMO_TILE = "bg-lte-container text-on-lte-container";
const MIMO_DISC = "bg-lte text-lte-foreground";
/** Uplink Cyan owns counts (DESIGN.md > Tertiary). */
const COUNT_TILE = "bg-uplink-container text-on-uplink-container";
const COUNT_DISC = "bg-uplink text-uplink-foreground";

const EYEBROW = "text-xs font-semibold";
const VALUE = "text-xl font-semibold leading-[1.1]";
const TABULAR_VALUE = cn(VALUE, "tabular-nums");
const CAPTION = "text-xs";

function Tile({
  glyph,
  tone,
  disc,
  eyebrow,
  children,
  caption,
}: {
  glyph: "settings_input_antenna" | "cell_tower" | "layers";
  tone: string;
  disc: string;
  eyebrow: string;
  children: React.ReactNode;
  caption: string;
}) {
  const neutral = tone === NEUTRAL_TILE;
  return (
    <div className={cn(TILE_SHAPE.ROOT, tone)}>
      <span className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span
          className={cn(
            EYEBROW,
            neutral ? "text-on-surface-variant" : "opacity-85"
          )}
        >
          {eyebrow}
        </span>
        {children}
        <span
          className={cn(
            CAPTION,
            neutral ? "text-on-surface-variant" : "opacity-85",
            "truncate"
          )}
        >
          {caption}
        </span>
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
  const mode =
    lte && nr ? "endc" : nr ? "nr" : lte ? "lte" : ("none" as const);

  // A chain counts as live if it reports on EITHER radio: in EN-DC a chain can
  // be carrying LTE while reporting nothing for NR, and it is still in use.
  const live = ANTENNA_PORTS.filter(
    (_, i) => isPortReporting(signal, i, "lte") || isPortReporting(signal, i, "nr")
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

  return (
    <div className={CONTEXT_GRID}>
      <Tile
        glyph="settings_input_antenna"
        tone={MIMO_TILE}
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
                  // Two legs drop one ramp step to limit how far the tile
                  // outgrows its single-leg height. It does NOT eliminate the
                  // growth: 2 x (16px x 1.15) replaces one 22px line, so an
                  // EN-DC tile resolves to ~107px against `TILE_SHAPE.ROOT`'s
                  // 92px floor, and the skeleton's pinned `h-[5.75rem]` is 15px
                  // short at the handoff. That is a systemic gap inherited from
                  // `radio/summary-tiles.tsx`, which shares this geometry and
                  // makes the same claim about fitting; fixing it belongs in
                  // TILE_SHAPE for both strips at once, not here, because a
                  // local-only fix would desynchronise the two.
                  mimoParts.length > 1 ? "text-base" : "text-xl"
                )}
              >
                {part}
              </span>
            ))}
          </span>
        ) : (
          <span className={cn(TABULAR_VALUE, "truncate")}>
            {t("antenna_statistics.context.mimo.unavailable")}
          </span>
        )}
      </Tile>
      <Tile
        glyph="cell_tower"
        tone={NEUTRAL_TILE}
        disc={NEUTRAL_DISC}
        eyebrow={t("antenna_statistics.context.mode.label")}
        caption={t("antenna_statistics.context.mode.caption")}
      >
        <span className={cn(VALUE, "truncate")}>
          {t(`antenna_statistics.context.mode.${mode}`)}
        </span>
      </Tile>
      <Tile
        glyph="layers"
        tone={COUNT_TILE}
        disc={COUNT_DISC}
        eyebrow={t("antenna_statistics.context.chains.label")}
        caption={t("antenna_statistics.context.chains.caption")}
      >
        <span className={cn(TABULAR_VALUE, "truncate")}>
          {t("antenna_statistics.context.chains.value", {
            live,
            total: ANTENNA_PORTS.length,
          })}
        </span>
      </Tile>
    </div>
  );
}

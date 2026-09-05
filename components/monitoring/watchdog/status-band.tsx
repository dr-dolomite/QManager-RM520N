"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { BandTile } from "./derive";
import {
  DISC_LIVE,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  SKELETON,
  TILE,
  TILE_CAPTION,
  TILE_CAPTION_NUM,
  TILE_VALUE,
  TILE_VALUE_TONE,
} from "./shapes";

/** A reading the device did not report. Never a zero, which is a claim. */
const ABSENT = "—";

function StatusTile({ tile }: { tile: BandTile }) {
  const { t } = useTranslation("common");
  const Glyph = tile.glyph;
  const missing = tile.value === null;

  return (
    <div className={TILE.ROOT}>
      <span
        aria-hidden
        className={cn(
          TILE.DISC,
          DISC_TRANSITION,
          DISC_TONE[tile.disc],
          tile.live && DISC_LIVE,
        )}
      >
        <Glyph className={TILE.GLYPH} />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{t(tile.eyebrowKey)}</span>
        {/* Colour goes on the disc and the numeral, never on the tile body. */}
        <span className={cn(TILE_VALUE, TILE_VALUE_TONE[tile.valueTone])}>
          {missing ? (
            <>
              <span aria-hidden>{ABSENT}</span>
              <span className="sr-only">{t("watchdog.band.absent")}</span>
            </>
          ) : (
            tile.value
          )}
        </span>
        <span className={tile.captionNumeric ? TILE_CAPTION_NUM : TILE_CAPTION}>
          {t(tile.captionKey, tile.captionParams)}
        </span>
      </div>
    </div>
  );
}

export function StatusBand({ tiles }: { tiles: BandTile[] }) {
  return (
    <div className={TILE.GRID}>
      {tiles.map((tile) => (
        <StatusTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}

/** Mirrors the band's pinned tile height from the same constant. */
export function StatusBandSkeleton() {
  return (
    <div className={TILE.GRID} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={SKELETON.TILE} />
      ))}
    </div>
  );
}

"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  DISC_ALERT,
  DISC_NEUTRAL,
  DISC_TRANSITION,
  EYEBROW,
  TILE,
  TILE_CAPTION,
  TILE_VALUE,
  TILE_VALUE_ALERT,
} from "./shapes";

export interface StatusTileProps {
  icon: LucideIcon;
  eyebrow: string;
  value: string;
  caption: string;
  /** Only the Ongoing tile raises this, and only above zero. */
  alert?: boolean;
}

function StatusTile({
  icon: Icon,
  eyebrow,
  value,
  caption,
  alert = false,
}: StatusTileProps) {
  return (
    <div className={TILE.ROOT}>
      <span
        aria-hidden
        className={cn(
          TILE.DISC,
          DISC_TRANSITION,
          alert ? DISC_ALERT : DISC_NEUTRAL,
        )}
      >
        <Icon className={TILE.GLYPH} />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        {/* Colour goes on the numeral, never on the tile fill. A zero is neutral. */}
        <span className={cn(TILE_VALUE, alert && TILE_VALUE_ALERT)}>
          {value}
        </span>
        <span className={TILE_CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

export function StatusBand({ tiles }: { tiles: StatusTileProps[] }) {
  return (
    <div className={TILE.GRID}>
      {tiles.map((tile) => (
        <StatusTile key={tile.eyebrow} {...tile} />
      ))}
    </div>
  );
}

/** Mirrors the band's pinned tile height from the same constant. */
export function StatusBandSkeleton() {
  return (
    <div className={TILE.GRID} aria-hidden>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={cn(TILE.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

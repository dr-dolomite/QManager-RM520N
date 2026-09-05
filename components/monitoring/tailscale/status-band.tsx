"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleHelpIcon,
  LogInIcon,
  MinusCircleIcon,
  PackageIcon,
  PowerOffIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { cn } from "@/lib/utils";

import {
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  SKELETON,
  STATUS_LABEL_KEY,
  STATUS_VARIANT,
  TILE,
  TILE_CAPTION,
  TILE_CAPTION_MONO,
  TILE_VALUE,
  TILE_VALUE_MONO,
  TILE_VALUE_TONE,
  type DiscTone,
  type TailscaleView,
  type TileValueTone,
} from "./shapes";

export interface StatusTileProps {
  icon: LucideIcon;
  eyebrow: string;
  value: string;
  caption: React.ReactNode;
  discTone?: DiscTone;
  valueTone?: TileValueTone;
  /** True when the figure is an identifier the device emitted, not a reading. */
  mono?: boolean;
}

function StatusTile({
  icon: Icon,
  eyebrow,
  value,
  caption,
  discTone = "neutral",
  valueTone = "neutral",
  mono = false,
}: StatusTileProps) {
  return (
    <div className={TILE.ROOT}>
      <span
        aria-hidden
        className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[discTone])}
      >
        <Icon className={TILE.GLYPH} />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        {/* Colour goes on the figure and the disc, never on the tile body. */}
        <span
          title={value}
          className={cn(
            mono ? TILE_VALUE_MONO : TILE_VALUE,
            TILE_VALUE_TONE[valueTone],
          )}
        >
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
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={SKELETON.TILE} />
      ))}
    </div>
  );
}

/** A short machine-voice fact under a figure — a hostname, a MagicDNS suffix. */
export function TileMono({ children }: { children: React.ReactNode }) {
  return <span className={TILE_CAPTION_MONO}>{children}</span>;
}

/** Distinct glyph per state: three of the six land on the same `muted` fill. */
export const STATUS_GLYPH = {
  running: CheckCircle2Icon,
  needsLogin: LogInIcon,
  disconnected: MinusCircleIcon,
  serviceStopped: PowerOffIcon,
  notInstalled: PackageIcon,
  unknown: CircleHelpIcon,
} satisfies Record<TailscaleView, LucideIcon>;

export function ConnectionChip({ view }: { view: TailscaleView }) {
  const { t } = useTranslation("common");
  const variant = STATUS_VARIANT[view];
  const Glyph = STATUS_GLYPH[view];

  return (
    <Badge variant={variant} role="status">
      {/* The accessible name stays OUTSIDE the swap so it is not remounted. */}
      <span className="sr-only">{t("tailscale.status.aria")}</span>
      <SwapLabel swapKey={`${variant}-${view}`} className="gap-1">
        <Glyph className="size-3" />
        {t(STATUS_LABEL_KEY[view])}
      </SwapLabel>
    </Badge>
  );
}

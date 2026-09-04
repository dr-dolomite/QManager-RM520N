"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { cn } from "@/lib/utils";
import type { ConnectivityState } from "@/types/modem-status";

import {
  DISC_ALERT,
  DISC_NEUTRAL,
  DISC_TRANSITION,
  EYEBROW,
  STATUS_LABEL_KEY,
  STATUS_VARIANT,
  TILE,
  TILE_CAPTION,
  TILE_META,
  TILE_META_MONO,
  TILE_VALUE,
  TILE_VALUE_ALERT,
} from "./shapes";

export interface StatusTileProps {
  icon: LucideIcon;
  eyebrow: string;
  value: string;
  caption: React.ReactNode;
  /** Binary, not a ramp: an alert moves the disc and the numeral together. */
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
        {/* Colour goes on the numeral and the disc, never on the tile body. */}
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
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={cn(TILE.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

/**
 * Two short facts side by side. The No-Dot-Separator Rule forbids a glue
 * character between them, so the spacing does the separating instead.
 */
export function TileMeta({ parts, mono }: { parts: string[]; mono?: boolean }) {
  return (
    <span className={TILE_META}>
      {parts.map((part, i) => (
        <span key={i} className={mono ? TILE_META_MONO : "truncate"}>
          {part}
        </span>
      ))}
    </span>
  );
}

/** Distinct glyph per state: the two container fills are 1.03:1 apart. */
const STATUS_GLYPH: Record<ConnectivityState, LucideIcon> = {
  connected: CheckCircle2Icon,
  degraded: TriangleAlertIcon,
  disconnected: XCircleIcon,
  recovery: RefreshCwIcon,
  unknown: MinusCircleIcon,
};

export function ConnectionChip({ status }: { status: ConnectivityState | null }) {
  const { t } = useTranslation("dashboard");
  // No connectivity object at all reads the same as a probe that is not reporting.
  const state: ConnectivityState = status ?? "unknown";
  const variant = STATUS_VARIANT[state];
  const Glyph = STATUS_GLYPH[state];

  return (
    <Badge variant={variant}>
      {/* The accessible name stays OUTSIDE the swap so it is not remounted. */}
      <span className="sr-only">{t("latencyMonitor.status.aria")}</span>
      <SwapLabel swapKey={`${variant}-${state}`} className="gap-1">
        <Glyph className="size-3" />
        {t(STATUS_LABEL_KEY[state])}
      </SwapLabel>
    </Badge>
  );
}

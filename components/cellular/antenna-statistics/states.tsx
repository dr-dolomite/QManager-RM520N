"use client";

import { useTranslation } from "react-i18next";
import { Card, CardHeader } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { TILE_SHAPE } from "@/components/cellular/radio/summary-tiles";
import { cn } from "@/lib/utils";
import { ANTENNA_PORTS } from "@/types/modem-status";
import { CONTEXT_GRID } from "./context-tiles";
import {
  CARD_GRID,
  CARD_SHELL,
  HEADER_SHAPE,
  PORT_BLOCK_HEIGHT,
  PORT_SHAPE,
} from "./tech-card";

// =============================================================================
// Loading
//
// Mirrors the loaded geometry by importing the same constants the real view
// uses — the same tile block, the same card shell, the same 140px port block —
// rather than by restating numbers, so the two cannot drift (DESIGN.md > The
// Skeleton-Mirror Rule). The page header above is real text and is never
// skeletonised: the page's identity is known before its readings are.
// =============================================================================

export function AntennaStatsSkeleton({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-5">
      {label && <span className="sr-only">{label}</span>}

      <div className={CONTEXT_GRID}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn(TILE_SHAPE.HEIGHT, "rounded-tile")} />
        ))}
      </div>

      <div className={CARD_GRID}>
        {[0, 1].map((card) => (
          <Card key={card} className={CARD_SHELL}>
            {/* The real `CardHeader`, not a hand-rolled `div`: it ships
                `grid-rows-[auto_auto]`, and that second (empty) track still
                emits its row gutter. Reproducing the header as a plain flex
                column silently dropped those 4px and left the skeleton short. */}
            <CardHeader className="gap-1 px-0">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col",
                    HEADER_SHAPE.GAP
                  )}
                >
                  <Skeleton
                    className={cn(HEADER_SHAPE.TITLE, "rounded-inline")}
                  />
                  <Skeleton
                    className={cn(HEADER_SHAPE.DESCRIPTION, "rounded-inline")}
                  />
                </div>
                <Skeleton
                  className={cn("shrink-0 rounded-pill", HEADER_SHAPE.CHIP)}
                />
              </div>
            </CardHeader>
            <div className={PORT_SHAPE.STACK}>
              {ANTENNA_PORTS.map((port) => (
                <Skeleton
                  key={port.rx}
                  className="rounded-tile"
                  style={{ height: PORT_BLOCK_HEIGHT }}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Unreachable
//
// This replaces the body rather than rendering it empty. The outgoing page fell
// through to two "No LTE/NR5G Signal" empty states whenever the very first
// fetch failed, which asserts that the radio is silent when the truth is that
// the modem could not be reached — an actively misleading instrument on the
// exact screen someone opens to diagnose a chain. Tone is `destructive` because
// the link to the device is genuinely down, not merely degraded.
// =============================================================================

export function AntennaStatsUnreachable({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation("cellular");

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3.5 rounded-hero bg-destructive-container px-7 py-14 text-center text-on-destructive-container"
    >
      <span className="grid size-14 flex-none place-items-center rounded-pill bg-destructive text-destructive-foreground">
        <MaterialSymbol name="error" filled size={30} />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="text-xl font-semibold tracking-[-0.01em]">
          {t("antenna_statistics.states.unreachable.title")}
        </p>
        <p className="max-w-[46ch] text-sm leading-relaxed opacity-90">
          {t("antenna_statistics.states.unreachable.description")}
        </p>
      </div>
      {onRetry && (
        // Scrim drawn from the container's OWN ink: a white wash is invisible
        // on the light container and only works in dark mode.
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center gap-2 rounded-pill bg-on-destructive-container/10 px-5 text-sm font-semibold transition-colors duration-(--duration-quick) ease-out hover:bg-on-destructive-container/15 focus-visible:ring-2 focus-visible:ring-on-destructive-container focus-visible:outline-none"
        >
          <MaterialSymbol name="refresh" size={17} />
          {t("antenna_statistics.states.retry")}
        </button>
      )}
    </div>
  );
}

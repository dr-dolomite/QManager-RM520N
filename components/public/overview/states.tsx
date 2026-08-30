"use client";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { BAND_ROW_SHAPE, ROW_GAP, ROW_STACK_GAP } from "./band-rows";
import { TILE_HEIGHT } from "./tone";

// =============================================================================
// Reading chip
// =============================================================================
// Replaces the theme toggle while the first read is in flight, at the same 36px
// height so the header does not reflow when it swaps back. The spinner is the
// ONLY loop permitted on this surface.

export function ReadingChip({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="bg-primary-container text-on-primary-container inline-flex h-9 items-center gap-2.5 rounded-pill px-3.5 text-xs font-semibold"
    >
      <span
        aria-hidden
        className="size-[0.8125rem] rounded-pill border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
      {label}
    </span>
  );
}

// =============================================================================
// Skeleton
// =============================================================================
// Mirrors the loaded geometry EXACTLY so the handoff is a pure crossfade with
// zero layout shift (Motion Guide recipe 03). The header title, the CTA and the
// footer caption are real text and are never skeletonised — the card's identity
// is known before the reading is, and pretending otherwise is a lie about what
// we are waiting for.

const SKELETON_BAND_ROWS = [0, 1, 2, 3];

export function SkeletonBody({ loadingLabel }: { loadingLabel?: string } = {}) {
  return (
    <>
      {loadingLabel && <span className="sr-only">{loadingLabel}</span>}

      {/* Status PAIR — Internet + Temperature, and first, mirroring the loaded
          card's status → evidence → identity reading order. There is no third
          tile: the Overall verdict was retired, and a skeleton that still
          reserved three slots would shift the layout at handoff. */}
      <div className="grid grid-cols-1 gap-2 @[22rem]/overview:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className={cn(TILE_HEIGHT, "rounded-tile")} />
        ))}
      </div>

      {/* Signal section — eyebrow + toggle, then band rows. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 w-[9.875rem] rounded-[0.375rem]" />
          <Skeleton className="h-7 w-[5.875rem] rounded-pill" />
        </div>
        <div className={cn("flex flex-col", ROW_STACK_GAP)}>
          {SKELETON_BAND_ROWS.map((i) => (
            <div key={i} className={cn("flex items-center", ROW_GAP)}>
              <Skeleton
                className={cn(
                  "h-[1.4375rem] flex-none rounded-pill",
                  BAND_ROW_SHAPE.CHIP_W,
                )}
              />
              <Skeleton
                className={cn(
                  "min-w-0 flex-1 rounded-pill",
                  BAND_ROW_SHAPE.METER_H,
                )}
              />
              <Skeleton
                className={cn(
                  "h-[0.9375rem] flex-none rounded-[0.5rem]",
                  BAND_ROW_SHAPE.VALUE_W,
                )}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Identity trio — Carrier · Network · Bandwidth, last. Same TILE_HEIGHT
          as the status pair above: one height for both families is what lets the
          two grids read as one, and importing it is what keeps the skeleton
          honest when it changes (Skeleton-Mirror Rule). */}
      <div className="grid grid-cols-1 gap-2 @[22rem]/overview:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn(TILE_HEIGHT, "rounded-tile")} />
        ))}
      </div>
    </>
  );
}

// =============================================================================
// Modem unreachable
// =============================================================================
// Warning, not destructive: an unreachable poller is degraded and recoverable.
// The status is gone; the login is NOT — and the footer caption says exactly
// that. It is the difference between a dead end and a detour.

export function UnreachableState({
  title,
  subtitle,
  retryLabel,
  onRetry,
}: {
  title: string;
  subtitle: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-warning-container text-on-warning-container flex flex-col items-center gap-3.5 rounded-card px-7 py-8 text-center">
      <span className="bg-warning text-warning-foreground grid size-14 flex-none place-items-center rounded-pill">
        <MaterialSymbol name="wifi_tethering_off" filled size={30} />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
          {title}
        </p>
        <p className="max-w-[34ch] text-[0.8125rem] leading-relaxed opacity-90">
          {subtitle}
        </p>
      </div>
      {onRetry && retryLabel && (
        // Scrim from the container's OWN ink rather than a white wash: white at
        // 14% is invisible on the light amber container and only works in dark.
        <button
          type="button"
          onClick={onRetry}
          className="bg-on-warning-container/10 hover:bg-on-warning-container/15 focus-visible:ring-on-warning-container inline-flex h-10 items-center gap-2 rounded-pill px-5 text-[0.8125rem] font-semibold transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-2 focus-visible:outline-none"
        >
          <MaterialSymbol name="refresh" size={17} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { RadioMode } from "@/lib/radio-info";

import { TILE_SHAPE } from "./summary-tiles";

// =============================================================================
// Radio state screens
// =============================================================================
// The approved mock depicts exactly ONE state across 313 lines: registered,
// NSA, every field populated. It has no failure state at all.
//
// That gap matters more here than on a calmer page. The redesign is louder and
// more saturated than the plain table it replaces, so a degraded state rendered
// through the loaded layout reads *worse* than the old page did: a solid
// primary tile reading "5G NR + LTE" beside forty em dashes, while there is no
// SIM in the device, is an actively misleading instrument — on the exact page a
// technician opens to diagnose that. So the non-registered modes replace the
// body outright instead of rendering it empty.
//
// Shape follows `components/public/overview/states.tsx` (`UnreachableState`),
// which is the shipped precedent for this pattern and exists because this same
// bug class was already caught once on the splash surface.
//
// Tone is chosen per condition, not per aesthetics:
//   no-sim      warning      — a real fault, but the user can fix it in situ.
//   no-service  destructive  — the link is down and the modem cannot help.
//   searching   primary      — transient and hopeful; nothing is wrong yet.
//   unknown     neutral      — we do not know, and pretending otherwise (in
//                              either direction) would be the actual bug.
// Each carries a DIFFERENT glyph: no two states in one slot may share one,
// because success/warning/destructive containers sit ~1.03:1 apart and the
// glyph is the only channel that survives grayscale.
// =============================================================================

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------
// Mirrors the loaded tile geometry exactly — same grid, same 84px block, same
// 28px radius — by importing TILE_SHAPE rather than restating numbers, so the
// two can never drift apart. The header above it is real text and is never
// skeletonised: the page's identity is known before its readings are.

export function SummaryTilesSkeleton({ label }: { label?: string }) {
  return (
    <div className={TILE_SHAPE.GRID}>
      {label && <span className="sr-only">{label}</span>}
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className={cn(TILE_SHAPE.HEIGHT, "rounded-tile")}
        />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Condition screens
// -----------------------------------------------------------------------------

type ConditionMode = Exclude<RadioMode, "loading" | `registered-${string}`>;

type ConditionSpec = {
  container: string;
  disc: string;
  /** Retry scrim drawn from the container's OWN ink: a white wash is invisible
   *  on the light containers and only works in dark mode. */
  action: string;
  glyph: MaterialSymbolName;
  /** Only `searching` spins — the others are standing conditions, and a
   *  spinner on a standing condition advertises work that is not happening. */
  spin?: boolean;
  ariaRole: "alert" | "status";
};

const CONDITION: Record<ConditionMode, ConditionSpec> = {
  "no-sim": {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    action:
      "bg-on-warning-container/10 hover:bg-on-warning-container/15 focus-visible:ring-on-warning-container",
    glyph: "sim_card",
    ariaRole: "alert",
  },
  "no-service": {
    container: "bg-destructive-container text-on-destructive-container",
    disc: "bg-destructive text-destructive-foreground",
    action:
      "bg-on-destructive-container/10 hover:bg-on-destructive-container/15 focus-visible:ring-on-destructive-container",
    glyph: "signal_cellular_off",
    ariaRole: "alert",
  },
  searching: {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    action:
      "bg-on-primary-container/10 hover:bg-on-primary-container/15 focus-visible:ring-on-primary-container",
    glyph: "progress_activity",
    spin: true,
    ariaRole: "status",
  },
  unknown: {
    container: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    action:
      "bg-on-surface/5 hover:bg-on-surface/10 focus-visible:ring-on-surface",
    glyph: "help",
    ariaRole: "status",
  },
};

const CONDITION_KEY: Record<ConditionMode, string> = {
  "no-sim": "no_sim",
  "no-service": "no_service",
  searching: "searching",
  unknown: "unknown",
};

/** Narrows a RadioMode to one this component can draw. */
export function isConditionMode(mode: RadioMode): mode is ConditionMode {
  return mode === "no-sim" || mode === "no-service" || mode === "searching" || mode === "unknown";
}

export interface RadioConditionStateProps {
  mode: ConditionMode;
  onRetry?: () => void;
}

export function RadioConditionState({ mode, onRetry }: RadioConditionStateProps) {
  const { t } = useTranslation("cellular");
  const spec = CONDITION[mode];
  const key = CONDITION_KEY[mode];

  return (
    <div
      role={spec.ariaRole}
      className={cn(
        "flex flex-col items-center gap-3.5 rounded-hero px-7 py-14 text-center",
        spec.container,
      )}
    >
      <span className={cn("grid size-14 flex-none place-items-center rounded-pill", spec.disc)}>
        <MaterialSymbol
          name={spec.glyph}
          filled
          size={30}
          className={spec.spin ? "motion-safe:animate-spin" : undefined}
        />
      </span>
      <div className="flex flex-col gap-1.5">
        {/* Headline step (600 / text-xl) — DESIGN.md names it for exactly this:
            "large card titles and state labels". The overview splash's 17px is
            its own pre-auth scale and does not travel to `/cellular/`. */}
        <p className="text-xl font-semibold tracking-[-0.01em]">
          {t(`radio_info.states.${key}.title`)}
        </p>
        <p className="max-w-[46ch] text-sm leading-relaxed opacity-90">
          {t(`radio_info.states.${key}.description`)}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-pill px-5 text-sm font-semibold transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-2 focus-visible:outline-none",
            spec.action,
          )}
        >
          <MaterialSymbol name="refresh" size={17} />
          {t("radio_info.states.retry")}
        </button>
      )}
    </div>
  );
}

export default RadioConditionState;

"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import type { ConditionTone } from "@/components/cellular/condition-screen";
import { cn } from "@/lib/utils";
import type { RadioMode } from "@/lib/radio-info";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";

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
//
// The screen itself — shell, tone classes, retry affordance — lives in
// `components/cellular/condition-screen.tsx` so `/cellular/`'s other surfaces
// can draw the same thing. This file keeps only the RadioMode → tone/glyph
// mapping and the `radio_info.states.*` copy.
// =============================================================================

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------
// Mirrors the loaded tile geometry exactly — same grid, same 92px block, same
// 28px radius — by importing TILE_SHAPE from the shared
// `components/cellular/tile-shape.ts` rather than restating numbers, so the two
// can never drift apart. Four blocks, because four tiles are what the eye sees
// arrive. The header above is real text and is never skeletonised: the page's
// identity is known before its readings are.

export function SummaryTilesSkeleton({ label }: { label?: string }) {
  return (
    <div className={TILE_SHAPE.GRID}>
      {label && <span className="sr-only">{label}</span>}
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={cn(TILE_SHAPE.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Condition screens
// -----------------------------------------------------------------------------

type ConditionMode = Exclude<RadioMode, "loading" | `registered-${string}`>;

type ConditionSpec = {
  tone: ConditionTone;
  glyph: MaterialSymbolName;
  /** Only `searching` spins — the others are standing conditions, and a
   *  spinner on a standing condition advertises work that is not happening. */
  spin?: boolean;
  ariaRole: "alert" | "status";
};

const CONDITION: Record<ConditionMode, ConditionSpec> = {
  "no-sim": {
    tone: "warning",
    glyph: "sim_card",
    ariaRole: "alert",
  },
  "no-service": {
    tone: "destructive",
    glyph: "signal_cellular_off",
    ariaRole: "alert",
  },
  searching: {
    tone: "primary",
    glyph: "progress_activity",
    spin: true,
    ariaRole: "status",
  },
  unknown: {
    tone: "neutral",
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
    <ConditionScreen
      tone={spec.tone}
      glyph={spec.glyph}
      spin={spec.spin}
      ariaRole={spec.ariaRole}
      title={t(`radio_info.states.${key}.title`)}
      description={t(`radio_info.states.${key}.description`)}
      onRetry={onRetry}
      retryLabel={t("radio_info.states.retry")}
    />
  );
}

export default RadioConditionState;

"use client";

import * as React from "react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

// =============================================================================
// Condition screen
// =============================================================================
// One shape for "a condition replaced the page body". Used wherever a surface
// must NOT fall through to its loaded layout: the redesigned pages are louder
// and more saturated than the tables they replace, so a degraded state drawn
// through the loaded layout reads *worse* than the old page did — a solid
// primary tile reading "5G NR + LTE" beside forty em dashes, while there is no
// SIM in the device, is an actively misleading instrument on the exact page a
// technician opens to diagnose that. So the condition replaces the body
// outright instead of rendering it empty.
//
// Shape follows `components/public/overview/states.tsx` (`UnreachableState`),
// which is the shipped precedent for this pattern and exists because this same
// bug class was already caught once on the splash surface.
//
// This file owns the SHAPE and the TONE SPEC. Callers own the COPY — it
// carries no i18n namespace of its own, which is what lets `/cellular/`'s
// `radio_info.states.*` and `antenna_statistics.states.*` share one screen.
//
// Tone is chosen per condition, not per aesthetics. From the radio page, whose
// four modes are the canonical mapping:
//   no-sim      warning      — a real fault, but the user can fix it in situ.
//   no-service  destructive  — the link is down and the modem cannot help.
//   searching   primary      — transient and hopeful; nothing is wrong yet.
//   unknown     neutral      — we do not know, and pretending otherwise (in
//                              either direction) would be the actual bug.
// Each carries a DIFFERENT glyph: no two states in one slot may share one,
// because success/warning/destructive containers sit ~1.03:1 apart and the
// glyph is the only channel that survives grayscale.
// =============================================================================

export type ConditionTone = "warning" | "destructive" | "primary" | "neutral";

type ToneSpec = {
  container: string;
  disc: string;
  /** Retry scrim drawn from the container's OWN ink: a white wash is invisible
   *  on the light containers and only works in dark mode. */
  action: string;
};

const TONE: Record<ConditionTone, ToneSpec> = {
  warning: {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    action:
      "bg-on-warning-container/10 hover:bg-on-warning-container/15 focus-visible:ring-on-warning-container",
  },
  destructive: {
    container: "bg-destructive-container text-on-destructive-container",
    disc: "bg-destructive text-destructive-foreground",
    action:
      "bg-on-destructive-container/10 hover:bg-on-destructive-container/15 focus-visible:ring-on-destructive-container",
  },
  primary: {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    action:
      "bg-on-primary-container/10 hover:bg-on-primary-container/15 focus-visible:ring-on-primary-container",
  },
  neutral: {
    container: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    action:
      "bg-on-surface/5 hover:bg-on-surface/10 focus-visible:ring-on-surface",
  },
};

export interface ConditionScreenProps {
  tone: ConditionTone;
  glyph: MaterialSymbolName;
  /** Only true for a genuinely transient condition. A spinner on a standing
   *  condition advertises work that is not happening. */
  spin?: boolean;
  ariaRole: "alert" | "status";
  title: string;
  description: string;
  /** Omit to render no retry affordance. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ConditionScreen({
  tone,
  glyph,
  spin,
  ariaRole,
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ConditionScreenProps): React.JSX.Element {
  const spec = TONE[tone];

  return (
    <div
      role={ariaRole}
      className={cn(
        "flex flex-col items-center gap-3.5 rounded-hero px-7 py-14 text-center",
        spec.container,
        className,
      )}
    >
      <span className={cn("grid size-14 flex-none place-items-center rounded-pill", spec.disc)}>
        <MaterialSymbol
          name={glyph}
          filled
          size={30}
          className={spin ? "motion-safe:animate-spin" : undefined}
        />
      </span>
      <div className="flex flex-col gap-1.5">
        {/* Headline step (600 / text-xl) — DESIGN.md names it for exactly this:
            "large card titles and state labels". The overview splash's 17px is
            its own pre-auth scale and does not travel to `/cellular/`. */}
        <p className="text-xl font-semibold tracking-[-0.01em]">{title}</p>
        <p className="max-w-[46ch] text-sm leading-relaxed opacity-90">{description}</p>
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
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default ConditionScreen;

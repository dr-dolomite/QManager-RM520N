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

export type ConditionTone =
  | "success"
  | "warning"
  | "destructive"
  | "primary"
  | "neutral";

export type ToneSpec = {
  container: string;
  disc: string;
  /** Retry scrim drawn from the container's OWN ink: a white wash is invisible
   *  on the light containers and only works in dark mode. */
  action: string;
};

/**
 * The one container-tone table for `/cellular/`.
 *
 * EXPORTED because it was being re-forked. `sms/forwarding/delivery-health-card`
 * alone carried SEVEN verbatim copies of these strings — four in a `HEALTH_SPEC`
 * map plus three written inline — each keyed onto a class string rather than
 * onto `ConditionTone`. That is the shape DESIGN.md > Chips and tags bans
 * outright ("Tone maps key onto the exported types, never onto a class string")
 * and the same failure that let four rival quality maps drift until one of them
 * painted an unread antenna green.
 *
 * A consumer keys onto `ConditionTone` and reads `container` / `disc` here, so a
 * tone without a matching role is a BUILD failure rather than a silent one.
 * `action` is only meaningful where the block offers a retry affordance;
 * a plain tonal block uses `container` + `disc` and ignores it.
 */
export const CONDITION_TONE: Record<ConditionTone, ToneSpec> = {
  success: {
    container: "bg-success-container text-on-success-container",
    disc: "bg-success text-success-foreground",
    action:
      "bg-on-success-container/10 hover:bg-on-success-container/15 focus-visible:ring-on-success-container",
  },
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
  /**
   * Gates the retry affordance.
   *
   * Optional, and unset by default, so every existing call site is unchanged.
   * It exists because a condition screen's retry re-runs the very read that
   * failed, and on at least one surface that read is only safe in some windows:
   * band locking gates its header Refresh on the failover watcher, and this
   * button fires the same `current.sh`. A retry that routes around its page's
   * write guard is the guard not existing.
   *
   * The control keeps its shape and drops to the house disabled treatment
   * rather than merely going inert - an affordance that still looks pressable
   * but is not is its own defect.
   */
  disabled?: boolean;
  /** Why the retry is unavailable, surfaced on the control itself. Mirrors how
   *  a gated header button carries its reason. */
  disabledReason?: string;
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
  disabled,
  disabledReason,
  className,
}: ConditionScreenProps): React.JSX.Element {
  const spec = CONDITION_TONE[tone];
  // `aria-describedby` rather than `aria-description`: the latter is an ARIA
  // 1.3 draft attribute that the `button` role does not support, so it lints
  // and is not reliably announced. A visually-hidden node carries the reason.
  const reasonId = React.useId();
  const showReason = Boolean(disabled && disabledReason);

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
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          aria-describedby={showReason ? reasonId : undefined}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-pill px-5 text-sm font-semibold transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-2 focus-visible:outline-none",
            spec.action,
            // Same treatment `Button` ships for its disabled state, so a gated
            // retry reads as gated on every surface that uses this primitive.
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <MaterialSymbol name="refresh" size={17} />
          {retryLabel}
        </button>
      )}
      {showReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </div>
  );
}

export default ConditionScreen;

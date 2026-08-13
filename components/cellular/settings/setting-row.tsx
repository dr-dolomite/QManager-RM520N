"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { SETTING_ROW, SETTING_ROW_DIRTY } from "./shapes";

// =============================================================================
// SettingRow — one row inside the tonal group (the Pixel Settings pattern)
// =============================================================================
// The row is what turns this page from a form into a set of decisions. Three
// parts, and the middle one is the point:
//
//   label       what the setting is
//   consequence what happens to YOUR connection if you change it
//   control     the choice itself
//
// The consequence line is REQUIRED, not optional. The page this replaces was
// six bare labels over six dropdowns, so a radio kill switch and a roaming
// preference looked identical. A row with no consequence has not been finished.
//
// -----------------------------------------------------------------------------
// PROMOTION, AND THE INK THAT COMES WITH IT
// -----------------------------------------------------------------------------
// A row holding an unsaved edit promotes to `primary-container`. Promotion is
// the brand ACTING — a pending edit is an action awaiting commit — and never a
// functional role, because a dirty row is not "good" or "degraded".
//
// The whole row's ink flips to `on-primary-container`, so the consequence line
// must drop `text-on-surface-variant`. Leaving it would put one role's ink on
// another role's container, which is the most common way this pattern fails and
// is invisible in light mode while unreadable in dark. `CONSEQUENCE_ON_FILL`
// exists for exactly that swap.
//
// -----------------------------------------------------------------------------
// WHY THE HEIGHT IS RESERVED RATHER THAN ANIMATED
// -----------------------------------------------------------------------------
// The delta chip ("SIM 2 -> SIM 1") appears INSIDE the row when it goes dirty,
// which changes the row's intrinsic height. Animating that is a container-size
// change — `emphasized` at best, and impossible to express without an implicit
// `transition-all`. So the row carries a `min-h` floor that already accounts
// for the chip's line, and the chip fades in against reserved space. Same
// reasoning as `SaveButton`'s width lock: reserve, don't animate.
//
// The fill itself IS animated — a `standard` colour transition, which is legal
// and is what makes the promotion feel like a state change rather than a
// repaint.
// =============================================================================

export interface SettingRowProps {
  label: string;
  /** One line naming what changing this does to the user's connection. */
  consequence: string;
  /** The control cluster — a SegmentedField, a Select, or a Switch. */
  control: React.ReactNode;
  /** True when this row holds an unsaved edit. */
  dirty?: boolean;
  /**
   * "before -> after", already rendered as a string by the caller (which owns
   * the option labels). Shown only while dirty.
   */
  delta?: string | null;
  /** Ties the control to its label for assistive tech. */
  labelId?: string;
  className?: string;
}

export function SettingRow({
  label,
  consequence,
  control,
  dirty = false,
  delta = null,
  labelId,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        SETTING_ROW.ROOT,
        // Two clocks, both named: the fill is the promotion itself, the ink
        // follows it. Never `transition-all` — that would silently pick up the
        // layout properties this row deliberately does not animate.
        "transition-[background-color,color] duration-[--duration-standard] ease-[--ease-standard]",
        dirty && SETTING_ROW_DIRTY.ROOT,
        className,
      )}
      data-dirty={dirty ? "true" : undefined}
    >
      <div className={SETTING_ROW.TEXT}>
        <div className="flex flex-wrap items-center gap-2">
          <span id={labelId} className={SETTING_ROW.LABEL}>
            {label}
          </span>
          {dirty && delta ? (
            <span className={SETTING_ROW_DIRTY.DELTA_CHIP}>{delta}</span>
          ) : null}
        </div>
        <span
          className={
            dirty
              ? SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL
              : SETTING_ROW.CONSEQUENCE
          }
        >
          {consequence}
        </span>
      </div>

      <div className={SETTING_ROW.CONTROL}>{control}</div>
    </div>
  );
}

export default SettingRow;

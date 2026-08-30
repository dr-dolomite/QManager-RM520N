"use client";

import * as React from "react";
import { motion } from "motion/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  SEGMENTED,
  segmentedBreakpoint,
  SELECT_TRIGGER,
  SELECT_TRIGGER_ON_FILL,
} from "./shapes";

// =============================================================================
// SegmentedField — a pill group above the card breakpoint, a Select below it
// =============================================================================
// Replaces a bare `<Select>` for binary and three/four-way choices, so a radio
// kill switch and a roaming preference stop looking like the same control.
//
// WHY THE FILL TRAVELS RATHER THAN CROSS-FADES. Segments have unequal label
// widths ("Automatic" vs "LTE only"), so two stacked fills fading into each
// other visibly jump. One `motion.span` rendered inside whichever segment is
// active, sharing a `layoutId`, makes Motion tween the BOX between positions —
// which also means nothing here animates `width` (DESIGN.md > Transform-Only).
//
// THE layoutId MUST BE INSTANCE-SCOPED. This surface renders six of these at
// once — three rows in each of two write cards. A module-constant id makes every
// thumb share one layout group and fling across the card on first paint. `useId`
// scopes it per instance.
//
// EVERY SEGMENT RESERVES THE CHECK GLYPH, AND THAT IS THE FIX. The thumb is
// `absolute inset-0`, so its box IS the segment's box. The glyph plus `gap-1.5`
// is worth 21.7px and used to render only on the ACTIVE segment, which meant a
// click changed BOTH ends of the animation Framer was computing, mid-flight:
// measured first frame `translate3d(-266.99px, 0, 0) scale(1.13606, 1)`, so the
// pill stretched 14% while it travelled and its caps read as ellipses. The label
// you clicked slid 21.8px out from under your cursor, un-animated, and the rest
// of the track reshuffled as a hard cut while the one animated thing glided for
// 600ms. The glyph now renders on every segment and hides with
// `SEGMENTED.GLYPH_RESERVED` (opacity + scale, never `display` or a conditional
// render — both of those give the box back).
//
// THERE IS NO FIRST-PAINT GUARD ANY MORE, and its removal is the point rather
// than an omission. It ran one rAF frame at zero duration on mount to stop the
// thumb sliding in from nowhere. That fling was caused by the layoutId being a
// MODULE CONSTANT; `useId` fixed it, and the guard has been dead weight ever
// since — rendered settled from first paint the thumb carries only
// `style="opacity: 1;"` at mount, because a `layoutId` node with no predecessor
// in its stack has no snapshot to animate from. It was a live violation of
// DESIGN.md > The Non-Load-Bearing Rule. `initial={false}` is NOT its
// replacement: that governs enter animations of animated VALUES, not layout
// projection, and adding it would substitute a prop for a mechanism.
//
// THE SELECT IS NOT A DEGRADED FALLBACK. Four segments do not fit one row on a
// phone, and shrinking them under a 44px touch target is not an option on a
// surface field techs use on a tablet in the field. Both controls are bound to
// the same state; below the breakpoint the Select IS the control.
// =============================================================================

export interface SegmentedOption<T extends string> {
  value: T;
  /** Already-translated label. This component does no lookups. */
  label: string;
}

export interface SegmentedFieldProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name — the row's label. Required; these controls have no visible <label>. */
  ariaLabel: string;
  disabled?: boolean;
  /**
   * True when the row is promoted (holds an unsaved edit). Drops the track's
   * own fill — the row is already the tonal container, so a second fill behind
   * the segments is redundant. See `SEGMENTED.TRACK_ON_FILL`.
   */
  onFill?: boolean;
  /**
   * The card container step the pill-group / Select switch keys off
   * (default `"2xl"`). A surface whose cards are narrower than the family
   * default — the basic settings page's two half-width cards — passes `"lg"`
   * so the pill group survives where it already fits. See
   * `segmentedBreakpoint()` in shapes.ts.
   */
  breakpoint?: "lg" | "xl" | "2xl";
  className?: string;
}

export function SegmentedField<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled = false,
  onFill = false,
  breakpoint = "2xl",
  className,
}: SegmentedFieldProps<T>) {
  const instanceId = React.useId();
  const bp = segmentedBreakpoint(breakpoint);

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? "";

  return (
    <div className={cn(bp.WRAP, className)}>
      <ToggleGroup
        type="single"
        value={value}
        // Radix emits "" when the active item is clicked again. A settings row
        // has no empty state, so the deselect is swallowed rather than allowed
        // to write an invalid value.
        onValueChange={(next) => next && onValueChange(next as T)}
        spacing={1}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          onFill ? SEGMENTED.TRACK_ON_FILL : SEGMENTED.TRACK,
          bp.GROUP,
        )}
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={
                onFill ? SEGMENTED.SEGMENT_ON_FILL : SEGMENTED.SEGMENT
              }
            >
              {isActive ? (
                <motion.span
                  layoutId={`${instanceId}-segmented-thumb`}
                  className={SEGMENTED.THUMB}
                  transition={transitionStandard}
                  aria-hidden="true"
                />
              ) : null}
              {/* RENDERED ON EVERY SEGMENT, hidden on the inactive ones. The
                  check reinforces the active segment non-chromatically, so the
                  selection survives grayscale and sunlight washout — the fill
                  alone is not allowed to be the only carrier — and reserving its
                  box is what keeps the segment widths stable while the thumb
                  travels. See the header comment for the measurements. */}
              <MaterialSymbol
                name="check"
                filled
                size={SEGMENTED.GLYPH}
                aria-hidden="true"
                className={
                  isActive ? SEGMENTED.GLYPH_ACTIVE : SEGMENTED.GLYPH_RESERVED
                }
              />
              <span className={SEGMENTED.LABEL}>{option.label}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className={cn(
            onFill ? SELECT_TRIGGER_ON_FILL : SELECT_TRIGGER,
            bp.SELECT,
          )}
        >
          <SelectValue>{activeLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="rounded-tile">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default SegmentedField;

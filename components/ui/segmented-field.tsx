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
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";

// =============================================================================
// SegmentedField — a pill group above the card breakpoint, a Select below it
// =============================================================================
// The shared, icon-set-agnostic primitive. The cellular settings family
// (`cellular-settings-card.tsx`, `apn-settings-card.tsx`) renders it with the
// Material Symbols check glyph, and a route on the other icon set (lucide)
// renders the same control without crossing the icon boundary
// (DESIGN.md > Icons). This file imports NEITHER icon set: the caller renders
// the check glyph through the required `glyph` prop.
//
// WHY THE FILL TRAVELS RATHER THAN CROSS-FADES. Segments have unequal label
// widths ("Automatic" vs "LTE only"), so two stacked fills fading into each
// other visibly jump. One `motion.span` rendered inside whichever segment is
// active, sharing a `layoutId`, makes Motion tween the BOX between positions —
// which also means nothing here animates `width` (DESIGN.md > Transform-Only).
//
// THE layoutId MUST BE UNIQUE PER MOUNT, NOT JUST PER TREE POSITION. A surface
// can render several of these at once. A module-constant id makes every thumb
// share one layout group and fling across the card on first paint. `useId` is
// not enough either: it is derived from tree position, so two routes with the
// same shape (two routes of the same shape) mint the SAME ids, and a
// route switch that unmounts one and mounts the other in one commit hands each
// thumb the old route's thumb as its shared-layout predecessor — it flies in
// from wherever that one sat. A module counter read once per mount can't repeat.
//
// THE THUMB TRAVELS RELATIVE TO ITS OWN TRACK. The wrapper is a `layoutRoot`,
// so Motion measures the thumb against it instead of the page. Without it,
// anything that shifts the card on the page while the control re-renders (an
// apply banner or stepper appearing above it, a row collapsing, a rebase after
// an apply) makes every thumb "catch up" to its new page position — a vertical
// slide on a control whose only axis of travel is horizontal.
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
// MODULE CONSTANT; per-instance scoping fixed it, and the guard has been dead weight ever
// since — rendered settled from first paint the thumb carries only
// `style="opacity: 1;"` at mount, because a `layoutId` node with no predecessor
// in its stack has no snapshot to animate from. It was a live violation of
// DESIGN.md > The Non-Load-Bearing Rule. `initial={false}` is NOT its
// replacement: that governs enter animations of animated VALUES, not layout
// projection, and adding it would substitute a prop for a mechanism.
//
// THE SELECT IS NOT A DEGRADED FALLBACK. A few segments do not fit one row on a
// phone, and shrinking them under a 44px touch target is not an option on a
// surface field techs use on a tablet in the field. Both controls are bound to
// the same state; below the breakpoint the Select IS the control. Pass
// `breakpoint="never"` for a row with 2–3 short options (On/Off, Low/Normal/
// High) that always fits and should never fall back to a Select.
// =============================================================================

export interface SegmentedOption<T extends string> {
  value: T;
  /** Already-translated label. This component does no lookups. */
  label: string;
  disabled?: boolean;
  /** The label reads as a quantity, not a word — `tabular-nums`. */
  numeric?: boolean;
}

/**
 * Track + segment geometry for the pill group that replaces a Select on
 * binary and three-way choices. See the header comment for the animation
 * rules this shape exists to satisfy.
 */
export const SEGMENTED = {
  TRACK: "flex rounded-pill bg-surface-container-high p-1",
  SEGMENT:
    "relative h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium text-on-surface-variant hover:bg-transparent hover:text-on-surface data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary-foreground disabled:pointer-events-none disabled:opacity-50",
  /** The travelling fill. */
  THUMB: "absolute inset-0 rounded-pill bg-primary",
  /** Label sits above the thumb. */
  LABEL: "relative",
  /** The numeric variant of `LABEL` — a reported quantity, not a word. */
  LABEL_NUMERIC: "relative tabular-nums",
  /** Glyph size inside a segment. */
  GLYPH: 16,
  /**
   * The check glyph on the ACTIVE segment.
   *
   * The check reinforces selection non-chromatically, so the choice survives
   * grayscale and sunlight washout — the fill alone is never allowed to be the
   * only carrier.
   */
  GLYPH_ACTIVE:
    "relative opacity-100 scale-100 transition-[opacity,transform] duration-[var(--duration-quick)] ease-[var(--ease-quick)]",
  /**
   * The same glyph on an INACTIVE segment: still in the box, invisible to the
   * eye. THIS IS THE PRIMARY FIX for the segmented control's travelling fill,
   * and it is a layout fix, not a decoration. See the header comment for the
   * measurements that made this the fix.
   *
   * `opacity` + `scale` ONLY — never `display`, `hidden` or a conditional
   * render, all three of which give the box back.
   */
  GLYPH_RESERVED:
    "relative opacity-0 scale-[0.6] transition-[opacity,transform] duration-[var(--duration-quick)] ease-[var(--ease-quick)]",
} as const;

/**
 * Below this container width the segmented control is replaced by a Select.
 * `never` means the pill group renders at every width — reserved for a row
 * whose options are few enough and short enough that the fallback is never
 * needed (On/Off, Low/Normal/High).
 */
const SEGMENTED_BREAKPOINTS = {
  never: {
    GROUP: "flex",
    SELECT: "hidden",
    /** Natural width, never stretched or squeezed: 2–3 short segments always fit. */
    WRAP: "flex w-auto shrink-0",
  },
  sm: {
    GROUP: "hidden @sm/card:flex",
    SELECT: "flex w-full @sm/card:hidden",
    WRAP: "flex w-full @sm/card:w-auto",
  },
  lg: {
    GROUP: "hidden @lg/card:flex",
    SELECT: "flex w-full @lg/card:hidden",
    /** The wrapper: full width in stacked-row mode, natural width side by side. */
    WRAP: "flex w-full @lg/card:w-auto",
  },
  xl: {
    GROUP: "hidden @xl/card:flex",
    SELECT: "flex w-full @xl/card:hidden",
    WRAP: "flex w-full @xl/card:w-auto",
  },
  "2xl": {
    GROUP: "hidden @2xl/card:flex",
    SELECT: "flex w-full @2xl/card:hidden",
    WRAP: "flex w-full @2xl/card:w-auto",
  },
  "5xl": {
    GROUP: "hidden @5xl/card:flex",
    SELECT: "flex w-full @5xl/card:hidden",
    WRAP: "flex w-full @5xl/card:w-auto",
  },
} as const;

export type SegmentedBreakpointStep = keyof typeof SEGMENTED_BREAKPOINTS;

/**
 * Literal strings only. Tailwind's scanner only compiles class names it finds
 * verbatim in source, so a template string like `` @${step}/card:flex `` would
 * produce NO rule — the pill group would silently vanish at every width. If a
 * step is added, its three strings must be spelled out above, never
 * interpolated.
 */
export const segmentedBreakpoint = (
  step: SegmentedBreakpointStep = "2xl",
) => SEGMENTED_BREAKPOINTS[step];

/** The fallback Select trigger's voice and width; it rides a container row, so `host="container"`. */
const DEFAULT_SELECT_TRIGGER =
  "text-[0.84375rem] font-medium w-full px-4 @2xl/card:w-auto";

export interface SegmentedFieldProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name — the row's label. Required; these controls have no visible <label>. */
  ariaLabel: string;
  disabled?: boolean;
  /**
   * The card container step the pill-group / Select switch keys off
   * (default `"2xl"`). `"never"` keeps the pill group at every width — see
   * the header comment. See `segmentedBreakpoint()` for the rest of the steps.
   */
  breakpoint?: SegmentedBreakpointStep;
  className?: string;
  /**
   * Renders the check glyph reserved on every segment. Required so this file
   * stays free of any one icon set — a lucide route passes lucide's
   * `CheckIcon`, a Material Symbols route passes `MaterialSymbol`. Called once
   * per segment with the class string (`SEGMENTED.GLYPH_ACTIVE` or
   * `.GLYPH_RESERVED`) the caller's icon element must carry.
   */
  glyph: (className: string) => React.ReactNode;
  /** Overrides the fallback Select's trigger classes. Defaults to the canon 42px field. */
  selectTriggerClassName?: string;
}

/** Per-mount id source for the thumb's `layoutId` — see the header comment. */
let segmentedInstanceSeq = 0;

export function SegmentedField<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled = false,
  breakpoint = "2xl",
  className,
  glyph,
  selectTriggerClassName,
}: SegmentedFieldProps<T>) {
  const [instanceId] = React.useState(() => `segmented-${++segmentedInstanceSeq}`);
  const bp = segmentedBreakpoint(breakpoint);

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? "";

  return (
    <motion.div layout layoutRoot className={cn(bp.WRAP, className)}>
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
        className={cn(SEGMENTED.TRACK, bp.GROUP)}
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              aria-disabled={option.disabled || undefined}
              className={SEGMENTED.SEGMENT}
            >
              {isActive ? (
                <motion.span
                  layoutId={`${instanceId}-segmented-thumb`}
                  className={SEGMENTED.THUMB}
                  transition={transitionStandard}
                  aria-hidden="true"
                />
              ) : null}
              {/* RENDERED ON EVERY SEGMENT, hidden on the inactive ones. See
                  the header comment for why the box has to be reserved. */}
              {glyph(isActive ? SEGMENTED.GLYPH_ACTIVE : SEGMENTED.GLYPH_RESERVED)}
              <span
                className={option.numeric ? SEGMENTED.LABEL_NUMERIC : SEGMENTED.LABEL}
              >
                {option.label}
              </span>
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
          host={selectTriggerClassName ? undefined : "container"}
          className={cn(selectTriggerClassName ?? DEFAULT_SELECT_TRIGGER, bp.SELECT)}
        >
          <SelectValue>{activeLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="rounded-tile">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </motion.div>
  );
}

export default SegmentedField;

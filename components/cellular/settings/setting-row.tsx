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
// DIRTY STATE IS THE CHIP'S JOB, NOT THE ROW'S
// -----------------------------------------------------------------------------
// A row holding an unsaved edit used to promote its whole body to
// `primary-container`. Retired 2026-08-30 (docs/reference/
// cellular-settings-family.md): the delta chip below is already `bg-primary`,
// so a full-row fill restated the same "this is a pending edit" fact a second
// time on one row. The row now stays neutral in both states and `dirty` exists
// only to gate the chip's text and the `data-dirty` attribute.
//
// -----------------------------------------------------------------------------
// THE DELTA CHIP IS RESERVED HORIZONTALLY, NOT VERTICALLY
// -----------------------------------------------------------------------------
// The delta chip ("SIM 2 -> SIM 1") appears when the row goes dirty. Animating
// the height it would otherwise add is a container-size change — `emphasized` at
// best, and impossible to express without an implicit `transition-all` — so the
// chip is rendered UNCONDITIONALLY and merely goes `invisible` when the row is
// clean: `visibility: hidden` keeps the box. Reserve, don't animate; the same
// trade as `SaveButton`'s width lock.
//
// WHAT CHANGED IS WHICH AXIS IT RESERVES. The chip used to hold its own LINE
// between the label and the consequence, which bought a dirty-independent height
// at the price of 28px of permanent blank inside the one place on this row where
// two things belong together — a title and the sentence explaining what it does
// to your connection. It now sits beside the label on `LABEL_ROW`, which is
// `items-center` and floored to the chip's own height, so the reservation costs
// horizontal room instead of vertical.
//
// THE COMMENT BEFORE THE ONE BEFORE THIS WAS FALSE, AND THE FALSEHOOD WAS A BUG.
// It claimed a `min-h` floor already reserved the chip's line. It did not: the
// floor was 76px and the CLEAN row already measured 98.1px at the widths where
// the chip wrapped, so the floor was inert. Measured on the real page, the dirty
// promotion grew the row EXACTLY 30px at 760px and 1500px body width and 0px
// everywhere else. The row is `@2xl/card:items-center`, so the control dropped
// half of that — 15px — and Framer does not animate a layout change it was not
// asked to project: at rest the thumb sat at y 679.8, and the first frame of the
// move reported y 694.8 with a transform y component of 0px. The thumb
// teleported vertically and then glided horizontally. That is what the line
// reservation fixed, and moving to a horizontal reservation keeps the fix — see
// `SETTING_ROW` in shapes.ts for the one narrow case that survives it.
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
  // Hoisted rather than inlined, because the chip node itself must stay
  // unconditional — the whole point of the reservation is that the ELEMENT never
  // comes and goes, only its visibility does.
  const deltaText = dirty ? delta : null;

  return (
    <div
      className={cn(SETTING_ROW.ROOT, className)}
      data-dirty={dirty ? "true" : undefined}
    >
      <div className={SETTING_ROW.TEXT}>
        <div className={SETTING_ROW.LABEL_ROW}>
          <span id={labelId} className={cn(SETTING_ROW.LABEL, "min-w-0")}>
            {label}
          </span>
          {/* Always in the DOM, so the row's geometry does not depend on the
              dirty state. `invisible` (visibility: hidden) keeps the box where
              `hidden` or a conditional render would give it back — see the
              header comment for the 30px that cost when it was not reserved. It
              is also hidden from assistive tech while empty: an announced blank
              chip is noise, and the row's real state is already carried by
              `data-dirty` and by the control's own value. */}
          <span
            className={cn(
              SETTING_ROW_DIRTY.DELTA_CHIP,
              !deltaText && "invisible",
            )}
            aria-hidden={deltaText ? undefined : true}
          >
            {deltaText}
          </span>
        </div>
        <span className={SETTING_ROW.CONSEQUENCE}>{consequence}</span>
      </div>

      <div className={SETTING_ROW.CONTROL}>{control}</div>
    </div>
  );
}

export default SettingRow;

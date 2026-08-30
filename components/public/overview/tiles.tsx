"use client";

import { EMPHASIS } from "@/components/pre-auth-type";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import {
  EYEBROW_CLASS,
  TILE_DISC,
  TILE_DISC_SHAPE,
  TILE_HEIGHT,
  TILE_SHAPE,
} from "./tone";

// =============================================================================
// The two tile families
// =============================================================================
// Both bodies are NEUTRAL. That is the whole of the adoption pass: the identity
// tiles were already neutral and stay that way, and the status tiles hand their
// colour to a 40px disc instead of wearing it across 66px of surface.
//
// There is deliberately no tone/body export. A caller cannot tint a body back,
// which is cheaper than a comment asking nobody to.
// =============================================================================

/** The shared body: neutral fill, one shape, one height. */
const TILE_BODY = cn(
  "bg-surface-container text-on-surface flex min-w-0 items-center",
  TILE_SHAPE,
  TILE_HEIGHT,
);

/**
 * The eyebrow. `min-w-0` and `truncate` are BOTH required and neither works
 * alone: `truncate` cannot shrink a flex child that has not been allowed to go
 * below its content width, and `min-w-0` on its own just lets the text spill.
 * Without the pair, Italian's "Larghezza di banda" pushes the identity trio
 * wider than its column at the 288px cliff.
 */
const TILE_EYEBROW = cn(EYEBROW_CLASS, "text-on-surface-variant min-w-0 truncate");

/**
 * Identity tile — Carrier · Network · Bandwidth. Metadata, always neutral: a
 * carrier's name is not a verdict, so it gets no hue and no disc.
 */
export function TonalTile({
  eyebrow,
  value,
  title,
  mono = false,
  truncate = false,
}: {
  eyebrow: string;
  value: string;
  title?: string;
  /** Machine-Voice Rule: the bandwidth reading is a number, not a name. */
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className={TILE_BODY}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={TILE_EYEBROW}>{eyebrow}</span>
        <span
          className={cn(
            "text-sm font-semibold tracking-[-0.005em] whitespace-nowrap",
            mono && "tabular-nums",
            truncate && "overflow-hidden text-ellipsis",
          )}
          title={title ?? value}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * Status tile — Internet · Temperature.
 *
 * The verdict lives in the DISC, so health is legible before a single word is
 * read while the body stays neutral and the digits keep their own ink. The
 * glyph is what keeps the verdict legible without colour at all.
 *
 * The disc morphs on `background-color` AND `color` together at the standard
 * step: animating only the fill leaves the glyph's ink snapping a frame ahead of
 * the disc it sits on, which reads as a flicker rather than as a state change.
 */
export function StatusTile({
  eyebrow,
  value,
  tone,
  icon,
  mono = false,
}: {
  eyebrow: string;
  value: string;
  tone: keyof typeof TILE_DISC;
  icon: MaterialSymbolName;
  mono?: boolean;
}) {
  return (
    <div className={cn(TILE_BODY, "gap-3")}>
      <span
        className={cn(
          TILE_DISC_SHAPE,
          "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
          TILE_DISC[tone],
        )}
      >
        <MaterialSymbol name={icon} filled size={21} />
      </span>
      <div className="flex min-w-0 flex-col gap-[0.3125rem]">
        <span className={TILE_EYEBROW}>{eyebrow}</span>
        <span className={cn(EMPHASIS, "truncate", mono && "tabular-nums")}>
          {value}
        </span>
      </div>
    </div>
  );
}

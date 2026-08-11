"use client";

import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import { EYEBROW_CLASS, TILE_CLASSES, TILE_SHAPE, type TileTone } from "./tone";

// =============================================================================
// The two trios
// =============================================================================
// Both used to be bare eyebrow-plus-value cells, on the reasoning that the card
// already provides the container. Under a tonal system that reasoning inverts:
// six values floating in one large surface is exactly the "bright text
// sprinkled on white" the system exists to replace.
// =============================================================================

/** Info trio cell — Carrier · Network · Bandwidth. Identity, always neutral. */
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
    <div
      className={cn(
        "bg-surface-container flex min-w-0 flex-col gap-1",
        TILE_SHAPE,
      )}
    >
      <span className={cn(EYEBROW_CLASS, "text-on-surface-variant")}>
        {eyebrow}
      </span>
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
  );
}

/**
 * Status trio cell — Overall · Internet · Temperature. The verdict lives in the
 * FILL, so health is legible before a single word is read; the glyph is what
 * keeps it legible without colour. A tinted tile drops its eyebrow to 80%
 * opacity of the container's own ink rather than switching to the variant
 * token, which would not be a pair for the fill.
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
  tone: TileTone;
  icon?: MaterialSymbolName;
  mono?: boolean;
}) {
  const tinted = tone !== "neutral";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-[0.3125rem]",
        TILE_SHAPE,
        TILE_CLASSES[tone],
      )}
    >
      <span
        className={cn(
          EYEBROW_CLASS,
          tinted ? "opacity-80" : "text-on-surface-variant",
        )}
      >
        {eyebrow}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-[0.9375rem] leading-none font-semibold tracking-[-0.01em]",
          mono && "tabular-nums",
        )}
      >
        {icon && <MaterialSymbol name={icon} filled size={17} />}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

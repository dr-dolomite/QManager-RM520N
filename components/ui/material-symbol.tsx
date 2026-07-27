"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// =============================================================================
// MaterialSymbol — the shell's icon primitive
// =============================================================================
// DESIGN.md scopes Material Symbols Rounded to the sidebar; everything else in
// the product stays on lucide. Keep it that way — this component is deliberately
// not a general-purpose icon.
//
// The typeface is ligature-driven: the literal text "cell_tower" is substituted
// by the font for a single icon glyph. Two consequences the props below encode:
//
//   1. The name IS the content, so it must never reach a screen reader. Icons
//      here are always decorative next to a real text label, hence aria-hidden.
//   2. Fill is a variable axis (FILL 0..1), not a second font file. PRODUCT.md
//      requires the active nav item to differ from inactive ones by icon weight
//      as well as container tone, so the active state survives grayscale — that
//      is what `filled` buys, and it is an accessibility affordance, not polish.
// =============================================================================

/** Ligature names present in the build-time subset (app/fonts/…-subset.woff2). */
export type MaterialSymbolName =
  | "account_circle"
  | "cell_tower"
  | "chevron_right"
  | "donut_small"
  | "download"
  | "favorite"
  | "home"
  | "pets"
  | "radar"
  | "router"
  | "settings"
  | "settings_ethernet"
  | "signal_cellular_alt"
  | "sms"
  | "support"
  | "terminal"
  | "tune"
  | "unfold_more"
  | "vpn_lock";

export interface MaterialSymbolProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  name: MaterialSymbolName;
  /** Drives the FILL variable axis. The sidebar uses it to mark the active row. */
  filled?: boolean;
  /** Optical size in px. The subset carries opsz 20..48; the nav uses 20 and 18. */
  size?: number;
}

export function MaterialSymbol({
  name,
  filled = false,
  size = 20,
  className,
  style,
  ...props
}: MaterialSymbolProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="material-symbol"
      className={cn("material-symbol", className)}
      style={{
        fontSize: size,
        // opsz tracks the rendered size so strokes stay optically even between
        // the 20px nav glyphs and the 18px trailing affordances.
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'opsz' ${size}`,
        ...style,
      }}
      {...props}
    >
      {name}
    </span>
  );
}

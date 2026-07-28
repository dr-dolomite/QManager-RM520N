"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import type { MaterialSymbolName } from "./material-symbol-names";

// =============================================================================
// MaterialSymbol — the shell's icon primitive
// =============================================================================
// DESIGN.md scopes Material Symbols Rounded to the sidebar AND the dashboard
// route; every other route stays on lucide until it is migrated deliberately.
// The boundary is per-route on purpose: mixing two icon sets inside one screen
// is the thing the rule exists to prevent, and the dashboard previously carried
// four (lucide, react-icons/md, /fa6, /tb) beside a Material sidebar.
//
// Two exceptions survive on the dashboard by explicit design decision, both in
// Network Status, which is a recognized landmark on the one glance surface that
// re-glyphing buys nothing (DESIGN.md > Network Status Landmark Rule):
//
//   1. The SIM orb keeps lucide `CardSimIcon` / `Plane`.
//   2. The RAT glyphs keep `react-icons/md` (MdOutline5G, Md4gPlusMobiledata,
//      Md4gMobiledata, Md3gMobiledata) — "5G", "4G+" and
//      "3G" are typographic marks Material Symbols has no equivalent for.
//
// Sizing: this component sets `fontSize` as an INLINE STYLE, which outranks any
// utility. A parent's auto-sizing rule for lucide children (badge.tsx's
// `[&>svg]:size-3`, empty.tsx's `[&_svg:not([class*='size-'])]:size-6`) cannot
// reach it. Pass `size` explicitly at every call site.
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

// The glyph list lives in its own import-free module because the font-subset
// script must read it without loading React or the `@/` path alias. It is the
// single source of truth for both the type below and the .woff2 — see the
// header there. Re-exported so call sites keep importing the type from here.
export type { MaterialSymbolName } from "./material-symbol-names";

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

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

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

/**
 * Ligature names present in the build-time subset (app/fonts/…-subset.woff2).
 *
 * MUST stay sorted and byte-identical to ICONS in scripts-dev/subset-icons.mjs.
 * Nothing verifies the two agree: a name here but not there does not fail the
 * build, it ships a card that renders the literal word "sim_card" on a modem in
 * the field. Re-run `bun run icons:subset` and commit the .woff2 on every edit.
 */
export type MaterialSymbolName =
  | "account_circle"
  | "airplanemode_active"
  | "arrow_circle_down"
  | "arrow_circle_up"
  | "arrow_downward"
  | "arrow_upward"
  | "badge"
  | "cancel"
  | "cell_tower"
  | "check"
  | "check_circle"
  | "chevron_right"
  | "close"
  | "dns"
  | "do_not_disturb_on"
  | "donut_small"
  | "download"
  | "energy_savings_leaf"
  | "event_busy"
  | "favorite"
  | "help"
  | "home"
  | "info"
  | "memory"
  | "network_ping"
  | "open_in_new"
  | "pets"
  | "play_arrow"
  | "power_settings_new"
  | "priority_high"
  | "progress_activity"
  | "public"
  | "radar"
  | "refresh"
  | "restart_alt"
  | "router"
  | "schedule"
  | "settings"
  | "settings_ethernet"
  | "signal_cellular_1_bar"
  | "signal_cellular_2_bar"
  | "signal_cellular_3_bar"
  | "signal_cellular_4_bar"
  | "signal_cellular_alt"
  | "signal_cellular_off"
  | "sms"
  | "support"
  | "swap_horiz"
  | "terminal"
  | "timeline"
  | "tune"
  | "unfold_more"
  | "visibility"
  | "visibility_off"
  | "vpn_lock"
  | "warning";

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

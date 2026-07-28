#!/usr/bin/env node
// =============================================================================
// subset-icons — regenerate the Material Symbols Rounded subset
// =============================================================================
// QManager is served BY the modem, which frequently has no internet, so the
// icon font must be self-hosted. The full family is ~3.4 MB; the sidebar plus
// the dashboard route need 53 glyphs (19.3 KB). It was 19 glyphs / 10.4 KB when
// the boundary was sidebar-only. Google Fonts' `icon_names=` parameter does the subsetting server
// side and — critically — preserves the variable FILL axis, which the active
// nav row depends on (DESIGN.md > Iconography, PRODUCT.md > Accessibility).
//
// Run this whenever MaterialSymbolName in components/ui/material-symbol.tsx
// gains or loses an entry, then commit the .woff2:
//
//   bun run icons:subset
//
// Keep ICONS sorted and identical to that union. The build does not verify the
// two agree, so a name added only here is dead weight and a name added only
// there renders as literal text.
// =============================================================================

import { writeFile } from "node:fs/promises";

const ICONS = [
  "account_circle",
  "airplanemode_active",
  "arrow_circle_down",
  "arrow_circle_up",
  "arrow_downward",
  "arrow_upward",
  "badge",
  "cancel",
  "cell_tower",
  "check",
  "check_circle",
  "chevron_right",
  "close",
  "dns",
  "do_not_disturb_on",
  "donut_small",
  "download",
  "energy_savings_leaf",
  "event_busy",
  "favorite",
  "help",
  "home",
  "info",
  "memory",
  "network_ping",
  "open_in_new",
  "pets",
  "play_arrow",
  "power_settings_new",
  "priority_high",
  "progress_activity",
  "public",
  "radar",
  "refresh",
  "restart_alt",
  "router",
  "schedule",
  "settings",
  "settings_ethernet",
  "signal_cellular_1_bar",
  "signal_cellular_2_bar",
  "signal_cellular_3_bar",
  "signal_cellular_4_bar",
  "signal_cellular_alt",
  "signal_cellular_off",
  "sms",
  "support",
  "swap_horiz",
  "terminal",
  "timeline",
  "tune",
  "unfold_more",
  "visibility",
  "visibility_off",
  "vpn_lock",
  "warning",
];

const OUT = "app/fonts/MaterialSymbolsRounded-subset.woff2";

// FILL 0..1 must stay a RANGE, not a pinned value — pinning it collapses the
// axis and the active-row fill silently stops working.
const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0" +
  `&icon_names=${ICONS.join(",")}`;

// Google serves woff2 only to UAs it believes support it.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const css = await fetch(CSS_URL, { headers: { "User-Agent": UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts CSS request failed: ${r.status}`);
  return r.text();
});

const url = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
if (!url) throw new Error(`No font URL in the returned CSS:\n${css}`);

const font = await fetch(url, { headers: { "User-Agent": UA } }).then((r) => {
  if (!r.ok) throw new Error(`Font download failed: ${r.status}`);
  return r.arrayBuffer();
});

await writeFile(OUT, Buffer.from(font));
console.log(
  `${OUT} — ${ICONS.length} icons, ${(font.byteLength / 1024).toFixed(1)} KB`,
);

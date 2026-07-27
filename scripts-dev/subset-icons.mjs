#!/usr/bin/env node
// =============================================================================
// subset-icons — regenerate the Material Symbols Rounded subset
// =============================================================================
// QManager is served BY the modem, which frequently has no internet, so the
// icon font must be self-hosted. The full family is ~3.4 MB; the sidebar needs
// 19 glyphs. Google Fonts' `icon_names=` parameter does the subsetting server
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
  "cell_tower",
  "chevron_right",
  "donut_small",
  "download",
  "favorite",
  "home",
  "pets",
  "radar",
  "router",
  "settings",
  "settings_ethernet",
  "signal_cellular_alt",
  "sms",
  "support",
  "terminal",
  "tune",
  "unfold_more",
  "vpn_lock",
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

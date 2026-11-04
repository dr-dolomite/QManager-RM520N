#!/usr/bin/env bun
// =============================================================================
// subset-icons — regenerate the Material Symbols Rounded subset
// =============================================================================
// QManager is served BY the modem, which frequently has no internet, so the
// icon font must be self-hosted. The full family is ~3.4 MB; the sidebar plus
// the dashboard route need the glyphs listed in MATERIAL_SYMBOL_NAMES (~20 KB).
// It was 19 glyphs / 10.4 KB when the boundary was sidebar-only. Google Fonts'
// `icon_names=` parameter does the subsetting server side and — critically —
// preserves the variable FILL axis, which the active nav row depends on
// (DESIGN.md > Iconography, PRODUCT.md > Accessibility).
//
// The glyph list is NOT duplicated here. It is imported from the same module
// the `MaterialSymbolName` type is derived from, so the font and the compiler
// can never disagree about which glyphs exist.
//
//   bun run icons:subset     # regenerate the .woff2 + manifest
//   bun run icons:check      # verify the committed .woff2 is not stale
//
// Alongside the font this writes a MANIFEST recording exactly which names were
// requested and the sha256 of the bytes received. That manifest is what makes
// staleness detectable: the glyph list is a text edit anyone can make, but
// regenerating the font is a network round-trip plus a binary commit that is
// easy to forget, and a stale .woff2 fails invisibly — clean diff, green CI,
// passing tsc, and a literal "signal_cellular_4_bar" on a modem in the field.
//
// ALWAYS commit the .woff2 and the .json together.
// =============================================================================

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  MATERIAL_SYMBOL_AXES as AXES,
  MATERIAL_SYMBOL_NAMES,
} from "../components/ui/material-symbol-names";

const ICONS = [...MATERIAL_SYMBOL_NAMES];

const OUT = "app/fonts/MaterialSymbolsRounded-subset.woff2";
const MANIFEST = "app/fonts/MaterialSymbolsRounded-subset.json";

const CSS_URL =
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:${AXES}` +
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

const bytes = Buffer.from(font);
const sha256 = createHash("sha256").update(bytes).digest("hex");

await writeFile(OUT, bytes);
await writeFile(
  MANIFEST,
  // Written by `bun run icons:subset`; verified by `bun run icons:check`.
  // `axes` is recorded so a future change to the variable-axis string is caught
  // as staleness too — the glyph list can be identical while the font has lost
  // the FILL axis the active nav row needs.
  `${JSON.stringify({ axes: AXES, icons: ICONS, bytes: bytes.byteLength, sha256 }, null, 2)}\n`,
);

console.log(
  `${OUT} — ${ICONS.length} icons, ${(bytes.byteLength / 1024).toFixed(1)} KB`,
);
console.log(`${MANIFEST} — sha256 ${sha256.slice(0, 16)}…`);

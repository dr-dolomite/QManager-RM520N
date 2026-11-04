#!/usr/bin/env bun
// =============================================================================
// check-icons — verify the shipped icon font matches the glyph list
// =============================================================================
// QManager self-hosts a Material Symbols subset because the modem it runs on is
// usually offline. That makes the .woff2 a COMMITTED BUILD ARTIFACT, and every
// committed artifact can go stale relative to the source it was built from.
//
// The failure this exists to catch is quiet and asymmetric. Adding a glyph is
// one text edit to MATERIAL_SYMBOL_NAMES; regenerating the font is a network
// round-trip plus `git add` of a binary. Skip the second half and NOTHING
// complains — the diff looks complete, tsc passes, next build succeeds, CI is
// green — but the modem renders the literal text "signal_cellular_4_bar" where
// an icon belongs. There is no runtime error to trace, because a ligature font
// failing to substitute is just a font drawing the letters it was given.
//
// Introspecting the .woff2 directly would need a font parser: WOFF2 is Brotli
// with per-table transforms, so its ligature table is not readable with the
// stdlib. Rather than take a dependency, the GENERATOR TESTIFIES — it writes a
// manifest of what it requested and the sha256 of what it received, and this
// compares the committed font against that testimony.
//
// Residual gap, stated honestly: this proves the .woff2 is the one the
// generator produced for this list and these axes. It does not re-derive the
// glyphs from the font's own tables, so a hand-edited font committed alongside
// a hand-edited manifest would pass. That is not a realistic accident, and it
// is the price of staying dependency-free.
//
//   bun run icons:check
//
// Runs in `bun run package` alongside the shell gate. Fix a failure with
// `bun run icons:subset`, then commit BOTH the .woff2 and the .json.
// =============================================================================

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MATERIAL_SYMBOL_AXES,
  MATERIAL_SYMBOL_NAMES,
} from "../components/ui/material-symbol-names";

const FONT = "app/fonts/MaterialSymbolsRounded-subset.woff2";
const MANIFEST = "app/fonts/MaterialSymbolsRounded-subset.json";
const SOURCE_DIRS = ["app", "components", "constants", "hooks", "lib"];

const errors: string[] = [];
const warnings: string[] = [];

const names = [...MATERIAL_SYMBOL_NAMES] as string[];

// --- 1. The list itself ------------------------------------------------------
// Sorted and unique. Sorting is not cosmetic: it keeps the diff for "we added
// one glyph" a single line, and it stops two people who each append to the end
// in the same week from colliding on the same line.
const sorted = [...names].sort();
if (names.join(",") !== sorted.join(",")) {
  const at = names.findIndex((n, i) => n !== sorted[i]);
  errors.push(
    `MATERIAL_SYMBOL_NAMES is not sorted — first out-of-order entry is ` +
      `"${names[at]}" (expected "${sorted[at]}") at index ${at}.`,
  );
}
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) {
  errors.push(`Duplicate glyph name(s): ${[...new Set(dupes)].join(", ")}.`);
}

// --- 2. The manifest ---------------------------------------------------------
type Manifest = {
  axes?: string;
  icons?: string[];
  bytes?: number;
  sha256?: string;
};
let manifest: Manifest | null = null;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
} catch (e) {
  errors.push(
    `${MANIFEST} is missing or unparseable (${(e as Error).message}). ` +
      `Run \`bun run icons:subset\`.`,
  );
}

if (manifest) {
  const shipped = manifest.icons ?? [];
  const missing = names.filter((n) => !shipped.includes(n));
  const extra = shipped.filter((n) => !names.includes(n));

  // The consequential direction: the type permits a glyph the font never got,
  // so a call site compiles and then renders its own ligature name as text.
  if (missing.length) {
    errors.push(
      `${missing.length} glyph(s) in MATERIAL_SYMBOL_NAMES are NOT in the ` +
        `shipped font and would render as literal text: ${missing.join(", ")}.`,
    );
  }
  // The harmless direction, still an error: it means the font was cut from a
  // different list, so nothing about it can be trusted.
  if (extra.length) {
    errors.push(
      `${extra.length} glyph(s) are in the font but no longer in ` +
        `MATERIAL_SYMBOL_NAMES: ${extra.join(", ")}.`,
    );
  }
  if (manifest.axes !== MATERIAL_SYMBOL_AXES) {
    errors.push(
      `Axis mismatch — font was cut with "${manifest.axes}" but the source ` +
        `now declares "${MATERIAL_SYMBOL_AXES}". A collapsed FILL axis breaks ` +
        `the sidebar's active row without changing any glyph.`,
    );
  }
}

// --- 3. The font file --------------------------------------------------------
if (manifest?.sha256) {
  try {
    const bytes = readFileSync(FONT);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== manifest.bytes) {
      errors.push(
        `${FONT} is ${bytes.byteLength} bytes but the manifest records ` +
          `${manifest.bytes}.`,
      );
    } else if (sha256 !== manifest.sha256) {
      errors.push(`${FONT} does not match the manifest sha256.`);
    }
  } catch (e) {
    errors.push(`${FONT} is missing or unreadable (${(e as Error).message}).`);
  }
}

// --- 4. Unused glyphs (warning only) ----------------------------------------
// Dead weight in a font served over a cellular modem is worth knowing about,
// but this is a substring scan, not a resolver: a name that also occurs as an
// ordinary string ("check", "info", "home") reads as used even when it is not.
// It can therefore MISS unused glyphs, and must never fail the build over one.
function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const haystack = SOURCE_DIRS.flatMap((d) => walk(d))
  .filter((p) => !p.includes("material-symbol-names"))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const unused = names.filter((n) => !haystack.includes(`"${n}"`));
if (unused.length) {
  warnings.push(
    `${unused.length} glyph(s) have no literal call site and may be dead ` +
      `weight: ${unused.join(", ")}.`,
  );
}

// --- Report ------------------------------------------------------------------
for (const w of warnings) console.warn(`[warn] ${w}`);
for (const e of errors) console.error(`[err]  ${e}`);

if (errors.length) {
  console.error(
    `\n[icons:check] ${errors.length} error(s), ${warnings.length} warning(s)` +
      `\n              Fix: bun run icons:subset && git add ${FONT} ${MANIFEST}`,
  );
  process.exit(1);
}

console.log(
  `[icons:check] ${names.length} glyphs, font matches manifest ` +
    `(${warnings.length} warning(s))`,
);

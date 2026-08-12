// lib/i18n/passthrough.ts
//
// "Untranslated passthrough" detection: a locale value that is byte-identical to
// the English source string.
//
// WHY this exists. `compareAll()` in pack.ts grades key *structure* — is every
// English key present, are the {{placeholders}} intact. A locale that ships every
// key with the English text copied verbatim therefore grades 100% translated. That
// is exactly what a half-finished pack looks like, and the gate could not see it.
//
// WHY it is only a warning. In this domain a large share of identical values are
// CORRECT. Radio acronyms (RSRP, SINR, EARFCN), SI units (dBm, MHz), protocol
// names (APN, IPv4, ICCID), product names (QManager, Tailscale, Discord) and
// interpolation-only strings ("{{value}} dBm") are identical in every language on
// purpose. A naive byte-compare reports ~170-240 hits per locale and is almost all
// noise. The filter below exists to get the noise out; what survives is judged by
// a human, so this never fails the build.
//
// THE HEURISTIC, in one sentence: strip everything that is machine vocabulary from
// the value, and warn only if real prose words are left over — one word is enough
// for a non-Latin-script locale (a Chinese pack has no business containing an
// English word), two are required for a Latin-script one (Italian and Indonesian
// legitimately keep loanwords like "Server", "Online", "Optimal").

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_LANG, buildBaseIndex, flatten, listNamespaces, loadNs, findKeyLine, type BaseIndex } from "./pack";

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Terms that are correctly identical in every locale. Loaded from the sibling
 * JSON so a translator can extend it without touching TypeScript. Every string
 * array in that file is unioned; the `_readme` key is metadata and is skipped.
 */
function loadAllowlist(): Set<string> {
  const path = join(process.cwd(), "lib", "i18n", "passthrough-allowlist.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const out = new Set<string>();
  for (const [group, value] of Object.entries(raw)) {
    if (group.startsWith("_")) continue;
    if (!Array.isArray(value)) continue;
    for (const term of value) {
      if (typeof term !== "string") continue;
      // Store the split form too, so "EN-DC" matches the tokens EN and DC and
      // "Wi-Fi" matches Wi/Fi — tokenisation below splits on punctuation.
      out.add(term.toLowerCase());
      for (const part of term.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part) out.add(part);
      }
    }
  }
  return out;
}

let _allowlist: Set<string> | null = null;
export function allowlist(): Set<string> {
  if (!_allowlist) _allowlist = loadAllowlist();
  return _allowlist;
}

// ---------------------------------------------------------------------------
// Script class
// ---------------------------------------------------------------------------

/**
 * Language subtags whose written form is not Latin script. For these, a single
 * leftover English word is already strong evidence of an untranslated string —
 * there is no "we kept the loanword" defence when the surrounding text would be
 * in a different alphabet entirely.
 */
const NON_LATIN_PREFIXES = [
  "zh", "ja", "ko", "th", "ar", "he", "fa", "ur", "ru", "uk", "bg", "sr", "mk",
  "el", "hy", "ka", "am", "hi", "bn", "ta", "te", "kn", "ml", "si", "my", "km",
];

export function isNonLatinScript(lang: string): boolean {
  const sub = lang.toLowerCase().split(/[-_]/)[0];
  return NON_LATIN_PREFIXES.includes(sub);
}

/** Prose words required before a value is reported, by script class. */
export function proseThreshold(lang: string): number {
  return isNonLatinScript(lang) ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Value analysis
// ---------------------------------------------------------------------------

/** Values that are addresses/identifiers rather than sentences — never prose. */
function looksLikeIdentifier(value: string): boolean {
  const v = value.trim();
  if (/\s/.test(v)) return false; // has whitespace → not a bare token
  // hostname, path, email, URL, phone number, version, dotted identifier
  return /[./@:\\]/.test(v) || /^\+?\d/.test(v);
}

/**
 * Words left in `value` once every piece of machine vocabulary is removed.
 *
 * Removed, in order: {{interpolations}}, HTML tags, then per token — anything
 * containing a digit (5G, IPv4, B12, n78), short ALL-CAPS acronyms (<= 6 chars:
 * APN, PCI, SINR, EARFCN), single letters, and allowlisted terms.
 */
export function proseWords(value: string): string[] {
  const stripped = value.replace(/\{\{[^}]*\}\}/g, " ").replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  const allow = allowlist();
  const out: string[] = [];
  for (const token of stripped.split(/[^A-Za-z0-9]+/)) {
    if (!token) continue;
    if (token.length < 2) continue; // single letters carry no evidence
    if (/\d/.test(token)) continue; // 5G, IPv4, B12, 2FA…
    if (token === token.toUpperCase() && token.length <= 6) continue; // acronym
    if (allow.has(token.toLowerCase())) continue;
    out.push(token);
  }
  return out;
}

/**
 * Decide whether an identical value should be reported for `lang`.
 * Returns the surviving prose words when it should, or null when it should not.
 */
export function judge(lang: string, value: string): string[] | null {
  if (!value.trim()) return null;
  if (looksLikeIdentifier(value)) return null;
  const words = proseWords(value);
  return words.length >= proseThreshold(lang) ? words : null;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface PassthroughHit {
  lang: string;
  ns: string;
  key: string;
  value: string;
  /** The prose words that survived the filter — the reason it was reported. */
  words: string[];
  line?: number;
}

export interface PassthroughReport {
  lang: string;
  /** Every value byte-identical to English, before filtering. */
  identical: number;
  /** Identical values that survived the filter — the reported ones. */
  hits: PassthroughHit[];
}

/** Scan one language for untranslated passthrough. */
export function scanLang(lang: string, base: BaseIndex): PassthroughReport {
  const nsList = listNamespaces(lang);
  const hits: PassthroughHit[] = [];
  let identical = 0;

  for (const ns of base.namespaces) {
    if (!nsList.includes(ns)) continue;
    const loaded = loadNs(lang, ns);
    if (!loaded.tree) continue;
    const target = flatten(loaded.tree);
    for (const [key, enVal] of base.keys.get(ns) ?? []) {
      const val = target.get(key);
      if (val === undefined || val !== enVal) continue;
      identical++;
      const words = judge(lang, val);
      if (words) hits.push({ lang, ns, key, value: val, words, line: findKeyLine(loaded.raw, key) });
    }
  }

  return { lang, identical, hits };
}

/** Scan every non-English locale directory. */
export function scanAll(base?: BaseIndex, langs?: string[]): PassthroughReport[] {
  const idx = base ?? buildBaseIndex();
  const list = langs ?? [];
  return list.filter((l) => l !== BASE_LANG).sort().map((l) => scanLang(l, idx));
}

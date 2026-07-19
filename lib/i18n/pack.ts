// lib/i18n/pack.ts
//
// Shared, dependency-free i18n validation + pack engine.
//
// This is the SINGLE comparison engine behind every i18n gate:
//   - `lib/i18n/check.ts`      (repo-wide drift gate, `bun run i18n:check`)
//   - `scripts-dev/lang.ts`    (contributor/maintainer CLI, `bun run lang …`)
//   - `.github/workflows/i18n-parity.yml` (CI, via `lang check --ci`)
//
// Keeping the logic here — and importing it everywhere — is what stops the three
// surfaces from drifting into three subtly-different definitions of "valid". It
// uses only the JS standard library (+ `Intl.PluralRules`, built into Bun/Node),
// so it runs with no `bun install` and could later be bundled into a browser
// editor unchanged.
//
// English (`en`) is always the source-of-truth superset. Every other language is
// compared against it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Absolute path to `public/locales`, resolved from CWD (repo root). */
export const LOCALES_DIR = join(process.cwd(), "public", "locales");
export const BASE_LANG = "en";

/**
 * Files inside a locale dir that are NOT translation namespaces. `_pack.json`
 * carries per-language metadata for the pack pipeline (see PackMeta in
 * types/i18n.ts); it must never be compared as a namespace or the parity check
 * would flag it as an "extra namespace". The underscore prefix is the reserved
 * marker for such non-namespace files.
 */
const RESERVED_FILES = new Set(["_pack.json"]);

// ---------------------------------------------------------------------------
// Key flattening (path -> value)
// ---------------------------------------------------------------------------

export type JsonNode = string | { [k: string]: JsonNode } | JsonNode[];

/**
 * Flatten a namespace tree into a Map of dot-path → leaf string value.
 * Arrays are treated as opaque leaves (they aren't used as translation
 * containers), matching the historical behaviour of check.ts.
 */
export function flatten(node: JsonNode, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof node === "string") {
    out.set(prefix, node);
    return out;
  }
  if (Array.isArray(node)) {
    out.set(prefix, JSON.stringify(node));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flatten(v, next, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plurals (CLDR-aware, union-based — see design note below)
// ---------------------------------------------------------------------------

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_SUFFIXES)[number];

/**
 * If `key` ends in a plural suffix (`foo.bar_one`), return its base + category.
 * i18next writes plurals as `<base>_<category>` keys.
 */
export function splitPlural(key: string): { base: string; category: PluralCategory } | null {
  for (const cat of PLURAL_SUFFIXES) {
    const suffix = `_${cat}`;
    if (key.endsWith(suffix) && key.length > suffix.length) {
      return { base: key.slice(0, -suffix.length), category: cat };
    }
  }
  return null;
}

const _cldrCache = new Map<string, Set<PluralCategory>>();

/**
 * The CLDR cardinal plural categories a language actually uses, via the built-in
 * Intl.PluralRules. e.g. en → {one, other}; zh/id → {other}; ru → {one, few, many, other}.
 * Falls back to {one, other} if the runtime can't resolve the locale.
 */
export function cldrCategories(langCode: string): Set<PluralCategory> {
  const cached = _cldrCache.get(langCode);
  if (cached) return cached;
  let cats: Set<PluralCategory>;
  try {
    const resolved = new Intl.PluralRules(langCode).resolvedOptions().pluralCategories;
    cats = new Set(resolved.filter((c): c is PluralCategory => (PLURAL_SUFFIXES as readonly string[]).includes(c)));
    if (cats.size === 0) cats = new Set<PluralCategory>(["one", "other"]);
  } catch {
    cats = new Set<PluralCategory>(["one", "other"]);
  }
  _cldrCache.set(langCode, cats);
  return cats;
}

// ---------------------------------------------------------------------------
// Placeholder + HTML integrity
// ---------------------------------------------------------------------------

/** Multiset of `{{var}}` interpolation tokens (by variable name, trimmed). */
export function placeholders(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    // i18next allows `{{var, format}}` — compare on the variable name only.
    const name = m[1].split(",")[0].trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** Multiset of HTML tags (`<strong>`, `</strong>`, `<code/>`…) verbatim. */
export function htmlTags(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const tag = m[0].toLowerCase().replace(/\s+/g, " ");
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

function multisetDiff(base: Map<string, number>, other: Map<string, number>): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [tok, n] of base) {
    const o = other.get(tok) ?? 0;
    for (let i = 0; i < n - o; i++) missing.push(tok);
  }
  for (const [tok, n] of other) {
    const b = base.get(tok) ?? 0;
    for (let i = 0; i < n - b; i++) extra.push(tok);
  }
  return { missing, extra };
}

// ---------------------------------------------------------------------------
// Best-effort line lookup (for teaching error messages)
// ---------------------------------------------------------------------------

/**
 * Best-effort: find the 1-based line of a leaf key in the raw JSON text by
 * locating its last path segment as `"segment":`. Ambiguous keys resolve to the
 * first match; returns undefined if not found. Good enough to point a
 * contributor at the right area — never load-bearing for correctness.
 */
export function findKeyLine(rawText: string, dotPath: string): number | undefined {
  const leaf = dotPath.split(".").pop() ?? dotPath;
  const needle = `"${leaf}"`;
  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return undefined;
}

/** Levenshtein distance, capped — for "did you mean?" suggestions on extra keys. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 4) return 99;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Closest base-key suggestion for a typo'd extra key, or undefined. */
export function suggestKey(extra: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = 3; // only suggest for close typos
  for (const c of candidates) {
    const d = levenshtein(extra, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Namespace / directory discovery
// ---------------------------------------------------------------------------

export function listLangDirs(): string[] {
  return readdirSync(LOCALES_DIR).filter((name) => {
    try {
      return statSync(join(LOCALES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function listNamespaces(lang: string): string[] {
  return readdirSync(join(LOCALES_DIR, lang))
    .filter((f) => f.endsWith(".json") && !RESERVED_FILES.has(f))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

export interface LoadedNs {
  tree: JsonNode | null;
  raw: string;
  /** JSON parse error message, if the file is malformed. */
  parseError?: string;
}

export function loadNs(lang: string, ns: string): LoadedNs {
  const path = join(LOCALES_DIR, lang, `${ns}.json`);
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { tree: null, raw: "", parseError: `cannot read file: ${(e as Error).message}` };
  }
  try {
    return { tree: JSON.parse(raw) as JsonNode, raw };
  } catch (e) {
    return { tree: null, raw, parseError: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Diagnostics model
// ---------------------------------------------------------------------------

export type IssueKind =
  | "malformed" // file isn't valid JSON — hard error
  | "extra_key" // key not present in English — hard error
  | "extra_ns" // namespace not present in English — hard error
  | "missing_ns" // namespace absent — warning (falls back to English)
  | "missing_key" // key absent or empty — warning (falls back to English)
  | "placeholder" // {{var}} mismatch — hard error
  | "html" // HTML tag mismatch / imbalance — hard error
  | "plural"; // unusual plural category for the language — warning only

export interface Issue {
  lang: string;
  ns: string;
  key?: string;
  kind: IssueKind;
  /** true = hard failure (blocks build/CI), false = warning (partial ships). */
  hard: boolean;
  message: string;
  enValue?: string;
  value?: string;
  line?: number;
  suggestion?: string;
}

export interface NamespaceReport {
  ns: string;
  totalKeys: number;
  translatedKeys: number; // present AND non-empty
  issues: Issue[];
}

export interface LangReport {
  lang: string;
  namespaces: NamespaceReport[];
  issues: Issue[]; // flattened, all namespaces + ns-level (missing/extra ns)
  totalKeys: number;
  translatedKeys: number;
  completeness: number; // 0..1
  hardErrors: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Core comparison
// ---------------------------------------------------------------------------

export interface BaseIndex {
  namespaces: string[];
  keys: Map<string, Map<string, string>>; // ns -> (dotpath -> value)
}

/** Build the English superset index once, reuse across every language. */
export function buildBaseIndex(): BaseIndex {
  const namespaces = listNamespaces(BASE_LANG);
  const keys = new Map<string, Map<string, string>>();
  for (const ns of namespaces) {
    const { tree } = loadNs(BASE_LANG, ns);
    keys.set(ns, tree ? flatten(tree) : new Map());
  }
  return { namespaces, keys };
}

/**
 * Compare one language against the English base index. `emptyIsMissing` treats
 * `""` values as untranslated (the scaffold convention) — they count as missing
 * (warning) rather than translated.
 */
export function compareLang(lang: string, base: BaseIndex, opts: { emptyIsMissing?: boolean } = {}): LangReport {
  const emptyIsMissing = opts.emptyIsMissing ?? true;
  const nsList = listNamespaces(lang);
  const langCats = cldrCategories(lang);
  const nsReports: NamespaceReport[] = [];
  const flatIssues: Issue[] = [];

  // Missing namespaces (warning) + extra namespaces (hard error).
  for (const ns of base.namespaces) {
    if (!nsList.includes(ns)) {
      flatIssues.push({
        lang,
        ns,
        kind: "missing_ns",
        hard: false,
        message: `namespace "${ns}" is not translated yet (falls back to English)`,
      });
    }
  }
  for (const ns of nsList) {
    if (!base.namespaces.includes(ns)) {
      flatIssues.push({
        lang,
        ns,
        kind: "extra_ns",
        hard: true,
        message: `namespace "${ns}" does not exist in English — the app can never load it`,
      });
    }
  }

  for (const ns of base.namespaces) {
    const baseKeys = base.keys.get(ns) ?? new Map<string, string>();
    const report: NamespaceReport = { ns, totalKeys: baseKeys.size, translatedKeys: 0, issues: [] };

    if (!nsList.includes(ns)) {
      // Whole namespace missing — already recorded as missing_ns; 0 translated.
      nsReports.push(report);
      continue;
    }

    const loaded = loadNs(lang, ns);
    if (loaded.parseError) {
      const issue: Issue = {
        lang,
        ns,
        kind: "malformed",
        hard: true,
        message: `this file is not valid JSON, so it can't be read at all: ${loaded.parseError}`,
      };
      report.issues.push(issue);
      flatIssues.push(issue);
      nsReports.push(report);
      continue;
    }

    const targetKeys = loaded.tree ? flatten(loaded.tree) : new Map<string, string>();

    // Precompute the union of allowed plural categories for this ns:
    // English's used categories ∪ the language's CLDR categories. This grandfathers
    // existing `_one`-everywhere files while allowing complex-plural languages to
    // declare `_few`/`_many` where CLDR says they need them.
    const baseBases = new Map<string, Set<PluralCategory>>(); // plural base -> categories seen in English
    for (const k of baseKeys.keys()) {
      const p = splitPlural(k);
      if (p) {
        const set = baseBases.get(p.base) ?? new Set<PluralCategory>();
        set.add(p.category);
        baseBases.set(p.base, set);
      }
    }

    // Missing keys (warning) / empty values (warning) + placeholder & HTML checks.
    for (const [k, enVal] of baseKeys) {
      const has = targetKeys.has(k);
      const val = targetKeys.get(k) ?? "";
      const translated = has && (!emptyIsMissing || val.trim() !== "");
      if (translated) report.translatedKeys++;

      if (!has || (emptyIsMissing && val.trim() === "")) {
        const issue: Issue = {
          lang,
          ns,
          key: k,
          kind: "missing_key",
          hard: false,
          message: `not translated yet (shows English)`,
          enValue: enVal,
        };
        report.issues.push(issue);
        flatIssues.push(issue);
        continue; // don't run integrity checks on an untranslated value
      }

      // Placeholder integrity — a missing/invented {{var}} renders broken text.
      const phDiff = multisetDiff(placeholders(enVal), placeholders(val));
      if (phDiff.missing.length || phDiff.extra.length) {
        const parts: string[] = [];
        if (phDiff.missing.length) parts.push(`missing ${phDiff.missing.map((v) => `{{${v}}}`).join(", ")}`);
        if (phDiff.extra.length) parts.push(`unexpected ${phDiff.extra.map((v) => `{{${v}}}`).join(", ")}`);
        const issue: Issue = {
          lang,
          ns,
          key: k,
          kind: "placeholder",
          hard: true,
          message: `placeholder mismatch — ${parts.join("; ")}. Copy every {{…}} exactly; the app fills them with live values`,
          enValue: enVal,
          value: val,
          line: findKeyLine(loaded.raw, k),
        };
        report.issues.push(issue);
        flatIssues.push(issue);
      }

      // HTML tag integrity — escaping is off (escapeValue:false), so a stray or
      // unbalanced tag is both a layout and an XSS-shaped hazard.
      const tagDiff = multisetDiff(htmlTags(enVal), htmlTags(val));
      if (tagDiff.missing.length || tagDiff.extra.length) {
        const parts: string[] = [];
        if (tagDiff.missing.length) parts.push(`missing ${[...new Set(tagDiff.missing)].join(", ")}`);
        if (tagDiff.extra.length) parts.push(`unexpected ${[...new Set(tagDiff.extra)].join(", ")}`);
        const issue: Issue = {
          lang,
          ns,
          key: k,
          kind: "html",
          hard: true,
          message: `HTML tag mismatch — ${parts.join("; ")}. Keep tags like <strong> paired exactly as in English`,
          enValue: enVal,
          value: val,
          line: findKeyLine(loaded.raw, k),
        };
        report.issues.push(issue);
        flatIssues.push(issue);
      }
    }

    // Extra keys (hard error) + plural-category sanity (warning only).
    const allowedPlural = new Set<PluralCategory>([...langCats]);
    for (const k of targetKeys.keys()) {
      if (baseKeys.has(k)) continue;
      const p = splitPlural(k);
      if (p && baseBases.has(p.base)) {
        // It's a plural variant of a known base. Allowed if the category is in
        // English's set OR the language's CLDR set. Otherwise warn (never hard-
        // fail) — a genuinely useful form we didn't anticipate shouldn't block.
        const enCats = baseBases.get(p.base)!;
        if (enCats.has(p.category) || allowedPlural.has(p.category)) {
          report.translatedKeys++; // it's a real translated plural form
          continue;
        }
        const issue: Issue = {
          lang,
          ns,
          key: k,
          kind: "plural",
          hard: false,
          message: `plural form "_${p.category}" is unusual for ${lang} (CLDR: ${[...langCats].map((c) => `_${c}`).join(", ")}). Kept, but double-check it's needed`,
          value: targetKeys.get(k),
          line: findKeyLine(loaded.raw, k),
        };
        report.issues.push(issue);
        flatIssues.push(issue);
        continue;
      }
      // A true extra key — dead weight the app can never display.
      const issue: Issue = {
        lang,
        ns,
        key: k,
        kind: "extra_key",
        hard: true,
        message: `key does not exist in English — the app can never display it`,
        value: targetKeys.get(k),
        line: findKeyLine(loaded.raw, k),
        suggestion: suggestKey(k, baseKeys.keys()),
      };
      report.issues.push(issue);
      flatIssues.push(issue);
    }

    nsReports.push(report);
  }

  const totalKeys = nsReports.reduce((s, r) => s + r.totalKeys, 0);
  const translatedKeys = nsReports.reduce((s, r) => s + r.translatedKeys, 0);
  const hardErrors = flatIssues.filter((i) => i.hard).length;
  const warnings = flatIssues.filter((i) => !i.hard).length;

  return {
    lang,
    namespaces: nsReports,
    issues: flatIssues,
    totalKeys,
    translatedKeys,
    completeness: totalKeys === 0 ? 0 : translatedKeys / totalKeys,
    hardErrors,
    warnings,
  };
}

/** Compare every non-English language directory. */
export function compareAll(opts: { emptyIsMissing?: boolean } = {}): LangReport[] {
  const base = buildBaseIndex();
  return listLangDirs()
    .filter((l) => l !== BASE_LANG)
    .sort()
    .map((l) => compareLang(l, base, opts));
}

/** Convenience: percent string for display. */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

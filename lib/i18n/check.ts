// lib/i18n/check.ts
// Run: bun run i18n:check
// Validates every locales/<lang>/<ns>.json against the English superset.
// Warns on missing keys, errors on extra keys or malformed files.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(process.cwd(), "public", "locales");
const BASE_LANG = "en";

type JsonNode = string | { [k: string]: JsonNode } | JsonNode[];

function collectKeys(node: JsonNode, prefix = ""): Set<string> {
  const keys = new Set<string>();
  if (typeof node === "string") {
    keys.add(prefix);
    return keys;
  }
  if (Array.isArray(node)) {
    // Arrays aren't used as translation containers — treat whole path as leaf.
    keys.add(prefix);
    return keys;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const next = prefix ? `${prefix}.${k}` : k;
      for (const inner of collectKeys(v, next)) keys.add(inner);
    }
  }
  return keys;
}

function listLangDirs(): string[] {
  return readdirSync(LOCALES_DIR).filter((name) => {
    const full = join(LOCALES_DIR, name);
    return statSync(full).isDirectory();
  });
}

function listNamespaces(lang: string): string[] {
  return readdirSync(join(LOCALES_DIR, lang))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

function loadNs(lang: string, ns: string): JsonNode {
  const path = join(LOCALES_DIR, lang, `${ns}.json`);
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Malformed JSON at ${path}: ${(e as Error).message}`);
  }
}

function main(): number {
  const baseDirs = listLangDirs();
  if (!baseDirs.includes(BASE_LANG)) {
    console.error(`[i18n:check] base language "${BASE_LANG}" not found`);
    return 1;
  }

  const baseNamespaces = listNamespaces(BASE_LANG);
  const baseKeys = new Map<string, Set<string>>();
  for (const ns of baseNamespaces) {
    baseKeys.set(ns, collectKeys(loadNs(BASE_LANG, ns)));
  }

  let errors = 0;
  let warnings = 0;

  for (const lang of baseDirs) {
    if (lang === BASE_LANG) continue;
    const nsList = listNamespaces(lang);

    // Warn on missing namespaces.
    for (const ns of baseNamespaces) {
      if (!nsList.includes(ns)) {
        console.warn(`[warn] ${lang}: missing namespace "${ns}"`);
        warnings++;
      }
    }

    // Error on extra namespaces.
    for (const ns of nsList) {
      if (!baseNamespaces.includes(ns)) {
        console.error(`[err]  ${lang}: extra namespace "${ns}" not in ${BASE_LANG}`);
        errors++;
      }
    }

    // Compare keys in shared namespaces.
    for (const ns of nsList) {
      if (!baseNamespaces.includes(ns)) continue;
      let tree: JsonNode;
      try {
        tree = loadNs(lang, ns);
      } catch (e) {
        console.error(`[err]  ${(e as Error).message}`);
        errors++;
        continue;
      }
      const keys = collectKeys(tree);
      const base = baseKeys.get(ns)!;

      for (const k of base) {
        if (!keys.has(k)) {
          console.warn(`[warn] ${lang}/${ns}: missing key "${k}"`);
          warnings++;
        }
      }
      for (const k of keys) {
        if (!base.has(k)) {
          console.error(`[err]  ${lang}/${ns}: extra key "${k}" not in ${BASE_LANG}`);
          errors++;
        }
      }
    }
  }

  console.log(`\n[i18n:check] ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

process.exit(main());

#!/usr/bin/env bun
// scripts-dev/lang.ts
//
// QManager translation CLI — the contributor + maintainer front-end to the
// language-pack pipeline. Zero runtime dependencies (Bun stdlib + node builtins
// only), so a contributor can clone and run `bun run lang check` with NO
// `bun install`. This file lives in scripts-dev/ and is NEVER shipped to the
// device (it's excluded from the app tsconfig and the firmware tarball).
//
// Verbs
//   Contributor:
//     scaffold <code>   Start a new language: writes English-shaped skeletons
//                       with empty ("") values + a _pack.json metadata stub.
//     status [<code>]   Completeness table; `--todo` lists untranslated keys.
//     check  [<code>]   Validate against English; teaching errors. `--ci` = JSON.
//     fmt    <code>     Re-order keys to English order + canonical formatting.
//   Maintainer:
//     build  <code>     Package a validated pack (.tar.gz + .sha256 + _pack.json).
//     publish <code>    Upload to the `language-packs` GitHub release + patch manifest.
//
// English (`en`) is always the source of truth.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import {
  LOCALES_DIR,
  BASE_LANG,
  buildBaseIndex,
  compareLang,
  compareAll,
  listNamespaces,
  loadNs,
  flatten,
  pct,
  type JsonNode,
  type Issue,
  type LangReport,
} from "../lib/i18n/pack";

// ---------------------------------------------------------------------------
// Tiny ANSI + arg helpers (no deps)
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
/** Positional args = anything not a --flag and not a flag's value. */
function positionals(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (valueFlags.includes(a.slice(2))) i++; // skip its value
      continue;
    }
    out.push(a);
  }
  return out;
}

function fail(msg: string): never {
  console.error(c.red(`✗ ${msg}`));
  process.exit(1);
}

const NS_ORDER_HINT = "common"; // English defines the true order; this is only a fallback

// ---------------------------------------------------------------------------
// JSON helpers preserving English key order
// ---------------------------------------------------------------------------

/** Deep-clone the English tree, replacing every string leaf with `filler`. */
function skeletonize(node: JsonNode, filler: string): JsonNode {
  if (typeof node === "string") return filler;
  if (Array.isArray(node)) return node.map((n) => skeletonize(n, filler));
  const out: { [k: string]: JsonNode } = {};
  for (const [k, v] of Object.entries(node)) out[k] = skeletonize(v, filler);
  return out;
}

/**
 * Reorder `target`'s keys to match `base`'s order recursively, carrying target
 * values. Keys present in target but not base are appended at the end of their
 * object (kept visible so `fmt` never silently drops a contributor's work — the
 * checker will flag them as extras).
 */
function reorderLike(base: JsonNode, target: JsonNode): JsonNode {
  if (typeof base === "string" || Array.isArray(base)) return target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) return target;
  const t = target as { [k: string]: JsonNode };
  const out: { [k: string]: JsonNode } = {};
  for (const k of Object.keys(base)) {
    if (k in t) out[k] = reorderLike((base as { [k: string]: JsonNode })[k], t[k]);
  }
  for (const k of Object.keys(t)) {
    if (!(k in out)) out[k] = t[k]; // extras last
  }
  return out;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function localeDir(code: string): string {
  return join(LOCALES_DIR, code);
}

// ---------------------------------------------------------------------------
// scaffold
// ---------------------------------------------------------------------------

function cmdScaffold(args: string[]): void {
  const pos = positionals(args, ["native-name", "english-name"]);
  const code = pos[0];
  if (!code) fail("usage: bun run lang scaffold <code> [--native-name …] [--english-name …] [--rtl]");
  if (!/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
    fail(`"${code}" doesn't look like a language code (expected BCP-47, e.g. pt-BR, de, ru)`);
  }
  const dir = localeDir(code);
  if (existsSync(dir)) fail(`public/locales/${code}/ already exists — use \`bun run lang status ${code}\` to see what's left`);

  const nativeName = flagValue(args, "native-name") ?? code;
  const englishName = flagValue(args, "english-name") ?? code;
  const rtl = hasFlag(args, "rtl");

  const baseNs = listNamespaces(BASE_LANG);
  mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const ns of baseNs) {
    const { tree } = loadNs(BASE_LANG, ns);
    if (!tree) fail(`English namespace "${ns}" is unreadable — cannot scaffold`);
    total += flatten(tree).size;
    writeJson(join(dir, `${ns}.json`), skeletonize(tree, ""));
  }

  // Hand-authored subset of _pack.json (build fills in the computed fields).
  writeJson(join(dir, "_pack.json"), {
    code,
    native_name: nativeName,
    english_name: englishName,
    rtl,
    contributors: [],
  });

  console.log(c.green(`✓ Scaffolded ${code} (${baseNs.length} namespaces, ${total} strings to translate)`));
  console.log(`  Files: ${c.dim(`public/locales/${code}/{${baseNs.join(",")},_pack}.json`)}`);
  console.log(`  Every value starts empty ("") — fill them in, English shows until you do.`);
  console.log(`  Add your name to the "contributors" list in _pack.json.`);
  console.log(`  Track progress:  ${c.bold(`bun run lang status ${code} --todo`)}`);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function cmdStatus(args: string[]): void {
  const pos = positionals(args, ["ns"]);
  const code = pos[0];
  const nsFilter = flagValue(args, "ns");
  const todo = hasFlag(args, "todo");
  const base = buildBaseIndex();

  const codes = code ? [code] : readdirSync(LOCALES_DIR).filter((d) => d !== BASE_LANG && existsSync(join(LOCALES_DIR, d, `${NS_ORDER_HINT}.json`)));
  if (code && !existsSync(localeDir(code))) fail(`no such language: public/locales/${code}/ (start one with \`bun run lang scaffold ${code}\`)`);

  for (const lang of codes) {
    const r = compareLang(lang, base, { emptyIsMissing: true });
    console.log(c.bold(`\n${lang} — ${pct(r.completeness)} translated (${r.translatedKeys}/${r.totalKeys})`));
    for (const nr of r.namespaces) {
      if (nsFilter && nr.ns !== nsFilter) continue;
      const done = nr.translatedKeys === nr.totalKeys;
      const mark = done ? c.green("✓") : c.yellow("⚠");
      console.log(`  ${mark} ${nr.ns.padEnd(14)} ${nr.translatedKeys}/${nr.totalKeys}`);
    }
    if (todo) {
      const missing = r.issues.filter((i) => i.kind === "missing_key" && (!nsFilter || i.ns === nsFilter));
      if (missing.length) {
        console.log(c.dim(`\n  Untranslated (${missing.length}):`));
        for (const i of missing) {
          console.log(`    ${i.ns}/${i.key}  ${c.dim("= " + JSON.stringify(i.enValue))}`);
        }
      } else {
        console.log(c.green("\n  Nothing left — every string is translated."));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function ciJson(reports: LangReport[]): void {
  const ok = reports.every((r) => r.hardErrors === 0);
  const payload = {
    version: 1,
    ok,
    results: reports.map((r) => ({
      lang: r.lang,
      completeness: r.completeness,
      totalKeys: r.totalKeys,
      translatedKeys: r.translatedKeys,
      hardErrors: r.hardErrors,
      warnings: r.warnings,
      namespaces: r.namespaces.map((n) => ({ ns: n.ns, totalKeys: n.totalKeys, translatedKeys: n.translatedKeys })),
      issues: r.issues.map((i) => ({
        lang: i.lang,
        ns: i.ns,
        key: i.key ?? null,
        kind: i.kind,
        hard: i.hard,
        message: i.message,
        enValue: i.enValue ?? null,
        value: i.value ?? null,
        line: i.line ?? null,
        suggestion: i.suggestion ?? null,
      })),
    })),
  };
  // stdout gets ONLY the JSON (contract with CI). Human logs, if any, go to stderr.
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

function printTeaching(issue: Issue): void {
  const loc = issue.line ? c.dim(`  (line ${issue.line})`) : "";
  console.log(`    ${c.red("✗")} ${issue.ns}/${issue.key ?? ""}${loc}`);
  if (issue.enValue !== undefined) console.log(`        English:  ${JSON.stringify(issue.enValue)}`);
  if (issue.value !== undefined) console.log(`        Yours:    ${JSON.stringify(issue.value)}`);
  console.log(`        ${issue.message}${issue.suggestion ? c.yellow(`  → did you mean "${issue.suggestion}"?`) : ""}`);
}

function cmdCheck(args: string[]): void {
  const ci = hasFlag(args, "ci");
  const all = hasFlag(args, "all");
  const pos = positionals(args, []);
  const code = pos[0];

  // emptyIsMissing drives completeness in the contributor context; strict mode
  // (CI on English changes) also treats empties as missing warnings.
  const opts = { emptyIsMissing: true };

  let reports: LangReport[];
  if (all || !code) {
    reports = compareAll(opts);
  } else {
    if (!existsSync(localeDir(code))) fail(`no such language: public/locales/${code}/`);
    reports = [compareLang(code, buildBaseIndex(), opts)];
  }

  if (ci) return ciJson(reports);

  let anyHard = false;
  for (const r of reports) {
    const hard = r.issues.filter((i) => i.hard);
    if (hard.length) anyHard = true;
    console.log(c.bold(`\nChecking ${r.lang} against ${BASE_LANG} (${r.namespaces.length} namespaces, ${r.totalKeys} keys)`));
    for (const nr of r.namespaces) {
      const nsHard = nr.issues.filter((i) => i.hard).length;
      const done = nr.translatedKeys === nr.totalKeys;
      const mark = nsHard ? c.red("✗") : done ? c.green("✓") : c.yellow("⚠");
      const note = nsHard ? c.red(`${nsHard} problem(s)`) : done ? "" : c.yellow(`${nr.totalKeys - nr.translatedKeys} untranslated`);
      console.log(`  ${mark} ${nr.ns.padEnd(14)} ${nr.translatedKeys}/${nr.totalKeys}  ${note}`);
    }
    if (hard.length) {
      console.log(c.red(`\n  Problems to fix:`));
      for (const i of hard) printTeaching(i);
      console.log(c.red(`\n  FAIL — fix the above, then run \`bun run lang check ${r.lang}\` again.`));
    } else if (r.completeness >= 1) {
      console.log(c.green(`\n  PASS — ${r.lang} is 100% translated and structurally valid.`));
    } else {
      console.log(c.green(`\n  PASS (partial) — ${r.lang} is ${pct(r.completeness)} translated, no structural problems.`));
      console.log(c.dim(`  Untranslated strings show in English. See what's left:  bun run lang status ${r.lang} --todo`));
    }
  }
  // Partial translations are fine (they fall back to English); only structural
  // hard errors fail the command.
  process.exit(anyHard ? 1 : 0);
}

// ---------------------------------------------------------------------------
// fmt
// ---------------------------------------------------------------------------

function cmdFmt(args: string[]): void {
  const code = positionals(args, [])[0];
  if (!code) fail("usage: bun run lang fmt <code>");
  if (!existsSync(localeDir(code))) fail(`no such language: public/locales/${code}/`);
  const baseNs = listNamespaces(BASE_LANG);
  let changed = 0;
  for (const ns of baseNs) {
    const targetPath = join(localeDir(code), `${ns}.json`);
    if (!existsSync(targetPath)) continue;
    const { tree: baseTree } = loadNs(BASE_LANG, ns);
    const loaded = loadNs(code, ns);
    if (loaded.parseError || !loaded.tree || !baseTree) {
      console.log(c.yellow(`  ⚠ skipped ${ns}.json (not valid JSON)`));
      continue;
    }
    const reordered = reorderLike(baseTree, loaded.tree);
    const next = JSON.stringify(reordered, null, 2) + "\n";
    if (next !== loaded.raw.replace(/\r\n/g, "\n")) {
      writeFileSync(targetPath, next, "utf8");
      changed++;
    }
  }
  console.log(c.green(`✓ fmt ${code}: ${changed} file(s) reformatted to English key order.`));
}

// ---------------------------------------------------------------------------
// build (maintainer)
// ---------------------------------------------------------------------------

const PUBLISH_FLOOR = 0.4;
const RELEASE_TAG = "language-packs";
const MANIFEST_PATH = join(process.cwd(), "language-packs", "manifest.json");
const DIST_DIR = join(process.cwd(), "dist", "lang");

function todayVersion(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** Midnight-UTC ISO for a YYYY.MM.DD version (deterministic); else wall-clock. */
function versionToIso(version: string): string {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(version);
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z` : new Date().toISOString();
}

/** Strip empty-string leaves so the shipped pack falls back to English at runtime. */
function stripEmpty(node: JsonNode): JsonNode {
  if (typeof node === "string" || Array.isArray(node)) return node;
  const out: { [k: string]: JsonNode } = {};
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") {
      if (v.trim() !== "") out[k] = v;
    } else {
      const child = stripEmpty(v);
      if (typeof child !== "object" || Array.isArray(child) || Object.keys(child).length > 0) out[k] = child;
    }
  }
  return out;
}

interface BuildResult {
  code: string;
  version: string;
  tarball: string;
  sha256: string;
  sizeBytes: number;
  report: LangReport;
}

// --- Deterministic gzipped ustar tar writer (no external `tar` dependency) ----
// Fixed mtime/mode/uid make the archive byte-stable → reproducible sha256, and
// avoid GNU tar's Windows `D:\` host:path parsing. Produces a standard POSIX
// ustar archive that GNU tar, bsdtar, AND the device's BusyBox tar all extract.

function writeOctal(buf: Buffer, off: number, val: number, len: number): void {
  const s = val.toString(8).padStart(len - 1, "0").slice(-(len - 1)) + "\0";
  buf.write(s, off, "ascii");
}

function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, "utf8");
  writeOctal(h, 100, 0o644, 8); // mode
  writeOctal(h, 108, 0, 8); // uid
  writeOctal(h, 116, 0, 8); // gid
  writeOctal(h, 124, size, 12); // size
  writeOctal(h, 136, 0, 12); // mtime (fixed → deterministic)
  h.write("        ", 148, 8, "ascii"); // chksum placeholder = 8 spaces
  h.write("0", 156, 1, "ascii"); // typeflag = normal file
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0").slice(-6) + "\0 ", 148, 8, "ascii");
  return h;
}

function makeTarGz(members: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const m of members) {
    const content = Buffer.from(m.content, "utf8");
    chunks.push(tarHeader(m.name, content.length));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0)); // two zero blocks = archive EOF
  return gzipSync(Buffer.concat(chunks));
}

function cmdBuild(args: string[]): BuildResult {
  const code = positionals(args, ["out", "version"])[0];
  if (!code) fail("usage: bun run lang build <code> [--version YYYY.MM.DD] [--out dir]");
  if (!existsSync(localeDir(code))) fail(`no such language: public/locales/${code}/`);

  const report = compareLang(code, buildBaseIndex(), { emptyIsMissing: true });
  if (report.hardErrors > 0) {
    fail(`${code} has ${report.hardErrors} structural error(s) — run \`bun run lang check ${code}\`. Packs must be valid; there is no --skip-check.`);
  }

  const packStubPath = join(localeDir(code), "_pack.json");
  const stub = existsSync(packStubPath) ? (JSON.parse(readFileSync(packStubPath, "utf8")) as Record<string, unknown>) : {};
  const version = flagValue(args, "version") ?? todayVersion();
  const outDir = flagValue(args, "out") ?? DIST_DIR;
  mkdirSync(outDir, { recursive: true });

  // Assemble pack members in memory (flat layout: files at archive root),
  // namespace JSONs with empty values stripped so the shipped pack falls back to
  // English at runtime instead of rendering blanks.
  const baseNs = listNamespaces(BASE_LANG);
  const nsMembers: { name: string; content: string }[] = [];
  for (const ns of baseNs) {
    const loaded = loadNs(code, ns);
    if (!loaded.tree) continue;
    nsMembers.push({ name: `${ns}.json`, content: JSON.stringify(stripEmpty(loaded.tree), null, 2) + "\n" });
  }

  // Computed _pack.json (goes first in the archive).
  const packMeta = {
    pack_format: 1,
    code,
    native_name: stub.native_name ?? code,
    english_name: stub.english_name ?? code,
    rtl: stub.rtl ?? false,
    version,
    app_min_version: readAppVersion(),
    namespaces: baseNs,
    completeness: {
      overall: round2(report.completeness),
      per_namespace: Object.fromEntries(report.namespaces.map((n) => [n.ns, round2(n.totalKeys ? n.translatedKeys / n.totalKeys : 0)])),
    },
    key_count: { translated: report.translatedKeys, total: report.totalKeys },
    // Derived from the dated version (not wall-clock) so a given version rebuilds
    // byte-for-byte → reproducible sha256 that a reviewer can independently verify.
    generated_at: versionToIso(version),
    contributors: Array.isArray(stub.contributors) ? stub.contributors : [],
  };
  const members = [{ name: "_pack.json", content: JSON.stringify(packMeta, null, 2) + "\n" }, ...nsMembers];

  const tarball = join(outDir, `qmanager-lang-${code}-${version}.tar.gz`);
  const gz = makeTarGz(members);
  writeFileSync(tarball, gz);
  const sha256 = createHash("sha256").update(gz).digest("hex");
  writeFileSync(`${tarball}.sha256`, `${sha256}  qmanager-lang-${code}-${version}.tar.gz\n`, "utf8");

  const belowFloor = report.completeness < PUBLISH_FLOOR;
  console.log(c.green(`✓ Built ${tarball}`));
  console.log(`  version ${version} · ${pct(report.completeness)} translated · ${gz.length} bytes`);
  console.log(`  sha256 ${sha256}`);
  if (belowFloor) console.log(c.yellow(`  ⚠ below the ${pct(PUBLISH_FLOOR)} publish floor — \`publish\` will refuse without --force-floor`));

  return { code, version, tarball, sha256, sizeBytes: gz.length, report };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    return String(pkg.version ?? "0.0.0").replace(/^v/, "").replace(/-draft$/, "");
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// publish (maintainer)
// ---------------------------------------------------------------------------

function cmdPublish(args: string[]): void {
  const dryRun = hasFlag(args, "dry-run");
  const forceFloor = hasFlag(args, "force-floor");
  const built = cmdBuild(args); // build first (validates, refuses on hard errors)

  if (built.report.completeness < PUBLISH_FLOOR && !forceFloor) {
    fail(`${built.code} is only ${pct(built.report.completeness)} translated (floor ${pct(PUBLISH_FLOOR)}). Use --force-floor to override loudly.`);
  }

  const extraContributors = (flagValue(args, "contributors") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const assetUrl = `https://github.com/dr-dolomite/QManager-RM520N/releases/download/${RELEASE_TAG}/qmanager-lang-${built.code}-${built.version}.tar.gz`;

  // Patch the manifest (idempotent by code).
  const manifest = existsSync(MANIFEST_PATH)
    ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { manifest_version: number; app_repo?: string; packs: Record<string, unknown>[] })
    : { manifest_version: 1, app_repo: "https://github.com/dr-dolomite/QManager-RM520N", packs: [] };

  const packStub = JSON.parse(readFileSync(join(localeDir(built.code), "_pack.json"), "utf8")) as Record<string, unknown>;
  const contributors = Array.from(new Set([...(Array.isArray(packStub.contributors) ? (packStub.contributors as string[]) : []), ...extraContributors]));

  const entry = {
    code: built.code,
    native_name: packStub.native_name ?? built.code,
    english_name: packStub.english_name ?? built.code,
    rtl: packStub.rtl ?? false,
    version: built.version,
    app_min_version: readAppVersion(),
    completeness: round2(built.report.completeness),
    size_bytes: built.sizeBytes,
    sha256: built.sha256,
    url: assetUrl,
    contributors,
  };
  manifest.packs = [...manifest.packs.filter((p) => p.code !== built.code), entry].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  manifest.generated_at = new Date().toISOString();

  if (dryRun) {
    console.log(c.yellow(`\n[dry-run] Would upload to release "${RELEASE_TAG}":`));
    console.log(`  gh release upload ${RELEASE_TAG} ${built.tarball} ${built.tarball}.sha256 --clobber`);
    console.log(c.yellow(`[dry-run] Would patch manifest entry:`));
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  // Ensure the persistent release exists (out of the OTA feed: --latest=false).
  ensureRelease();
  run("gh", ["release", "upload", RELEASE_TAG, built.tarball, `${built.tarball}.sha256`, "--clobber"]);

  // Manifest is also a release asset so the device can fetch a single index.
  writeJson(MANIFEST_PATH, manifest);
  run("gh", ["release", "upload", RELEASE_TAG, MANIFEST_PATH, "--clobber"]);

  console.log(c.green(`\n✓ Published ${built.code} ${built.version} to release "${RELEASE_TAG}" and patched the manifest.`));
  console.log(c.dim(`  Commit language-packs/manifest.json to record the new pack in the repo.`));
}

function ensureRelease(): void {
  try {
    execFileSync("gh", ["release", "view", RELEASE_TAG], { stdio: "pipe" });
  } catch {
    console.log(c.dim(`  creating persistent release "${RELEASE_TAG}" (--latest=false)…`));
    run("gh", ["release", "create", RELEASE_TAG, "--latest=false", "--title", "Language Packs", "--notes", "Community language packs. Not a firmware release."]);
  }
}

function run(cmd: string, argv: string[]): void {
  try {
    execFileSync(cmd, argv, { stdio: "inherit" });
  } catch (e) {
    fail(`${cmd} ${argv.join(" ")} failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

function usage(): void {
  console.log(`QManager translation CLI

Contributor:
  bun run lang scaffold <code> [--native-name …] [--english-name …] [--rtl]
  bun run lang status  [<code>] [--todo] [--ns <namespace>]
  bun run lang check   [<code>] [--all] [--ci]
  bun run lang fmt     <code>

Maintainer:
  bun run lang build   <code> [--version YYYY.MM.DD] [--out dir]
  bun run lang publish <code> [--dry-run] [--contributors a,b] [--force-floor]

English (en) is the source of truth. New languages are NOT auto-registered in the
app bundle — that stays a maintainer/downloader decision.`);
}

const [sub, ...rest] = process.argv.slice(2);
switch (sub) {
  case "scaffold": cmdScaffold(rest); break;
  case "status": cmdStatus(rest); break;
  case "check": cmdCheck(rest); break;
  case "fmt": cmdFmt(rest); break;
  case "build": cmdBuild(rest); break;
  case "publish": cmdPublish(rest); break;
  case undefined:
  case "help":
  case "--help":
  case "-h": usage(); break;
  default:
    console.error(c.red(`unknown command: ${sub}`));
    usage();
    process.exit(1);
}

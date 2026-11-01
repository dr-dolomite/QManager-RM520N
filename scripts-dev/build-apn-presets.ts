#!/usr/bin/env bun
// =============================================================================
// build-apn-presets — generate public/data/apn-presets.json
// =============================================================================
// The APN field on /cellular/settings suggests the internet APNs known for the
// SIM's home network, the way Android's APN screen does. The data comes from
// LineageOS's android_vendor_apn (Apache-2.0): one apns-conf XML per country,
// about 3,900 entries and 1.3 MB. QManager needs a small slice of that, so this
// script downloads a PINNED commit, keeps only what the APN card can use, and
// writes a compact JSON (tens of KB). Only the JSON is committed.
//
// Kept: entries a data connection can use with nothing but the APN string:
//   - `type` includes `default` (or `*`): IMS, MMS, XCAP, SUPL-only dropped
//   - no `proxy` (WAP-era entries that only work through one)
//   - no `user` / `password` (the APN save sends no credentials)
//   - not `user_visible="false"` / `carrier_enabled="false"`
//   - the APN string passes the card's own validation pattern
// Fields kept: carrier label, apn, protocol (as pdp_type), MVNO flag.
//
// scripts-dev/apn-presets-overlay.json adds and removes entries by hand, for
// gaps the upstream data has (Smart Bro on Smart PH, which only Samsung's
// carrier files carry).
//
// Output shape (keys sorted, so the same SHA gives byte-identical output):
//   { "_source": {...}, "plmns": { "<mcc><mnc>": [row, ...] } }
//   row = [label, apn] | [label, apn, pdp] | [label, apn, pdp | "", 1]
//   (the trailing 1 marks an MVNO riding the host network)
//
//   bun run apn:update            # uses PINNED_SHA below
//   bun run apn:update <sha>      # try another commit, then pin it here
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = "LineageOS/android_vendor_apn";
const PINNED_SHA = "35d822d750556e09dafaa2950ea87e912b49eab1";
const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "public", "data", "apn-presets.json");
const OVERLAY = join(import.meta.dir, "apn-presets-overlay.json");

/** Mirrors APN_PATTERN in apn-settings-card.tsx: anything else cannot be saved. */
const APN_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const PDP: Record<string, string> = { IP: "ipv4", IPV6: "ipv6", IPV4V6: "ipv4v6" };

type Row = [string, string] | [string, string, string] | [string, string, string, 1];

interface Overlay {
  add?: Record<string, Row[]>;
  remove?: Record<string, string[]>;
}

const sha = process.argv[2] ?? PINNED_SHA;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The attributes of every <apn .../> element. The upstream files are validated against an XSD, so a tag scan is enough. */
function parseApns(xml: string): Record<string, string>[] {
  const body = xml.replace(/<!--[\s\S]*?-->/g, "");
  const out: Record<string, string>[] = [];
  for (const m of body.matchAll(/<apn\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    out.push(attrs);
  }
  return out;
}

function keep(a: Record<string, string>): boolean {
  if (!a.mcc || !a.mnc || !a.apn) return false;
  const types = (a.type ?? "default").split(",").map((t) => t.trim());
  if (!types.includes("default") && !types.includes("*")) return false;
  if (a.proxy) return false;
  if (a.user || a.password) return false;
  if (a.user_visible === "false" || a.carrier_enabled === "false") return false;
  return APN_PATTERN.test(a.apn);
}

function toRow(a: Record<string, string>): Row {
  const label = (a.carrier || a.apn).trim();
  const pdp = PDP[(a.protocol ?? "").toUpperCase()] ?? "";
  if (a.mvno_type) return [label, a.apn, pdp, 1];
  return pdp ? [label, a.apn, pdp] : [label, a.apn];
}

async function main() {
  const commit = await getJson<{ commit: { committer: { date: string } } }>(
    `https://api.github.com/repos/${REPO}/commits/${sha}`,
  );
  const tree = await getJson<{ tree: { path: string; type: string }[] }>(
    `https://api.github.com/repos/${REPO}/git/trees/${sha}`,
  );
  const files = tree.tree
    .filter((e) => e.type === "blob" && /^[A-Z]{2}\.xml$/.test(e.path))
    .map((e) => e.path)
    .sort();
  if (files.length === 0) throw new Error("no per-country XML files at that commit");

  const plmns = new Map<string, Row[]>();
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const xml = await getText(`https://raw.githubusercontent.com/${REPO}/${sha}/${file}`);
    for (const a of parseApns(xml)) {
      total++;
      if (!keep(a)) continue;
      const plmn = a.mcc + a.mnc;
      const row = toRow(a);
      const key = `${plmn}|${row[1].toLowerCase()}|${row[0].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rows = plmns.get(plmn) ?? [];
      rows.push(row);
      plmns.set(plmn, rows);
    }
  }

  const overlay = JSON.parse(readFileSync(OVERLAY, "utf8")) as Overlay;
  for (const [plmn, apns] of Object.entries(overlay.remove ?? {})) {
    const drop = new Set(apns.map((s) => s.toLowerCase()));
    const rows = (plmns.get(plmn) ?? []).filter((r) => !drop.has(r[1].toLowerCase()));
    if (rows.length) plmns.set(plmn, rows);
    else plmns.delete(plmn);
  }
  for (const [plmn, rows] of Object.entries(overlay.add ?? {})) {
    const list = plmns.get(plmn) ?? [];
    for (const row of rows) {
      if (!APN_PATTERN.test(row[1])) throw new Error(`overlay ${plmn}: invalid APN ${row[1]}`);
      if (!list.some((r) => r[1].toLowerCase() === row[1].toLowerCase())) list.push(row);
    }
    plmns.set(plmn, list);
  }

  // Host-network rows first, MVNO rows after; source order within each.
  const sorted: Record<string, Row[]> = {};
  for (const plmn of [...plmns.keys()].sort()) {
    const rows = plmns.get(plmn)!;
    sorted[plmn] = [...rows.filter((r) => r[3] !== 1), ...rows.filter((r) => r[3] === 1)];
  }

  const doc = {
    _source: {
      repo: `https://github.com/${REPO}`,
      commit: sha,
      date: commit.commit.committer.date,
      license: "Apache-2.0",
    },
    plmns: sorted,
  };
  const json = JSON.stringify(doc) + "\n";
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);

  const rows = Object.values(sorted).reduce((n, r) => n + r.length, 0);
  console.log(
    `apn-presets: ${files.length} files, ${total} entries -> ${Object.keys(sorted).length} PLMNs, ${rows} rows, ${json.length} bytes`,
  );
}

main().catch((err) => {
  console.error(`apn-presets: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

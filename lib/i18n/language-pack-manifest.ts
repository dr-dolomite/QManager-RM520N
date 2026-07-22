// lib/i18n/language-pack-manifest.ts
import type {
  InstalledPack,
  LanguageCode,
  LanguageMeta,
  RemoteManifest,
  RemoteManifestEntry,
} from "@/types/i18n";

// Trust root = the project's own GitHub release, maintainer-reviewed (same
// boundary as OTA). Packs are published to a persistent release tagged
// `language-packs`, kept out of the firmware update feed. This is what makes
// `escapeValue:false` safe to keep — see docs/reference/i18n.md § Security.
//
// NOTE: this asset only exists once a maintainer runs `bun run lang publish`.
// Until then list.sh returns manifest:null and the UI shows an empty
// "no community packs published yet" state gracefully.
export const DEFAULT_MANIFEST_URL =
  "https://github.com/dr-dolomite/QManager-RM520N/releases/download/language-packs/manifest.json";

export type ManifestParseResult =
  | { ok: true; manifest: RemoteManifest }
  | { ok: false; error: string };

const CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]{0,11}$/;

export function parseManifest(input: unknown): ManifestParseResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "not_an_object" };
  }
  const raw = input as Record<string, unknown>;
  if (raw.manifest_version !== 1) {
    return { ok: false, error: "unsupported_manifest_version" };
  }
  if (typeof raw.generated_at !== "string" || !raw.generated_at) {
    return { ok: false, error: "missing_generated_at" };
  }
  if (!Array.isArray(raw.packs)) {
    return { ok: false, error: "missing_packs" };
  }
  const packs: RemoteManifestEntry[] = [];
  for (const entry of raw.packs) {
    const validated = validateEntry(entry);
    if (!validated) continue;
    packs.push(validated);
  }
  return {
    ok: true,
    manifest: {
      manifest_version: 1,
      generated_at: raw.generated_at,
      app_repo: typeof raw.app_repo === "string" ? raw.app_repo : "",
      packs,
    },
  };
}

function validateEntry(raw: unknown): RemoteManifestEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== "string" || !CODE_PATTERN.test(r.code)) return null;
  if (typeof r.native_name !== "string") return null;
  if (typeof r.english_name !== "string") return null;
  if (typeof r.rtl !== "boolean") return null;
  if (typeof r.version !== "string") return null;
  if (typeof r.completeness !== "number") return null;
  if (typeof r.size_bytes !== "number") return null;
  if (typeof r.sha256 !== "string" || r.sha256.length < 32) return null;
  if (typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) return null;
  const contributors =
    Array.isArray(r.contributors) &&
    r.contributors.every((c) => typeof c === "string")
      ? (r.contributors as string[])
      : [];
  return {
    code: r.code as LanguageCode,
    native_name: r.native_name,
    english_name: r.english_name,
    rtl: r.rtl,
    version: r.version,
    // Present since Increment A; default empty so an older manifest still parses.
    app_min_version:
      typeof r.app_min_version === "string" ? r.app_min_version : "",
    completeness: Math.max(0, Math.min(1, r.completeness)),
    size_bytes: Math.max(0, r.size_bytes | 0),
    sha256: r.sha256,
    url: r.url,
    contributors,
  };
}

// Version strings are date-style (e.g., "2026.04.17"), zero-padded, so a
// lexicographic compare is correct. Falls back to string compare otherwise.
export function compareVersion(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Catalog-view merge: fold the bundled catalog + installed (downloaded) list +
// remote manifest into three display buckets.
// ---------------------------------------------------------------------------

export type CatalogRowState =
  | { status: "built_in"; entry: LanguageMeta }
  | {
      status: "downloaded";
      entry: LanguageMeta;
      version: string;
      completeness: number;
      updateAvailableVersion?: string;
      manifestEntry?: RemoteManifestEntry;
    }
  | { status: "available"; manifestEntry: RemoteManifestEntry };

export interface CatalogBuildInput {
  catalog: readonly LanguageMeta[];
  installed: InstalledPack[];
  manifest: RemoteManifest | null;
}

export function buildCatalogView(input: CatalogBuildInput): {
  builtIn: CatalogRowState[];
  downloaded: CatalogRowState[];
  available: CatalogRowState[];
} {
  const { catalog, installed, manifest } = input;

  const installedMap = new Map(installed.map((i) => [i.code, i]));
  const manifestMap = new Map((manifest?.packs ?? []).map((p) => [p.code, p]));
  const catalogMap = new Map(catalog.map((e) => [e.code, e]));

  const builtIn: CatalogRowState[] = [];
  for (const entry of catalog) {
    if (entry.bundled) builtIn.push({ status: "built_in", entry });
  }

  // Downloaded = installed − built-in.
  const downloaded: CatalogRowState[] = [];
  const seenDownloaded = new Set<LanguageCode>();
  for (const [code, pack] of installedMap) {
    const catalogEntry = catalogMap.get(code);
    if (catalogEntry?.bundled) continue; // shouldn't happen; guard anyway
    const manifestEntry = manifestMap.get(code);
    const baseMeta: LanguageMeta = catalogEntry ?? {
      code,
      native_name: pack.native_name || manifestEntry?.native_name || code,
      english_name: pack.english_name || manifestEntry?.english_name || code,
      rtl: manifestEntry?.rtl ?? false,
      bundled: false,
    };
    const updateAvailable =
      manifestEntry &&
      pack.version &&
      compareVersion(manifestEntry.version, pack.version) > 0
        ? manifestEntry.version
        : undefined;
    downloaded.push({
      status: "downloaded",
      entry: baseMeta,
      version: pack.version || "",
      completeness: typeof pack.completeness === "number" ? pack.completeness : 0,
      updateAvailableVersion: updateAvailable,
      manifestEntry,
    });
    seenDownloaded.add(code);
  }

  // Available = manifest − installed − bundled.
  const available: CatalogRowState[] = [];
  for (const manifestEntry of manifest?.packs ?? []) {
    if (seenDownloaded.has(manifestEntry.code)) continue;
    if (catalogMap.get(manifestEntry.code)?.bundled) continue;
    available.push({ status: "available", manifestEntry });
  }

  return { builtIn, downloaded, available };
}

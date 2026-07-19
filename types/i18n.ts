// types/i18n.ts
export type LanguageCode = string; // BCP-47 (e.g., "en", "zh-CN", "it", "id")

// Increment 1 ships three namespaces. Later increments add the rest; extend this
// union when their JSON lands, never before (a namespace listed here but missing
// from `resources` would let a component request a bundle that doesn't exist).
export type Namespace = "common" | "sidebar" | "dashboard";

export interface LanguageMeta {
  code: LanguageCode;
  native_name: string;
  english_name: string;
  rtl: boolean;
  /**
   * Whether the pack ships in the firmware tarball. In the bundle-only model
   * (no download/CGI backend) every catalog language is bundled; the field is
   * retained so a future increment can reintroduce downloadable packs without a
   * type change.
   */
  bundled: boolean;
}

// ---------------------------------------------------------------------------
// Language-pack pipeline (Increment A: authoring/build/publish).
//
// These describe the pack format and the remote manifest index produced by
// `bun run lang build|publish` and stored under `language-packs/`. They are the
// forward-compatible seams the LATER device-side downloader increment will
// consume; nothing in the app runtime imports them yet.
// ---------------------------------------------------------------------------

/** Metadata embedded in a pack tarball as `_pack.json`. */
export interface PackMeta {
  /** Bumped when the pack on-disk format changes; a downloader rejects newer. */
  pack_format: number;
  code: LanguageCode;
  native_name: string;
  english_name: string;
  rtl: boolean;
  /** Pack version, `YYYY.MM.DD`. */
  version: string;
  /** App release whose English key-set this pack was validated against (semver). */
  app_min_version: string;
  namespaces: Namespace[] | string[];
  completeness: {
    overall: number; // 0..1
    per_namespace: Record<string, number>;
  };
  key_count: { translated: number; total: number };
  generated_at: string; // ISO-8601
  contributors: string[];
}

/** One language's entry in the remote manifest index. */
export interface RemoteManifestEntry {
  code: LanguageCode;
  native_name: string;
  english_name: string;
  rtl: boolean;
  version: string;
  app_min_version: string;
  completeness: number; // overall 0..1 (per-namespace detail lives in the pack)
  size_bytes: number;
  sha256: string;
  url: string;
  contributors: string[];
}

/** The manifest index published as a release asset + kept under language-packs/. */
export interface RemoteManifest {
  manifest_version: number;
  generated_at: string; // ISO-8601
  app_repo: string;
  packs: RemoteManifestEntry[];
}

import type { CatalogRowState } from "@/lib/i18n/language-pack-manifest";
import type {
  LanguageCode,
  LanguagePackInstallState,
  LanguagePackInstallStep,
  RemoteManifestEntry,
} from "@/types/i18n";

import type { CatalogState } from "./shapes";

/** The three buckets `buildCatalogView` returns, as one argument. */
export interface CatalogView {
  builtIn: CatalogRowState[];
  downloaded: CatalogRowState[];
  available: CatalogRowState[];
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

/** A byte count, split so the unit stays a translatable leaf rather than glue. */
export function formatBytes(bytes: number): { value: string; unit: "kb" | "mb" } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: "0", unit: "kb" };
  if (bytes < 1024 * 1024) {
    return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: "kb" };
  }
  return { value: (bytes / (1024 * 1024)).toFixed(1), unit: "mb" };
}

/** Completeness arrives as 0..1; the UI only ever states whole percent. */
export function formatCompleteness(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.floor(Math.max(0, Math.min(1, fraction)) * 100);
}

// -----------------------------------------------------------------------------
// Install state
// -----------------------------------------------------------------------------

const ACTIVE_STEPS = new Set<string>([
  "pending",
  "downloading",
  "verifying",
  "extracting",
  "validating",
  "installing",
  "cancelling",
]);

/** True while the worker is still walking the install; every other state rests. */
export function isInstallActive(state: LanguagePackInstallState["state"]): boolean {
  return ACTIVE_STEPS.has(state);
}

/**
 * The locale key for the step being reported. `step` is the worker's own word
 * and may be absent or unknown, so the state is the fallback and an unmapped
 * value falls all the way through to the generic label.
 */
export function installStepKey(install: LanguagePackInstallState): string {
  const raw = install.step ?? install.state;
  if (ACTIVE_STEPS.has(raw)) {
    return `languages.steps.${raw as LanguagePackInstallStep}`;
  }
  return "languages.steps.working";
}

// -----------------------------------------------------------------------------
// The display-language list
// -----------------------------------------------------------------------------

export interface LanguageRow {
  code: LanguageCode;
  nativeName: string;
  englishName: string;
  provenance: "built_in" | "downloaded";
  /** Only a downloaded pack carries one, and only it can be removed. */
  version?: string;
}

/** Built-in languages first, then downloaded packs, in the catalog's own order. */
export function languageRows(view: CatalogView): LanguageRow[] {
  const rows: LanguageRow[] = [];
  for (const row of view.builtIn) {
    if (row.status !== "built_in") continue;
    rows.push({
      code: row.entry.code,
      nativeName: row.entry.native_name,
      englishName: row.entry.english_name,
      provenance: "built_in",
    });
  }
  for (const row of view.downloaded) {
    if (row.status !== "downloaded") continue;
    rows.push({
      code: row.entry.code,
      nativeName: row.entry.native_name,
      englishName: row.entry.english_name,
      provenance: "downloaded",
      version: row.version,
    });
  }
  return rows;
}

/** How many languages this device can switch to right now, and from where. */
export function readyCount(view: CatalogView): {
  builtIn: number;
  downloaded: number;
  total: number;
} {
  const builtIn = view.builtIn.length;
  const downloaded = view.downloaded.length;
  return { builtIn, downloaded, total: builtIn + downloaded };
}

/** The row the interface is currently rendered from, or null if it is unknown. */
export function activeLanguage(
  activeCode: string,
  view: CatalogView,
): LanguageRow | null {
  return languageRows(view).find((row) => row.code === activeCode) ?? null;
}

// -----------------------------------------------------------------------------
// The community catalog
// -----------------------------------------------------------------------------

export interface PackRow {
  code: LanguageCode;
  nativeName: string;
  englishName: string;
  entry: RemoteManifestEntry;
  /** `update` rows are already installed; only their version moved. */
  kind: "install" | "update";
}

/**
 * Everything with an install-shaped action: packs not on the device, plus
 * installed packs the catalog has published a newer version of.
 */
export function packRows(view: CatalogView): PackRow[] {
  const rows: PackRow[] = [];
  for (const row of view.downloaded) {
    if (row.status !== "downloaded") continue;
    if (!row.updateAvailableVersion || !row.manifestEntry) continue;
    rows.push({
      code: row.entry.code,
      nativeName: row.entry.native_name,
      englishName: row.entry.english_name,
      entry: row.manifestEntry,
      kind: "update",
    });
  }
  for (const row of view.available) {
    if (row.status !== "available") continue;
    rows.push({
      code: row.manifestEntry.code,
      nativeName: row.manifestEntry.native_name,
      englishName: row.manifestEntry.english_name,
      entry: row.manifestEntry,
      kind: "install",
    });
  }
  return rows;
}

/**
 * The catalog tile's one state. Unreachable and empty are different facts: the
 * first says the device could not ask, the second says the answer was nothing.
 */
export function catalogState(input: {
  error: string | null | undefined;
  view: CatalogView;
}): CatalogState {
  if (input.error) return "unreachable";
  const updates = packRows(input.view).filter((row) => row.kind === "update");
  if (updates.length > 0) return "updates";
  if (input.view.available.length > 0) return "available";
  return "none";
}

/** How many installed packs have a newer version waiting in the catalog. */
export function updateCount(view: CatalogView): number {
  return packRows(view).filter((row) => row.kind === "update").length;
}

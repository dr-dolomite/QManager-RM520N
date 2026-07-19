// lib/i18n/installed-store.ts
//
// A tiny localStorage mirror of the downloaded (non-bundled) packs present on
// the device, so the NavUser language switcher can list installed languages
// WITHOUT firing the heavier list.sh (which also round-trips GitHub for the
// manifest) on every render. The management card is the writer: it syncs this
// whenever list.sh returns. Readers get a `qmanager:installed-packs-changed`
// window event to re-read.
import type { InstalledPack, LanguageMeta } from "@/types/i18n";

const STORE_KEY = "qmanager_installed_packs";
export const INSTALLED_PACKS_EVENT = "qmanager:installed-packs-changed";

export function getInstalledPacks(): LanguageMeta[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.code === "string")
      .map((p) => ({
        code: p.code,
        native_name: typeof p.native_name === "string" ? p.native_name : p.code,
        english_name: typeof p.english_name === "string" ? p.english_name : p.code,
        rtl: typeof p.rtl === "boolean" ? p.rtl : false,
        bundled: false as const,
      }));
  } catch {
    return [];
  }
}

export function syncInstalledPacks(installed: InstalledPack[]): void {
  if (typeof localStorage === "undefined") return;
  const slim: LanguageMeta[] = installed.map((p) => ({
    code: p.code,
    native_name: p.native_name || p.code,
    english_name: p.english_name || p.code,
    rtl: false,
    bundled: false,
  }));
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(slim));
    window.dispatchEvent(new Event(INSTALLED_PACKS_EVENT));
  } catch {
    // private mode / quota — the switcher just won't list downloaded packs
  }
}

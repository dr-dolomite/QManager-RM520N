import i18n, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, ALL_NAMESPACES, DEFAULT_NAMESPACE } from "./resources";
import { BUNDLED_CODES, DEFAULT_LANGUAGE } from "./available-languages";
import type { LanguageCode } from "@/types/i18n";

export const LANG_STORAGE_KEY = "qmanager_lang";

export interface InitialLanguageResolution {
  /**
   * The language to init i18next with. ALWAYS a bundled code (or `en`) whose
   * resources are statically compiled in — never a code whose resources are
   * absent, which would silently render English (the worst failure mode).
   */
  initial: LanguageCode;
  /**
   * A persisted NON-bundled code (a downloaded pack) that must be hydrated
   * asynchronously after init, via runtime addResourceBundle. `null` when the
   * stored/detected choice is already bundled.
   */
  pendingDownloaded: string | null;
}

// Hand-rolled detection — deliberately NOT i18next-browser-languagedetector.
// Order: persisted choice → navigator.language (exact, then base subtag) → EN.
//
// COLD-BOOT INVARIANT (Increment B): "catalog membership ⟺ resources present"
// no longer holds — downloaded packs are in the catalog view but load at
// runtime. So a stored code is only accepted as `initial` if it is BUNDLED; a
// stored non-bundled code is returned as `pendingDownloaded` and `initial`
// falls back to `en`. This prevents booting i18next with `lng:<code>` when that
// code has no resources yet.
export function resolveInitialLanguage(): InitialLanguageResolution {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored) {
      if (BUNDLED_CODES.includes(stored)) {
        return { initial: stored, pendingDownloaded: null };
      }
      // Non-bundled but persisted → likely a downloaded pack. Boot on EN and
      // let the provider try to hydrate it; if it's gone, we stay on EN.
      return { initial: DEFAULT_LANGUAGE, pendingDownloaded: stored };
    }
  }

  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav) {
    if (BUNDLED_CODES.includes(nav)) return { initial: nav, pendingDownloaded: null };
    const base = nav.split("-")[0];
    if (BUNDLED_CODES.includes(base)) return { initial: base, pendingDownloaded: null };
  }

  return { initial: DEFAULT_LANGUAGE, pendingDownloaded: null };
}

// Bundle-only, client-only init. MUST run inside a browser effect (see
// components/i18n/i18n-provider.tsx) — never at module scope or during
// prerender: next.config.ts is `output: "export"` (static, no SSR), so any
// t() evaluated at build time would break `next build`. There is NO
// i18next-http-backend branch, no loadPath, no partialBundledLanguages: with
// every language bundled there is nothing to fetch.
export async function createI18n(): Promise<I18nInstance> {
  const { initial } = resolveInitialLanguage();

  const instance = i18n.createInstance();

  await instance.use(initReactI18next).init({
    resources,
    lng: initial,
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: DEFAULT_NAMESPACE,
    ns: [...ALL_NAMESPACES],
    // Native i18next plurals (`_one`/`_other`) and `{{var}}` interpolation.
    // No ICU: RM551E tried i18next-icu, it broke plurals, they reverted.
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

  return instance;
}

export function persistLanguage(code: LanguageCode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LANG_STORAGE_KEY, code);
}

import i18n, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, ALL_NAMESPACES, DEFAULT_NAMESPACE } from "./resources";
import {
  AVAILABLE_LANGUAGES,
  BUNDLED_CODES,
  DEFAULT_LANGUAGE,
} from "./available-languages";
import type { LanguageCode } from "@/types/i18n";

export const LANG_STORAGE_KEY = "qmanager_lang";

// Hand-rolled detection — deliberately NOT i18next-browser-languagedetector.
// Order: persisted choice → navigator.language (exact, then base subtag) → EN.
function resolveDetectedLanguage(): LanguageCode {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    // Every catalog language is bundled, so an accepted stored value always has
    // resources behind it.
    if (stored && AVAILABLE_LANGUAGES.some((l) => l.code === stored)) {
      return stored;
    }
  }

  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav) {
    if (BUNDLED_CODES.includes(nav)) return nav;
    const base = nav.split("-")[0];
    if (BUNDLED_CODES.includes(base)) return base;
  }

  return DEFAULT_LANGUAGE;
}

// Bundle-only, client-only init. MUST run inside a browser effect (see
// components/i18n/i18n-provider.tsx) — never at module scope or during
// prerender: next.config.ts is `output: "export"` (static, no SSR), so any
// t() evaluated at build time would break `next build`. There is NO
// i18next-http-backend branch, no loadPath, no partialBundledLanguages: with
// every language bundled there is nothing to fetch.
export async function createI18n(): Promise<I18nInstance> {
  const initial = resolveDetectedLanguage();

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

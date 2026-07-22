import type { LanguageCode, LanguageMeta } from "@/types/i18n";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

// Bundle-only catalog: every language ships in firmware (`bundled: true`), so
// there is no remote manifest, no download flow, and no non-bundled placeholder.
// RTL is parked (all `rtl: false`) — physical spacing utilities are still used
// throughout the tree, so an RTL language would render with broken margins.
export const AVAILABLE_LANGUAGES: readonly LanguageMeta[] = [
  {
    code: "en",
    native_name: "English",
    english_name: "English",
    rtl: false,
    bundled: true,
  },
  {
    code: "zh-CN",
    native_name: "简体中文",
    english_name: "Simplified Chinese",
    rtl: false,
    bundled: true,
  },
  {
    code: "zh-TW",
    native_name: "繁體中文",
    english_name: "Traditional Chinese",
    rtl: false,
    bundled: true,
  },
  {
    code: "it",
    native_name: "Italiano",
    english_name: "Italian",
    rtl: false,
    bundled: true,
  },
  {
    code: "id",
    native_name: "Indonesia",
    english_name: "Indonesian",
    rtl: false,
    bundled: true,
  },
];

export const BUNDLED_CODES: readonly LanguageCode[] = AVAILABLE_LANGUAGES.filter(
  (l) => l.bundled,
).map((l) => l.code);

export const ALL_CATALOG_CODES: readonly LanguageCode[] =
  AVAILABLE_LANGUAGES.map((l) => l.code);

export function getLanguage(code: LanguageCode): LanguageMeta | undefined {
  return AVAILABLE_LANGUAGES.find((l) => l.code === code);
}

export function isRtl(code: LanguageCode): boolean {
  return getLanguage(code)?.rtl ?? false;
}

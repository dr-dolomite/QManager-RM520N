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

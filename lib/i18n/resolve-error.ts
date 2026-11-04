// lib/i18n/resolve-error.ts
//
// Maps backend error codes to locale text. Free of React and of an i18next
// instance: the caller passes its own `t`, so a card, a toast and a hook share it.
import type { TFunction } from "i18next";

const INSTALL_ERROR_KEYS: Record<string, string> = {
  install_in_progress: "languages.errors.install_in_progress",
  insufficient_space: "languages.errors.insufficient_space",
  checksum_mismatch: "languages.errors.checksum_mismatch",
  sha256_mismatch: "languages.errors.sha256_mismatch",
  pack_not_found: "languages.errors.pack_not_found",
  download_failed: "languages.errors.download_failed",
  manifest_fetch_failed: "languages.errors.manifest_fetch_failed",
  incompatible: "languages.errors.incompatible",
  bundled_immutable: "languages.errors.bundled_immutable",
  extract_failed: "languages.errors.extract_failed",
  validate_failed: "languages.errors.validate_failed",
};

export { INSTALL_ERROR_KEYS };

/**
 * The locale key for a backend error code, or null when the code is unmapped
 * (or absent). A null answer means the caller renders its own generic sentence
 * and quotes the device's raw words beneath it as machine voice — never spliced
 * into the sentence, where an English fragment would land mid-Chinese.
 */
export function installErrorKey(code?: string | null): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  return INSTALL_ERROR_KEYS[trimmed] ?? null;
}

/** A backend `{ error, detail }` as a sentence: known code, else "Modem reported: {detail}", else the fallback. */
export function resolveErrorMessage(
  t: TFunction,
  code: string | undefined | null,
  detail: string | undefined | null,
  fallback: string,
): string {
  const trimmedCode = code?.trim();
  const trimmedDetail = detail?.trim();

  if (trimmedCode) {
    // defaultValue "" detects a missing key without rendering the key itself.
    const translated = t(trimmedCode, { ns: "errors", defaultValue: "" });
    if (translated) return translated;
    if (trimmedDetail) {
      return t("unknown_with_detail", { ns: "errors", detail: trimmedDetail });
    }
    return fallback;
  }

  if (trimmedDetail) return trimmedDetail;
  return fallback;
}

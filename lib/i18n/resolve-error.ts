// lib/i18n/resolve-error.ts
//
// Maps a backend error code (from the language-pack CGI) to a user-facing
// English string. Unlike the RM551E sibling this does NOT go through an i18n
// "errors" namespace — RM520N ships only common/sidebar/dashboard, and adding
// a namespace would require translating it across all 5 bundled languages,
// which the bundle-only invariant + `i18n:check` parity gate deliberately
// scope out of this increment. The manager UI copy is English literals.
const ERROR_MESSAGES: Record<string, string> = {
  install_in_progress: "Another language pack is already installing.",
  insufficient_space: "Not enough free space on the device to install this pack.",
  checksum_mismatch: "The download failed its integrity check and was discarded.",
  sha256_mismatch: "The download failed its integrity check and was discarded.",
  pack_not_found: "That language pack is no longer listed in the manifest.",
  download_failed: "Couldn't download the language pack. Check connectivity and retry.",
  manifest_fetch_failed: "Couldn't reach the pack catalog on GitHub.",
  incompatible: "This pack needs a newer version of QManager.",
  bundled_immutable: "Built-in languages can't be removed.",
  extract_failed: "The language pack archive couldn't be unpacked.",
  validate_failed: "The language pack failed validation and was discarded.",
};

/**
 * Resolve a backend {error, detail} pair into a message.
 *   1. Known code → its mapped English string.
 *   2. Unknown code with detail → "The device reported: <detail>".
 *   3. Detail only → the detail verbatim.
 *   4. Neither → the caller's fallback.
 */
export function resolveInstallError(
  code: string | undefined | null,
  detail: string | undefined | null,
  fallback: string,
): string {
  const c = code?.trim();
  const d = detail?.trim();

  if (c) {
    const known = ERROR_MESSAGES[c];
    if (known) return known;
    if (d) return `The device reported: ${d}`;
    return fallback;
  }
  if (d) return d;
  return fallback;
}

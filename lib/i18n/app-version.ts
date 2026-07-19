// lib/i18n/app-version.ts
import pkg from "@/package.json";

// Firmware/app version, e.g. "v0.1.13-draft". Packs carry an `app_min_version`
// (semver, e.g. "0.1.13"); a pack requiring a newer app than this must not be
// installable on-device.
export const APP_VERSION: string = (pkg as { version?: string }).version ?? "0.0.0";

function parseSemver(v: string): [number, number, number] {
  // Strip a leading "v" and any pre-release/build suffix ("-draft", "+meta").
  const cleaned = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  const parts = cleaned.split(".").map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function cmpSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True when the running app satisfies a pack's `app_min_version`. An empty or
 * unparseable min-version is treated as "no requirement" → compatible.
 */
export function isPackCompatible(appMinVersion: string | undefined | null): boolean {
  if (!appMinVersion || !appMinVersion.trim()) return true;
  return cmpSemver(parseSemver(APP_VERSION), parseSemver(appMinVersion)) >= 0;
}

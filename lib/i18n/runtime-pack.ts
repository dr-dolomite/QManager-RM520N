// lib/i18n/runtime-pack.ts
//
// Runtime injection of DOWNLOADED (non-bundled) language packs. This is the
// ONLY injection mechanism: fetched JSON → i18n.addResourceBundle. There is NO
// i18next-http-backend, NO languagedetector — the hard invariant holds.
//
// Served path is SEPARATE from the bundled locales: downloaded packs live at
// /locales-packs/<code>/<ns>.json (re-copied on-device from the OTA-surviving
// persistent store /usrdata/qmanager/locales-packs/ back into the web root by
// install_frontend after each OTA wipe), whereas bundled langs ride
// /locales/<code>/<ns>.json and are also compiled into the JS via resources.ts.
import type { i18n as I18nInstance } from "i18next";
import type { LanguageCode } from "@/types/i18n";
import { ALL_NAMESPACES } from "./resources";
import { BUNDLED_CODES, isRtl } from "./available-languages";

export const PACK_SERVED_BASE = "/locales-packs";

function alreadyLoaded(i18n: I18nInstance, code: string): boolean {
  return ALL_NAMESPACES.every((ns) => i18n.hasResourceBundle(code, ns));
}

function applyHtmlDir(code: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? "rtl" : "ltr";
}

/**
 * Load a downloaded pack into the running instance and switch to it.
 *
 * Atomic-ish: fetch ALL namespaces FIRST; only inject + changeLanguage if every
 * namespace resolved and parsed. On any failure (404 / parse / partial) it
 * touches nothing and returns false, so the UI never half-switches into a
 * missing-resource state (which reads as silent English — the worst failure).
 *
 * If the pack is already in the store from an earlier switch this session, it
 * skips the network and just changes language.
 */
export async function loadDownloadedPack(
  i18n: I18nInstance,
  code: LanguageCode,
): Promise<boolean> {
  if (alreadyLoaded(i18n, code)) {
    await i18n.changeLanguage(code);
    applyHtmlDir(code);
    return true;
  }

  const bundles: Record<string, unknown> = {};
  try {
    // credentials:"same-origin" (NOT authFetch): these are static assets served
    // by lighttpd. Avoiding authFetch keeps cold-boot hydration from triggering
    // a 401 redirect if this runs on an unauthenticated surface.
    const results = await Promise.all(
      ALL_NAMESPACES.map(async (ns) => {
        const resp = await fetch(`${PACK_SERVED_BASE}/${code}/${ns}.json`, {
          credentials: "same-origin",
          cache: "no-cache",
        });
        if (!resp.ok) throw new Error(`ns ${ns}: HTTP ${resp.status}`);
        return { ns, json: await resp.json() };
      }),
    );
    for (const { ns, json } of results) bundles[ns] = json;
  } catch {
    return false;
  }

  // All namespaces are in hand — inject then switch (deep-merge + overwrite).
  for (const ns of ALL_NAMESPACES) {
    i18n.addResourceBundle(code, ns, bundles[ns], true, true);
  }
  await i18n.changeLanguage(code);
  applyHtmlDir(code);
  return true;
}

/**
 * Unified language switch used by BOTH the switcher and the manager card.
 * Bundled codes (or codes already loaded this session) switch synchronously;
 * a downloaded code loads its pack first. Returns false only if a downloaded
 * pack could not be loaded — the caller should surface that and stay put.
 */
export async function switchLanguage(
  i18n: I18nInstance,
  code: LanguageCode,
): Promise<boolean> {
  if (BUNDLED_CODES.includes(code) || alreadyLoaded(i18n, code)) {
    await i18n.changeLanguage(code);
    applyHtmlDir(code);
    return true;
  }
  return loadDownloadedPack(i18n, code);
}

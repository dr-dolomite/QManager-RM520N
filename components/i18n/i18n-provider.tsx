"use client";

import * as React from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n as I18nInstance } from "i18next";
import { createI18n, LANG_STORAGE_KEY } from "@/lib/i18n/config";
import { isRtl } from "@/lib/i18n/available-languages";

// Client-only, lazy i18next boot. The instance is created inside useEffect so it
// never runs during SSR/prerender — mandatory for the static export (see
// lib/i18n/config.ts). Children render behind a one-tick init guard; bundled
// init is effectively synchronous (no network), so there is no meaningful flash.
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = React.useState<I18nInstance | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    createI18n().then((i18n) => {
      if (cancelled) return;
      applyHtmlAttributes(i18n.language);
      i18n.on("languageChanged", (lng: string) => {
        applyHtmlAttributes(lng);
        try {
          localStorage.setItem(LANG_STORAGE_KEY, lng);
        } catch {
          // localStorage may be unavailable in private mode — ignore
        }
      });
      setInstance(i18n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!instance) {
    return null;
  }

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

function applyHtmlAttributes(lng: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng;
  document.documentElement.dir = isRtl(lng) ? "rtl" : "ltr";
}

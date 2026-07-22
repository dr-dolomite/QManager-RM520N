"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { switchLanguage } from "@/lib/i18n/runtime-pack";
import {
  getInstalledPacks,
  INSTALLED_PACKS_EVENT,
} from "@/lib/i18n/installed-store";
import type { LanguageMeta } from "@/types/i18n";

// NavUser dropdown switcher. Lists bundled catalog languages PLUS any downloaded
// (non-bundled) packs mirrored to localStorage by the manager card — so it stays
// network-free. Switching to a downloaded code injects its pack via
// addResourceBundle before changeLanguage (switchLanguage handles both).
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("common");
  const [installed, setInstalled] = React.useState<LanguageMeta[]>([]);

  React.useEffect(() => {
    const read = () => setInstalled(getInstalledPacks());
    read();
    window.addEventListener(INSTALLED_PACKS_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(INSTALLED_PACKS_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // Bundled + downloaded, de-duped by code (bundled wins).
  const languages = React.useMemo<LanguageMeta[]>(() => {
    const seen = new Set(AVAILABLE_LANGUAGES.map((l) => l.code));
    return [
      ...AVAILABLE_LANGUAGES,
      ...installed.filter((l) => !seen.has(l.code)),
    ];
  }, [installed]);

  const formatLabel = React.useCallback(
    (lang: LanguageMeta) =>
      lang.native_name === lang.english_name
        ? lang.native_name
        : `${lang.native_name} (${lang.english_name})`,
    [],
  );

  const activeLang =
    languages.find((l) => l.code === i18n.language) ??
    languages.find((l) => l.code === i18n.language.split("-")[0]);

  const stopMenuKeys = (e: React.KeyboardEvent) => {
    const intercepted = ["ArrowDown", "ArrowUp", "Enter", " "];
    if (intercepted.includes(e.key)) {
      e.stopPropagation();
    }
  };

  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={stopMenuKeys}
    >
      <Select
        value={i18n.language}
        onValueChange={(value) => {
          void switchLanguage(i18n, value);
        }}
      >
        <SelectTrigger
          aria-label={t("language.switch_aria")}
          className="h-8 w-full justify-start gap-2 border-0 bg-transparent px-2 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Languages className="size-4" />
          <SelectValue>
            {activeLang ? formatLabel(activeLang) : i18n.language}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {formatLabel(lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

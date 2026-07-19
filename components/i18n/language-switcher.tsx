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

// Bundle-only switcher: every catalog language ships in firmware, so the list is
// simply AVAILABLE_LANGUAGES — no installed-pack fetch, no manifest. Designed to
// sit inside the NavUser dropdown; stops the keys/clicks the parent Radix menu
// would otherwise intercept while letting Escape/Tab bubble.
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("common");

  const formatLabel = React.useCallback(
    (lang: (typeof AVAILABLE_LANGUAGES)[number]) =>
      lang.native_name === lang.english_name
        ? lang.native_name
        : `${lang.native_name} (${lang.english_name})`,
    [],
  );

  const activeLang =
    AVAILABLE_LANGUAGES.find((l) => l.code === i18n.language) ??
    AVAILABLE_LANGUAGES.find((l) => l.code === i18n.language.split("-")[0]);

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
        onValueChange={(value) => i18n.changeLanguage(value)}
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
          {AVAILABLE_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {formatLabel(lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

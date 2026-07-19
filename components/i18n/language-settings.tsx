"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2Icon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { persistLanguage } from "@/lib/i18n/config";

// Bundle-only Languages settings page. Every catalog language ships in firmware,
// so this is a plain single-select list — no download / install / remove flow
// (that pack-management UI from RM551E is intentionally not ported). Selection
// runs through i18next's changeLanguage; the provider's languageChanged listener
// persists it, and persistLanguage() here is a belt-and-suspenders write.
export function LanguageSettings() {
  const { t, i18n } = useTranslation("common");
  const active = i18n.language;

  const handleSelect = React.useCallback(
    (code: string) => {
      if (code === active) return;
      i18n.changeLanguage(code);
      persistLanguage(code);
    },
    [active, i18n],
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("language.page_title")}</CardTitle>
          <CardDescription>{t("language.page_description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {AVAILABLE_LANGUAGES.map((lang) => {
            const isActive =
              lang.code === active || lang.code === active.split("-")[0];
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleSelect(lang.code)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive
                    ? "border-success/30 bg-success/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{lang.native_name}</span>
                  {lang.native_name !== lang.english_name && (
                    <span className="text-xs text-muted-foreground">
                      {lang.english_name}
                    </span>
                  )}
                </div>
                {isActive && (
                  <Badge
                    variant="outline"
                    className="bg-success/15 text-success hover:bg-success/20 border-success/30"
                  >
                    <CheckCircle2Icon className="size-3" />
                    {t("language.active")}
                  </Badge>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

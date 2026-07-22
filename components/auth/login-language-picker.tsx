"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { cn } from "@/lib/utils";

// =============================================================================
// LoginLanguagePicker — Icon-only button + radio menu for pre-auth chrome.
// =============================================================================
// A slimmed-down sibling of components/i18n/language-switcher.tsx sized for the
// login / setup shell: no inline label, opens a small radio list of the bundled
// languages. Selection persists through i18next's normal changeLanguage flow —
// no auth required because the language preference is client-side.
//
// Layout-agnostic: positioning (e.g. `fixed top-4 right-4`) is the caller's job,
// so this can drop into /login, /setup, or any pre-auth surface unchanged.
// =============================================================================

interface LoginLanguagePickerProps {
  className?: string;
  variant?: "ghost" | "outline";
  // RM520N's button.tsx exposes "icon" (size-9 / 36px) and "icon-sm" (size-8 /
  // 32px) — there is no 44px touch variant, so the picker uses those two.
  size?: "icon-sm" | "icon";
}

export function LoginLanguagePicker({
  className,
  variant = "ghost",
  size = "icon-sm",
}: LoginLanguagePickerProps) {
  const { t, i18n } = useTranslation("common");

  const formatLabel = (lang: (typeof AVAILABLE_LANGUAGES)[number]) =>
    lang.native_name === lang.english_name
      ? lang.native_name
      : `${lang.native_name} (${lang.english_name})`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          aria-label={t("language.switch_aria")}
          // text-foreground (not muted) for outdoor-readable contrast against a
          // tablet glass in direct sunlight. Glyph scales with the button: size-5
          // in the 44px icon-touch button, size-4 in the 32px icon-sm button.
          className={cn(variant === "ghost" && "text-foreground", className)}
        >
          <Languages className={size === "icon-sm" ? "size-4" : "size-5"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[10rem]">
        <DropdownMenuRadioGroup
          value={i18n.language}
          onValueChange={(value) => i18n.changeLanguage(value)}
        >
          {AVAILABLE_LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code}>
              {formatLabel(lang)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

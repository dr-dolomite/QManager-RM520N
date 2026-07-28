"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// =============================================================================
// ModeToggle — Public-surface theme switcher.
// =============================================================================
// ShadCN-canonical Sun/Moon dropdown, wired through next-themes. Lives in the
// public/ namespace because the authenticated nav uses AnimatedThemeToggler
// (view-transition circle-clip), and the pre-login surface gets the more
// conventional dropdown so first-time visitors can pick "system" explicitly.
//
// The optional `size` prop defaults to "icon" so the Overview matches the rest
// of its CardAction cluster. /login overrides to "icon-sm" to align with the
// LoginLanguagePicker trigger sitting next to it.
//
// GLYPHS: this is one of the two pre-auth surfaces, which the Icon-Boundary
// Rule now covers alongside the sidebar and /dashboard — so the glyphs are
// Material Symbols, not lucide. `size` is passed explicitly on every
// MaterialSymbol because the component writes an inline `fontSize` that
// outranks any Tailwind size utility.
//
// FILL: `variant="outline"` is gone. A 1px outline on a tonal system is the
// same reasoning that retired outline badges — the trigger now carries a
// container fill. Which fill is the CALLER's business, not this component's,
// because it depends on what sits behind the button: on /login it floats on the
// page background and wants lift, on the Overview it sits ON the card and wants
// contrast against it. Hence `className` rather than a second appearance prop.
// =============================================================================

interface ModeToggleProps {
  size?: "icon-sm" | "icon";
  className?: string;
}

export function ModeToggle({
  size = "icon",
  className,
}: ModeToggleProps = {}) {
  const { setTheme } = useTheme();
  const { t } = useTranslation("common");

  // 19px inside the 36px icon button matches the Overview CardAction cluster;
  // 17px inside the 32px icon-sm button matches the translate glyph in
  // LoginLanguagePicker so the /login cluster reads as one optical rhythm.
  const glyphSize = size === "icon-sm" ? 17 : 19;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={t("overview.actions.theme_toggle_aria")}
          className={cn(
            "text-on-surface-variant rounded-pill bg-surface-container",
            "hover:bg-surface-container-high hover:text-foreground",
            className,
          )}
        >
          {/* Both glyphs are always mounted and swapped on transform, so the
              button never reflows and the swap costs no layout. The rotation
              is decorative; with reduced motion the end state is still correct
              because the scale, not the transition, is what selects a glyph. */}
          <MaterialSymbol
            name="light_mode"
            size={glyphSize}
            className="scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90"
          />
          <MaterialSymbol
            name="dark_mode"
            size={glyphSize}
            className="absolute scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
          />
          <span className="sr-only">
            {t("overview.actions.theme_toggle_aria")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          {t("overview.actions.theme_light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          {t("overview.actions.theme_dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          {t("overview.actions.theme_system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

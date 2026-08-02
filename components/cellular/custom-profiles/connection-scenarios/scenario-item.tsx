import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AbstractPattern } from "./abstract-pattern";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ScenarioConfig } from "@/types/connection-scenario";
import {
  BADGE_GLYPH_SIZE,
  PROFILE_STATUS_BADGE,
  SCENARIO_TILE_ACTIVE,
  SCENARIO_TILE_IDLE,
  SCENARIO_TILE_SHAPE,
} from "../shapes";

// =============================================================================
// ScenarioItem — one selectable scenario tile
// =============================================================================
// The tile is a tonal surface, not a saturated gradient. What it used to be: a
// full-bleed `bg-linear-to-br from-violet-600 …` with `text-white` content and
// a `getRingColor()` helper that string-matched the gradient to pick one of
// twelve `ring-*-500` classes. None of that could follow the theme, and the
// white ink was only legible because the tile beneath it was guaranteed dark.
//
// Identity now rides on the GLYPH (see `scenario-icons.ts`). That matters more
// than the token cleanup: every custom scenario renders the same base tile, so
// if colour were still the identity channel, a colour-blind user would have had
// no way to tell two custom scenarios apart.
//
// Selection state is two-tier, and both tiers are rings so neither competes
// with the identity glyph for the tile's fill:
//   active   — `ring-primary`, the scenario the modem is actually running
//   selected — a muted ring, meaning "you are looking at this one"
// Active additionally carries a success chip, because a ring alone is a
// colour-only signal and "which scenario is live" is the one thing on this card
// that must not depend on colour perception.
// =============================================================================

/** The destructive pill, from the button variant — matches
 *  `sms/delete-dialogs.tsx`'s `DESTRUCTIVE_ACTION`/`CANCEL_ACTION` constants
 *  rather than a hand-written `bg-destructive text-destructive-foreground
 *  hover:bg-destructive/90` copy. */
const DESTRUCTIVE_ACTION = cn(
  buttonVariants({ variant: "destructive" }),
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold",
);
const CANCEL_ACTION = "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Resolved ligature name, for rendering. */
  icon: MaterialSymbolName;
  /** The persisted glyph KEY this was resolved from. Kept alongside the
   *  component because the edit dialog needs to pre-select the stored choice,
   *  and a component reference cannot be compared back to a picker option. */
  iconId?: string;
  pattern: "gaming" | "streaming" | "balanced" | "custom";
  config: ScenarioConfig;
  isDefault?: boolean;
}

interface ScenarioItemProps {
  scenario: Scenario;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  onSelect,
  onDelete,
}: ScenarioItemProps) => {
  const { t } = useTranslation("cellular");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isCustom = scenario.pattern === "custom";
  const activeBadge = PROFILE_STATUS_BADGE.active;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(scenario.id);
    setShowDeleteDialog(false);
  };

  return (
    <>
      <motion.div
        className={cn(
          SCENARIO_TILE_SHAPE.ROOT,
          "group cursor-pointer",
          isActive ? SCENARIO_TILE_ACTIVE : SCENARIO_TILE_IDLE,
          isActive
            ? "ring-primary ring-offset-background ring-2 ring-offset-3"
            : isSelected
              ? "ring-on-surface-variant/40 ring-offset-background ring-2 ring-offset-2"
              : "",
        )}
        animate={{ scale: isActive || isSelected ? 1.01 : 1 }}
        whileHover={!isActive && !isSelected ? { scale: 1.02, y: -2 } : {}}
        whileTap={{ scale: 0.97 }}
        // Canon curve rather than the spring this carried before: DESIGN.md's
        // motion character is expressive but settled, never springy.
        transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
        onClick={() => onSelect(scenario.id)}
      >
        {/* Texture. Inherits `on-surface-variant` so it reads in both themes. */}
        <AbstractPattern
          type={scenario.pattern}
          className="absolute inset-0 h-full w-full text-on-surface-variant"
        />

        {/* Content — wrapped in its own positioned box so it paints above the
            absolutely-positioned texture layer regardless of DOM order. */}
        <div className="relative flex h-full flex-col justify-between">
          {/* Top row - glyph disc and active chip / delete */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {/* Glyph disc, matching the Banner primitive's Glyph-Disc Rule:
                  a filled circle survives when a tint washes out. */}
              <span
                className={cn(
                  SCENARIO_TILE_SHAPE.DISC,
                  "bg-primary text-primary-foreground",
                )}
              >
                <MaterialSymbol name={scenario.icon} size={20} />
              </span>
              {isActive && (
                <Badge variant={activeBadge.variant}>
                  <MaterialSymbol name={activeBadge.glyph} size={BADGE_GLYPH_SIZE} />
                  {t("scenarios.tile.active")}
                </Badge>
              )}
            </div>
            {isCustom && (
              <button
                onClick={handleDeleteClick}
                aria-label={t("scenarios.tile.delete_aria", {
                  name: scenario.name,
                })}
                className="bg-surface-container-high text-on-surface-variant hover:bg-destructive hover:text-destructive-foreground rounded-inline p-2 opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <MaterialSymbol name="delete" size={16} />
              </button>
            )}
          </div>

          {/* Bottom row - name and description */}
          <div>
            <h3 className="mb-0.5 text-base font-semibold">{scenario.name}</h3>
            <p className="text-on-surface-variant text-xs">
              {scenario.description}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("scenarios.tile.delete_dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("scenarios.tile.delete_dialog.description", {
                name: scenario.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal" className={CANCEL_ACTION}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className={DESTRUCTIVE_ACTION}
            >
              {t("scenarios.tile.delete_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

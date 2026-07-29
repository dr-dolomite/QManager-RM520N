import React, { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AbstractPattern } from "./abstract-pattern";
import { Badge } from "@/components/ui/badge";
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isCustom = scenario.pattern === "custom";

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
          "bg-surface-container text-on-surface rounded-card relative cursor-pointer overflow-hidden",
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
          className="text-on-surface-variant absolute inset-0 h-full w-full"
        />

        {/* Content */}
        <div className="group relative flex h-36 flex-col justify-between p-5">
          {/* Top row - glyph disc and active chip / delete */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {/* Glyph disc, matching the Banner primitive's Glyph-Disc Rule:
                  a filled circle survives when a tint washes out. */}
              <span className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-full">
                <MaterialSymbol name={scenario.icon} size={20} />
              </span>
              {isActive && (
                <Badge variant="success">
                  <MaterialSymbol name="check_circle" size={12} />
                  Active
                </Badge>
              )}
            </div>
            {isCustom && (
              <button
                onClick={handleDeleteClick}
                aria-label={`Delete ${scenario.name} scenario`}
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
            <AlertDialogTitle>Delete Scenario</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{scenario.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

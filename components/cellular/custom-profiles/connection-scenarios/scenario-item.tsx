import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { buttonVariants } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
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
import type { ConnectionScenario } from "@/types/connection-scenario";
import { resolveScenarioIcon } from "./scenario-icons";
import {
  BADGE_GLYPH_SIZE,
  MACHINE_VALUE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PROFILE_STATUS_BADGE,
  SCENARIO_DISC_ACTIVE,
  SCENARIO_DISC_IDLE,
  SCENARIO_TILE_ACTIVE,
  SCENARIO_TILE_IDLE,
  SCENARIO_TILE_SHAPE,
  TILE_CAPTION,
} from "../shapes";

// =============================================================================
// ScenarioItem — one selectable scenario tile
// =============================================================================
// ANATOMY. `[ 44px disc ][ name / band tags / schedule caption ][ chip + trash ]`
// — the same horizontal block every other `/cellular/` tile renders, imported
// wholesale from `SCENARIO_TILE_SHAPE` so this tile can never again disagree
// with the ghost tile beside it or the skeleton behind it on radius or height.
//
// IDENTITY RIDES ON THE GLYPH, never on colour (see `scenario-icons.ts`). The
// tile therefore stores the PERSISTED icon id and resolves it here, at the one
// boundary — `resolveScenarioIcon(scenario.icon)`. It used to receive an
// already-resolved ligature from its caller, which is how the caller's private
// copy of the built-in scenarios came to hold ligature names in an id-shaped
// field and rendered all three built-ins as the fallback sparkle.
//
// THREE STATES, THREE CHANNELS, NO OVERLAP:
//   in force  — neutral body + `SCENARIO_TILE_ACTIVE`'s 2px inset primary ring,
//               literally the same constant the active profile row takes.
//   selected  — one tonal step (`surface-container-high`). "You are looking at
//               this one" is a weaker claim than "this is running", so it gets
//               the weaker channel.
//   hover     — a 1.01 scale and nothing else. Giving hover the tonal step too
//               would make a hovered idle tile identical to a selected one.
//
// The body is NEUTRAL in all three. The previous generation painted the
// in-force tile `primary-container` across 144px — the container layer at four
// times its sanctioned size — and hand-wrote the classes beside an exported
// constant nothing consumed, plus a private ring constant of its own. All three
// copies are gone; the tones come from `../shapes.ts` only.
//
// The tile reports the schedule as a CAPTION, not a chip, and only ever from
// `nextFireAt`, which the page shell supplies from the active profile's
// schedule. There is no local fallback: a fabricated "18:00" on a scenario
// nothing has scheduled is exactly the claim the State-Honesty Rule forbids.
// =============================================================================

/** The destructive pill, from the button variant — matches
 *  `sms/delete-dialogs.tsx`'s `DESTRUCTIVE_ACTION`/`CANCEL_ACTION` constants
 *  rather than a hand-written `bg-destructive text-destructive-foreground
 *  hover:bg-destructive/90` copy. */
const DESTRUCTIVE_ACTION = cn(
  buttonVariants({ variant: "destructive" }),
  PILL_ACTION,
);
const CANCEL_ACTION = PILL_ACTION_PLAIN;

/** Count the members of a colon-delimited band list. "" is zero, not one. */
function bandCount(colonDelimited: string): number {
  return colonDelimited ? colonDelimited.split(":").filter(Boolean).length : 0;
}

/**
 * The tile's band-lock counts.
 *
 * NR is the UNION of the SA and NSA lists, de-duplicated: a scenario that pins
 * n78 on both legs pins one band, not two, and printing "2 NR" for it would
 * overstate what the lock actually does.
 */
function bandCounts(config: ConnectionScenario["config"]): {
  lte: number;
  nr: number;
} {
  const nr = new Set(
    [...config.sa_nr_bands.split(":"), ...config.nsa_nr_bands.split(":")].filter(
      Boolean,
    ),
  );
  return { lte: bandCount(config.lte_bands), nr: nr.size };
}

/**
 * The UI's view of a scenario.
 *
 * DERIVED from the backend/shared type rather than restated, so the two can
 * never drift apart the way they did before: `icon` here is the same optional
 * PERSISTED KEY that `ConnectionScenario.icon` and `StoredScenario.icon` carry,
 * not a ligature. `isDefault` is the one genuine difference — a record coming
 * off `list.sh` has no such field, so the UI supplies it.
 */
export interface Scenario extends Omit<ConnectionScenario, "isDefault"> {
  isDefault?: boolean;
}

interface ScenarioItemProps {
  scenario: Scenario;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * "HH:MM" of this scenario's next scheduled activation, when — and only when —
   * an active profile's `scenario.schedule` actually names it. Undefined/null
   * renders the "not scheduled" caption. Never derive this locally.
   */
  nextFireAt?: string | null;
}

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  onSelect,
  onDelete,
  nextFireAt,
}: ScenarioItemProps) => {
  const { t } = useTranslation("cellular");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isCustom = scenario.pattern === "custom";
  const activeBadge = PROFILE_STATUS_BADGE.active;

  const { lte, nr } = bandCounts(scenario.config);
  const locksBands = lte > 0 || nr > 0;

  // The caption states what is knowable and nothing else. A next-fire time
  // outranks "in force now" because the time is the newer information; with no
  // time at all, an inactive scenario is genuinely unscheduled and says so.
  const caption = nextFireAt
    ? t("scenarios.tile.caption_next", { time: nextFireAt })
    : isActive
      ? t("scenarios.tile.caption_in_force")
      : t("scenarios.tile.caption_unscheduled");

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(scenario.id);
    setShowDeleteDialog(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(scenario.id);
    }
  };

  return (
    <>
      <motion.div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        className={cn(
          SCENARIO_TILE_SHAPE.ROOT,
          isActive ? SCENARIO_TILE_ACTIVE : SCENARIO_TILE_IDLE,
          // Selection is one tonal step, applied AFTER the base tone so
          // tailwind-merge drops the losing `bg-*` rather than stacking two.
          !isActive && isSelected && "bg-surface-container-high",
          "group h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        whileHover={!isActive && !isSelected ? { scale: 1.01 } : {}}
        whileTap={{ scale: 0.99 }}
        // Canon curve rather than a spring: DESIGN.md's motion character is
        // expressive but settled, never springy.
        transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
        onClick={() => onSelect(scenario.id)}
        onKeyDown={handleKeyDown}
      >
        {/* The identity disc — THE ONE COLOURED OBJECT IN THE TILE. Filled
            when the scenario is in force, neutral otherwise. */}
        <span
          className={cn(
            SCENARIO_TILE_SHAPE.DISC,
            isActive ? SCENARIO_DISC_ACTIVE : SCENARIO_DISC_IDLE,
          )}
        >
          <MaterialSymbol
            name={resolveScenarioIcon(scenario.icon)}
            size={21}
            filled
          />
        </span>

        <div className={SCENARIO_TILE_SHAPE.COL}>
          <h3 className={SCENARIO_TILE_SHAPE.NAME}>{scenario.name}</h3>

          {/* Metadata, never status: the mode token the device takes, how many
              bands each leg pins, and whether the record is the user's. All
              outline tags — the tile's fill is the only fill in it. */}
          <div className={SCENARIO_TILE_SHAPE.META}>
            <Tag variant="neutral" className={MACHINE_VALUE}>
              {scenario.config.atModeValue}
            </Tag>
            {locksBands ? (
              <>
                {nr > 0 && (
                  <Tag variant="nr">
                    {t("scenarios.tile.band_count_nr", { bands: nr })}
                  </Tag>
                )}
                {lte > 0 && (
                  <Tag variant="lte">
                    {t("scenarios.tile.band_count_lte", { bands: lte })}
                  </Tag>
                )}
              </>
            ) : (
              // Human voice — "Bands auto" is a sentence the UI wrote, not a
              // value the device emitted, so it does not take the mono face.
              <Tag variant="neutral">{t("scenarios.tile.bands_auto")}</Tag>
            )}
            {isCustom && (
              <Tag variant="neutral">{t("scenarios.tile.custom_tag")}</Tag>
            )}
          </div>

          <p className={cn(TILE_CAPTION, "truncate")}>{caption}</p>
        </div>

        {/* Trailing cluster: the status chip, and the delete affordance for a
            custom record. The button is always in the layout (opacity only,
            never `hidden`) so revealing it on hover cannot shift the chip. */}
        <div className="flex flex-none items-center gap-1.5">
          {isActive && (
            <Badge variant={activeBadge.variant}>
              <MaterialSymbol
                name={activeBadge.glyph}
                size={BADGE_GLYPH_SIZE}
                filled
              />
              {t("scenarios.tile.in_force")}
            </Badge>
          )}
          {isCustom && (
            <button
              type="button"
              onClick={handleDeleteClick}
              aria-label={t("scenarios.tile.delete_aria", {
                name: scenario.name,
              })}
              className="bg-surface-container-high text-on-surface-variant hover:bg-destructive hover:text-destructive-foreground rounded-pill p-1.5 opacity-0 transition-colors duration-[var(--duration-quick)] ease-out group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <MaterialSymbol name="delete" size={16} />
            </button>
          )}
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

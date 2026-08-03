import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
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
import { bandsToDisplay, type ScenarioConfig } from "@/types/connection-scenario";
import {
  BADGE_GLYPH_SIZE,
  CONFIG_PILL_BRAND,
  CONFIG_PILL_NEUTRAL,
  MACHINE_VALUE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PROFILE_ROW_ACTIVE_RING,
  PROFILE_STATUS_BADGE,
  SCENARIO_META_CHIP,
  SCENARIO_PILL,
  SCENARIO_TILE_IDLE,
  SCENARIO_TILE_SHAPE,
} from "../shapes";

// =============================================================================
// ScenarioItem — one selectable scenario tile
// =============================================================================
// The tile is a tonal surface, not a saturated gradient, and identity rides on
// the GLYPH (see `scenario-icons.ts`) rather than on colour — every custom
// scenario renders the same base tile, so a colour-blind user can still tell two
// of them apart.
//
// WHY THE IN-FORCE TILE IS NEUTRAL-PLUS-RING RATHER THAN A BRAND FILL. The tile
// carries two `surface-container-high` mono pills of its own. Dropping it onto
// `primary-container` (what `SCENARIO_TILE_ACTIVE` does) puts a neutral
// container inside a tinted one and the pills lose the tonal separation that is
// the only thing distinguishing them from the tile. This is the identical
// problem `profileRowTone` solved for the active profile row, so it takes the
// identical answer: the fill stays neutral and `PROFILE_ROW_ACTIVE_RING` — the
// SAME 2px inset ring, imported, never restated — carries "this is the one".
// The ring is an inset shadow, so an activating tile does not resize.
//
// Selection ("you are looking at this one") is the same geometry one tone down,
// so the two states can never disagree on weight or shift the layout.
//
// The tile also reports, at most, ONE meta chip, in this precedence:
//   in force → next scheduled fire → locks bands
// The middle one is only ever rendered from `nextFireAt`, which the page shell
// supplies from the active profile's schedule. There is no local fallback and no
// default: a fabricated "18:00" on a scenario nothing has scheduled is exactly
// the claim the State-Honesty Rule forbids.
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

/**
 * The selected-but-not-in-force ring. Same 2px inset geometry as
 * `PROFILE_ROW_ACTIVE_RING`, one tone down, so "looking at" and "in force" are
 * the same shape at two weights instead of two unrelated treatments.
 *
 * NOTE (shapes.ts gap): there is no exported constant for this. It is written
 * here in the ring's own idiom rather than as a `ring-*` utility, because a
 * `ring` with an offset would reintroduce the layout box the inset shadow exists
 * to avoid.
 */
const SCENARIO_TILE_SELECTED_RING = "shadow-[inset_0_0_0_2px_var(--outline)]";

/**
 * Which band families a scenario pins, in the order the tile prints them.
 * Labels are band-class tokens the device itself uses, so they are machine
 * voice and deliberately not translated.
 */
const LOCKED_BAND_GROUPS = [
  { key: "lte_bands", label: "LTE" },
  { key: "sa_nr_bands", label: "NR-SA" },
  { key: "nsa_nr_bands", label: "NR-NSA" },
] as const satisfies ReadonlyArray<{
  key: keyof ScenarioConfig;
  label: string;
}>;

/**
 * The tile's one-line band summary, or null when the scenario pins nothing.
 * Null is the honest "auto" signal — the caller prints a translated label for
 * it rather than this function inventing English.
 */
function lockedBandSummary(config: ScenarioConfig): string | null {
  const parts = LOCKED_BAND_GROUPS.map(({ key, label }) => {
    const raw = config[key];
    return raw ? `${label} ${bandsToDisplay(raw)}` : null;
  }).filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

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
  /**
   * "HH:MM" of this scenario's next scheduled activation, when — and only when —
   * an active profile's `scenario.schedule` actually names it. Undefined/null
   * renders NO schedule chip. Never derive this locally.
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

  const lockedBands = lockedBandSummary(scenario.config);
  const locksBands = lockedBands !== null;

  // At most one meta chip, in precedence order. `in_force` outranks a schedule
  // time because what the modem is running now beats what it will run later;
  // a schedule time outranks "locks bands" because the pills below already say
  // which bands are pinned, and only the chip can say when it changes.
  const metaChip: "in_force" | "schedule" | "locks_bands" | null = isActive
    ? "in_force"
    : nextFireAt
      ? "schedule"
      : locksBands
        ? "locks_bands"
        : null;

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
          SCENARIO_TILE_IDLE,
          "group cursor-pointer gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isActive
            ? PROFILE_ROW_ACTIVE_RING
            : isSelected
              ? SCENARIO_TILE_SELECTED_RING
              : "",
        )}
        whileHover={!isActive && !isSelected ? { scale: 1.01 } : {}}
        whileTap={{ scale: 0.99 }}
        // Canon curve rather than a spring: DESIGN.md's motion character is
        // expressive but settled, never springy.
        transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
        onClick={() => onSelect(scenario.id)}
        onKeyDown={handleKeyDown}
      >
        {/* Top row — identity disc, then the delete affordance and the single
            meta chip. The delete button is always in the layout (opacity only,
            never `hidden`) so revealing it on hover cannot shift the chip. */}
        <div className="flex items-start gap-2">
          {/* Glyph disc, matching the Banner primitive's Glyph-Disc Rule: a
              filled circle survives when a tint washes out. */}
          <span
            className={cn(
              SCENARIO_TILE_SHAPE.DISC,
              "bg-primary text-primary-foreground",
            )}
          >
            <MaterialSymbol name={scenario.icon} size={21} filled />
          </span>

          <div className="ml-auto flex items-center gap-1.5">
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

            {metaChip === "in_force" && (
              <Badge variant={activeBadge.variant}>
                <MaterialSymbol
                  name={activeBadge.glyph}
                  size={BADGE_GLYPH_SIZE}
                  filled
                />
                {t("scenarios.tile.in_force")}
              </Badge>
            )}

            {metaChip === "schedule" && (
              <span
                className={cn(
                  SCENARIO_META_CHIP,
                  "bg-surface-container-high text-on-surface-variant",
                )}
              >
                <MaterialSymbol name="schedule" size={BADGE_GLYPH_SIZE} />
                <span className="sr-only">
                  {t("scenarios.tile.next_fire_label")}
                </span>
                <span className={MACHINE_VALUE}>{nextFireAt}</span>
              </span>
            )}

            {metaChip === "locks_bands" && (
              <span
                className={cn(
                  SCENARIO_META_CHIP,
                  "bg-surface-container-high text-on-surface-variant",
                )}
              >
                <MaterialSymbol name="lock" size={BADGE_GLYPH_SIZE} />
                {t("scenarios.tile.locks_bands")}
              </span>
            )}
          </div>
        </div>

        {/* Identity. Both lines are user input on a custom scenario, so both
            truncate rather than reflowing the tile. */}
        <div className="mt-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[0.9375rem] font-semibold">
              {scenario.name}
            </h3>
            {!scenario.isDefault && (
              <span
                className={cn(
                  SCENARIO_META_CHIP,
                  "bg-surface-container-high text-on-surface-variant flex-none py-0.5",
                )}
              >
                {t("scenarios.tile.custom_tag")}
              </span>
            )}
          </div>
          <p className="text-on-surface-variant min-w-0 truncate text-xs">
            {scenario.description}
          </p>
        </div>

        {/* Config pills. The band pill takes the BRAND container when the
            scenario pins bands, so the lock reads before the text does; an auto
            scenario stays neutral, because "not locked" is not a state worth
            tinting. */}
        <div className="flex flex-wrap gap-1.5">
          <span
            className={cn(SCENARIO_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
          >
            {scenario.config.atModeValue}
          </span>
          {locksBands ? (
            <span
              className={cn(
                SCENARIO_PILL,
                CONFIG_PILL_BRAND,
                MACHINE_VALUE,
                "min-w-0",
              )}
            >
              <span className="min-w-0 truncate">{lockedBands}</span>
            </span>
          ) : (
            // Human voice — "Bands auto" is a sentence the UI wrote, not a
            // value the device emitted, so it does not take the mono face.
            <span className={cn(SCENARIO_PILL, CONFIG_PILL_NEUTRAL)}>
              {t("scenarios.tile.bands_auto")}
            </span>
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

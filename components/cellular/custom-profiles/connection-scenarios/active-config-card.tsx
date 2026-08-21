import React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  bandsLabel,
  modeLabel,
  optimizationLabel,
} from "@/components/cellular/custom-profiles/scenario-labels";
import { cn } from "@/lib/utils";
import {
  BADGE_GLYPH_SIZE,
  CONFIG_CARD_SHAPE,
  ICON_ACTION,
  MACHINE_VALUE,
  PILL_ACTION_SM,
  PROFILE_STATUS_BADGE,
  SCENARIO_DISC_ACTIVE,
  SCENARIO_DISC_IDLE,
  TILE_CAPTION,
} from "../shapes";
import { resolveScenarioIcon } from "./scenario-icons";
import type { Scenario } from "./scenario-item";

// =============================================================================
// ActiveConfigCard — the selected scenario's full radio configuration
// =============================================================================
// NO LONGER A `<Card>`. Since the route merge this renders INSIDE the scenarios
// card, and a card nested in a card is two shadowed shells claiming the same
// role. It is now an inner tonal block at `rounded-tile` — the inner-block
// radius the profile rows already use, one step below the `rounded-card` shell
// hosting it (Radius-Follows-Size).
//
// It also no longer declares `@container/card`. That name is OWNED by the
// parent card, and a nested container of the same name shadows it — the tile
// grid's `@md/card:grid-cols-2` would have started resolving against this block
// instead of the card. Nothing here queries a container, so the declaration was
// pure hazard.
//
// The status chips keep `PROFILE_STATUS_BADGE`. That map is the fix for this
// file's one real accessibility bug (a hand-drawn colour-only dot for
// Active/Not Active, indistinguishable under deuteranopia) — do not regress it.
//
// THE GLYPH IS RESOLVED HERE, not handed in pre-resolved. `Scenario.icon` is
// the persisted id (see `scenario-icons.ts`), and every render site on this
// surface crosses the id→ligature boundary itself via `resolveScenarioIcon`.
// This block used to render `scenario.icon` directly as a ligature, which only
// worked because its caller had already resolved it — and that pre-resolution
// is precisely what let the caller ship ligature names in an id-shaped field.
//
// It also prints the scenario DESCRIPTION. The re-authored tile dropped it (the
// tile now carries name / band tags / schedule caption), and a user-authored
// sentence that appears nowhere in the UI is a sentence the user cannot check.
// =============================================================================

interface ActiveConfigCardProps {
  scenario: Scenario | undefined;
  isActive: boolean;
  isActivating?: boolean;
  onEdit?: () => void;
  onActivate?: () => void;
  /** When true, hide/disable the Activate button — radio config is profile-
   *  owned. Passed in by ConnectionScenariosCard when a Custom SIM Profile
   *  with a bound scenario_id is active. */
  activateDisabled?: boolean;
  /** Display name of the active profile, used for the disabled-Activate
   *  tooltip. Only meaningful when activateDisabled is true. */
  activeProfileName?: string;
  /** "HH:MM" of the next scheduled scenario change, appended to the
   *  disabled-Activate tooltip when the lock comes from a schedule. */
  nextChangeAt?: string | null;
}

export const ActiveConfigCard = ({
  scenario,
  isActive,
  isActivating,
  onEdit,
  onActivate,
  activateDisabled,
  activeProfileName,
  nextChangeAt,
}: ActiveConfigCardProps) => {
  const { t } = useTranslation("cellular");

  if (!scenario) return null;
  const isCustom = !scenario.isDefault;

  const status = isActivating ? "applying" : isActive ? "active" : "inactive";
  const badge = PROFILE_STATUS_BADGE[status];
  const statusLabel = t(`scenarios.active_config.status.${status}`);

  const disabledTooltip =
    activateDisabled && activeProfileName
      ? t("scenarios.active_config.disabled_tooltip", {
          profile: activeProfileName,
        }) +
        (nextChangeAt
          ? t("scenarios.active_config.disabled_tooltip_next", {
              time: nextChangeAt,
            })
          : "")
      : undefined;

  return (
    <section className="bg-surface-container text-on-surface rounded-tile flex flex-col gap-5 p-5">
      {/* Header. Wraps rather than crushes: this now lives in a half-width
          column, where a fixed row put the identity block and the action
          cluster in a fight neither wins. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Same glyph disc the tile uses — and the same TONE RULE: filled
              only when the scenario is actually in force, neutral otherwise.
              It was pinned to `bg-primary` here regardless, so a scenario the
              user was merely inspecting wore the "this is running" fill while
              its own tile, three inches above, correctly did not. */}
          <div
            className={cn(
              CONFIG_CARD_SHAPE.DISC,
              isActive ? SCENARIO_DISC_ACTIVE : SCENARIO_DISC_IDLE,
            )}
          >
            <MaterialSymbol
              name={resolveScenarioIcon(scenario.icon)}
              size={24}
              filled
            />
          </div>
          <div className="grid min-w-0 gap-1">
            <h4 className="min-w-0 truncate font-semibold">
              {t("scenarios.active_config.title", { name: scenario.name })}
            </h4>
            {scenario.description && (
              <p className={cn(TILE_CAPTION, "min-w-0 truncate")}>
                {scenario.description}
              </p>
            )}
            <Badge variant={badge.variant} className="w-fit">
              <MaterialSymbol
                name={badge.glyph}
                size={BADGE_GLYPH_SIZE}
                className={
                  badge.spin ? "animate-spin motion-reduce:animate-none" : undefined
                }
              />
              {statusLabel}
            </Badge>
          </div>
        </div>
        <div className="ml-auto flex flex-none items-center gap-1">
          {isCustom && (
            <Button
              variant="ghost"
              aria-label={t("scenarios.active_config.edit_aria")}
              onClick={onEdit}
              className={ICON_ACTION}
            >
              <MaterialSymbol name="settings" size={18} />
            </Button>
          )}
          {!isActive && !isActivating && (
            <Button
              onClick={onActivate}
              className={PILL_ACTION_SM}
              disabled={activateDisabled}
              title={disabledTooltip}
            >
              {t("scenarios.active_config.activate")}
            </Button>
          )}
        </div>
      </div>

      {/* Config Details */}
      {/* Every value here is RESOLVED, not read. `config.mode` and
          `config.optimization` are stored English tokens (see
          `types/connection-scenario.ts`), and `bandsToDisplay` returns `null`
          for an empty lock rather than inventing the word "Auto" — so this
          block is where the five rows become the reader's language. */}
      <div className="flex flex-col gap-2">
        <ConfigRow
          label={t("scenarios.active_config.rows.network_mode")}
          value={modeLabel(t, scenario.config.atModeValue)}
        />
        <ConfigRow
          label={t("scenarios.active_config.rows.optimization")}
          value={optimizationLabel(t, scenario.config.optimization)}
        />
        <ConfigRow
          label={t("scenarios.active_config.rows.lte_bands")}
          value={bandsLabel(t, scenario.config.lte_bands)}
        />
        <ConfigRow
          label={t("scenarios.active_config.rows.nr_sa_bands")}
          value={bandsLabel(t, scenario.config.sa_nr_bands)}
        />
        <ConfigRow
          label={t("scenarios.active_config.rows.nr_nsa_bands")}
          value={bandsLabel(t, scenario.config.nsa_nr_bands)}
        />
      </div>
    </section>
  );
};

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    // `ROW_FILL` is `surface-container` — the same tone this block now sits on,
    // so the row takes the next step up to stay separable from its host. One
    // class, not a new shape: the geometry is still `CONFIG_CARD_SHAPE.ROW`.
    <div
      className={cn(
        CONFIG_CARD_SHAPE.ROW,
        CONFIG_CARD_SHAPE.ROW_FILL,
        "bg-surface-container-high gap-3",
      )}
    >
      <p className={cn(CONFIG_CARD_SHAPE.LABEL, "min-w-0 flex-none")}>{label}</p>
      <p
        className={cn(
          CONFIG_CARD_SHAPE.VALUE,
          MACHINE_VALUE,
          "min-w-0 truncate text-right",
        )}
      >
        {value}
      </p>
    </div>
  );
}

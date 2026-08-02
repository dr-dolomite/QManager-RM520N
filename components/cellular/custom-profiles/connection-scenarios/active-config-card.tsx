import React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { bandsToDisplay } from "@/types/connection-scenario";
import { cn } from "@/lib/utils";
import {
  BADGE_GLYPH_SIZE,
  CONFIG_CARD_SHAPE,
  MACHINE_VALUE,
  PROFILE_STATUS_BADGE,
} from "../shapes";
import type { Scenario } from "./scenario-item";

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
    <Card className="@container/card">
      <CardContent className="px-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Same filled glyph disc the tile uses, so the scenario keeps one
                identity across the picker and this detail card. */}
            <div
              className={cn(
                CONFIG_CARD_SHAPE.DISC,
                "bg-primary text-primary-foreground",
              )}
            >
              <MaterialSymbol name={scenario.icon} size={24} />
            </div>
            <div className="grid">
              <h4 className="font-semibold">
                {t("scenarios.active_config.title", { name: scenario.name })}
              </h4>
              <Badge variant={badge.variant}>
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
          <div className="flex items-center gap-1">
            {isCustom && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("scenarios.active_config.edit_aria")}
                onClick={onEdit}
              >
                <MaterialSymbol name="settings" size={16} />
              </Button>
            )}
            {!isActive && !isActivating && (
              <Button
                size="sm"
                onClick={onActivate}
                className="gap-1.5"
                disabled={activateDisabled}
                title={disabledTooltip}
              >
                {t("scenarios.active_config.activate")}
              </Button>
            )}
          </div>
        </div>

        {/* Config Details */}
        <div className="flex flex-col gap-2">
          <ConfigRow
            label={t("scenarios.active_config.rows.network_mode")}
            value={scenario.config.mode}
          />
          <ConfigRow
            label={t("scenarios.active_config.rows.optimization")}
            value={scenario.config.optimization}
          />
          <ConfigRow
            label={t("scenarios.active_config.rows.lte_bands")}
            value={bandsToDisplay(scenario.config.lte_bands)}
          />
          <ConfigRow
            label={t("scenarios.active_config.rows.nr_sa_bands")}
            value={bandsToDisplay(scenario.config.sa_nr_bands)}
          />
          <ConfigRow
            label={t("scenarios.active_config.rows.nr_nsa_bands")}
            value={bandsToDisplay(scenario.config.nsa_nr_bands)}
          />
        </div>
      </CardContent>
    </Card>
  );
};

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(CONFIG_CARD_SHAPE.ROW, CONFIG_CARD_SHAPE.ROW_FILL)}>
      <p className={CONFIG_CARD_SHAPE.LABEL}>{label}</p>
      <p className={cn(CONFIG_CARD_SHAPE.VALUE, MACHINE_VALUE)}>{value}</p>
    </div>
  );
}

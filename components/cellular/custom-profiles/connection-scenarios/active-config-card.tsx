import React from "react";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { bandsToDisplay } from "@/types/connection-scenario";
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
  if (!scenario) return null;
  const isCustom = !scenario.isDefault;

  return (
    <Card className="@container/card">
      <CardContent className="px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {/* Same filled glyph disc the tile uses, so the scenario keeps one
                identity across the picker and this detail card. */}
            <div className="bg-primary text-primary-foreground rounded-tile p-2.5">
              <MaterialSymbol name={scenario.icon} size={24} />
            </div>
            <div className="grid">
              <h4 className="font-semibold">{scenario.name} Configuration</h4>
              {isActivating ? (
                <Badge variant="info">
                  <Spinner className="h-2 w-2" />
                  Applying…
                </Badge>
              ) : isActive ? (
                <Badge variant="success">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  Active
                </Badge>
              ) : (
                <Badge variant="muted">
                  <div className="bg-on-surface-variant/50 h-2 w-2 rounded-full" />
                  Not Active
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isCustom && (
              <Button variant="ghost" size="icon" aria-label="Edit scenario settings" onClick={onEdit}>
                <MaterialSymbol name="settings" size={16} />
              </Button>
            )}
            {!isActive && !isActivating && (
              <Button
                size="sm"
                onClick={onActivate}
                className="gap-1.5"
                disabled={activateDisabled}
                title={
                  activateDisabled && activeProfileName
                    ? `Scenario activation is managed by the ${activeProfileName} Custom SIM Profile.${
                        nextChangeAt ? ` Next change at ${nextChangeAt}.` : ""
                      }`
                    : undefined
                }
              >
                Activate
              </Button>
            )}
          </div>
        </div>

        {/* Config Details */}
        <div className="grid gap-2">
          <Separator />
          <ConfigRow label="Network Mode" value={scenario.config.mode} />
          <Separator />
          <ConfigRow label="Optimization" value={scenario.config.optimization} />
          <Separator />
          <ConfigRow
            label="LTE Bands"
            value={bandsToDisplay(scenario.config.lte_bands)}
          />
          <Separator />
          <ConfigRow
            label="NR5G-SA Bands"
            value={bandsToDisplay(scenario.config.sa_nr_bands)}
          />
          <Separator />
          <ConfigRow
            label="NR5G-NSA Bands"
            value={bandsToDisplay(scenario.config.nsa_nr_bands)}
          />
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

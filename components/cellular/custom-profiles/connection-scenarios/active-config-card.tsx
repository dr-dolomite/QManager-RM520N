import React from "react";
import { Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
}

export const ActiveConfigCard = ({
  scenario,
  isActive,
  isActivating,
  onEdit,
  onActivate,
  activateDisabled,
  activeProfileName,
}: ActiveConfigCardProps) => {
  if (!scenario) return null;
  const Icon = scenario.icon;
  const isCustom = !scenario.isDefault;

  return (
    <Card className="@container/card">
      <CardContent className="px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-2.5 rounded-xl bg-linear-to-br text-white",
                scenario.gradient,
              )}
            >
              <Icon className="size-6" />
            </div>
            <div className="grid">
              <h4 className="font-semibold">{scenario.name} Configuration</h4>
              {isActivating ? (
                <Badge
                  variant="outline"
                  className="bg-info/15 text-info hover:bg-info/20 border-info/30"
                >
                  <Spinner className="h-2 w-2" />
                  Applying…
                </Badge>
              ) : isActive ? (
                <Badge
                  variant="outline"
                  className="bg-success/15 text-success hover:bg-success/20 border-success/30"
                >
                  <div className="w-2 h-2 rounded-full bg-success" />
                  Active
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground hover:bg-muted border-border"
                >
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                  Not Active
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isCustom && (
              <Button variant="ghost" size="icon" aria-label="Edit scenario settings" onClick={onEdit}>
                <Settings className="size-4" />
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
                    ? `Scenario activation is managed by the ${activeProfileName} Custom SIM Profile.`
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

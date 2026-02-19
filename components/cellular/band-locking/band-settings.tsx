"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TbInfoCircleFilled } from "react-icons/tb";
import {
  TriangleAlertIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { FailoverState } from "@/types/band-locking";
import type { CarrierComponent } from "@/types/modem-status";

// =============================================================================
// BandSettingsComponent — Failover Toggle + Active Bands Display
// =============================================================================
// Props come from BandLockingComponent (coordinator).
// Active bands are derived from carrier_components (QCAINFO data).
// =============================================================================

interface BandSettingsProps {
  /** Failover toggle + activation state */
  failover: FailoverState;
  /** Active carrier components from useModemStatus (QCAINFO Tier 2) */
  carrierComponents: CarrierComponent[];
  /** Callback to toggle failover on/off */
  onToggleFailover: (enabled: boolean) => Promise<boolean>;
  /** True while initial data is loading */
  isLoading: boolean;
  /** True when a Connection Scenario controls bands — disables failover toggle */
  isScenarioControlled?: boolean;
}

/**
 * Extract unique active band names from carrier_components for a given technology.
 * Returns sorted, comma-separated display string (e.g., "B1, B3, B7").
 */
function getActiveBandDisplay(
  components: CarrierComponent[],
  technology: "LTE" | "NR",
): string {
  const bands = components
    .filter((c) => c.technology === technology)
    .map((c) => c.band)
    .filter(Boolean);

  // Deduplicate (same band can appear as PCC + SCC in rare cases)
  const unique = [...new Set(bands)];

  if (unique.length === 0) return "—";

  // Sort numerically by band number (strip prefix for comparison)
  unique.sort((a, b) => {
    const numA = parseInt(a.replace(/^[BN]/, ""), 10);
    const numB = parseInt(b.replace(/^[BN]/, ""), 10);
    return numA - numB;
  });

  return unique.join(", ");
}

/**
 * Extract active E/ARFCNs from carrier_components for a given technology.
 * Returns comma-separated display string (e.g., "1850, 3050").
 * Includes duplicates since different carriers can share the same ARFCN.
 */
function getActiveArfcnDisplay(
  components: CarrierComponent[],
  technology: "LTE" | "NR",
): string {
  const arfcns = components
    .filter((c) => c.technology === technology && c.earfcn != null)
    .map((c) => c.earfcn as number);

  if (arfcns.length === 0) return "—";

  // Sort numerically, deduplicate
  const unique = [...new Set(arfcns)].sort((a, b) => a - b);
  return unique.join(", ");
}

const BandSettingsComponent = ({
  failover,
  carrierComponents,
  onToggleFailover,
  isLoading,
  isScenarioControlled = false,
}: BandSettingsProps) => {
  // --- Derive active bands from carrier_components --------------------------
  const activeLte = getActiveBandDisplay(carrierComponents, "LTE");
  const activeLteArfcn = getActiveArfcnDisplay(carrierComponents, "LTE");
  const activeNr = getActiveBandDisplay(carrierComponents, "NR");
  const activeNrArfcn = getActiveArfcnDisplay(carrierComponents, "NR");

  // --- Failover toggle handler ----------------------------------------------
  const handleFailoverToggle = async (checked: boolean) => {
    const success = await onToggleFailover(checked);
    if (success) {
      toast.success(`Failover ${checked ? "enabled" : "disabled"}`);
    } else {
      toast.error("Failed to toggle failover");
    }
  };

  // --- Failover status badge ------------------------------------------------
  const renderFailoverStatus = () => {
    if (isLoading) return <Skeleton className="h-5 w-32" />;

    if (!failover.enabled) {
      return (
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <MinusCircleIcon className="h-3 w-3" />
          Disabled
        </Badge>
      );
    }

    if (failover.activated) {
      return (
        <Badge
          variant="outline"
          className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm"
        >
          <TriangleAlertIcon className="h-3 w-3" />
          Using Default Bands
        </Badge>
      );
    }

    return (
      <Badge
        variant="outline"
        className="bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 border border-emerald-300/50 backdrop-blur-sm"
      >
        <CheckCircle2Icon className="h-3 w-3" />
        Ready
      </Badge>
    );
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Band Locking Settings</CardTitle>
        <CardDescription>
          Configure your cellular band locking preferences below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />

          {/* Failover Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When enabled, the device will automatically switch to the
                    default
                    <br />
                    bands if the locked bands are unavailable after 15 seconds.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Failover
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {isLoading ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <>
                  <Switch
                    id="band-failover"
                    checked={failover.enabled}
                    onCheckedChange={handleFailoverToggle}
                    disabled={isScenarioControlled}
                  />
                  <Label htmlFor="band-failover">
                    {failover.enabled ? "Enabled" : "Disabled"}
                  </Label>
                </>
              )}
            </div>
          </div>
          <Separator />

          {/* Failover Status */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Failover Status
            </p>
            <div className="flex items-center gap-1.5">
              {renderFailoverStatus()}
            </div>
          </div>
          <Separator />

          {/* Active LTE Bands */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Active LTE Bands
            </p>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Skeleton className="h-4 w-28" />
              ) : (
                <p className="text-sm font-semibold">{activeLte}</p>
              )}
            </div>
          </div>
          <Separator />

          {/* Active LTE EARFCNs */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Active LTE EARFCNs
            </p>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Skeleton className="h-4 w-28" />
              ) : (
                <p className="text-sm font-semibold">{activeLteArfcn}</p>
              )}
            </div>
          </div>
          <Separator />

          {/* Active NR Bands */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Active NR5G Bands
            </p>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Skeleton className="h-4 w-20" />
              ) : (
                <p className="text-sm font-semibold">{activeNr}</p>
              )}
            </div>
          </div>
          <Separator />

          {/* Active NR ARFCNs */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Active NR5G ARFCNs
            </p>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <p className="text-sm font-semibold">{activeNrArfcn}</p>
              )}
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default BandSettingsComponent;

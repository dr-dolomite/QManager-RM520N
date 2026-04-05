"use client";

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
  Loader2Icon,
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
      toast.success(`Band failover ${checked ? "enabled" : "disabled"}`);
    } else {
      toast.error("Failed to update band failover");
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
          className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
        >
          <TriangleAlertIcon className="h-3 w-3" />
          Fallback Active
        </Badge>
      );
    }

    if (failover.watcher_running) {
      return (
        <Badge
          variant="outline"
          className="bg-info/15 text-info hover:bg-info/20 border-info/30"
        >
          <Loader2Icon className="h-3 w-3 animate-spin" />
          Monitoring
        </Badge>
      );
    }

    return (
      <Badge
        variant="outline"
        className="bg-success/15 text-success hover:bg-success/20 border-success/30"
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
          Restrict the modem to specific LTE and 5G bands. Enable failover to fall back to all bands if locked bands lose signal.
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
                  <button type="button" className="inline-flex" aria-label="More info">
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
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
                Band Failover
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
              Band Failover Status
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
              Active LTE Channels
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
              Active 5G Bands
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
              Active 5G Channels
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

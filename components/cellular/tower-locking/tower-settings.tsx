"use client";

import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";

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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

import type {
  TowerLockConfig,
  TowerFailoverState,
} from "@/types/tower-locking";
import type { ModemStatus } from "@/types/modem-status";
import { rsrpToQualityPercent, qualityLevel } from "@/types/tower-locking";

interface TowerLockingSettingsProps {
  config: TowerLockConfig | null;
  failoverState: TowerFailoverState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  onPersistChange: (persist: boolean) => void;
  onFailoverChange: (enabled: boolean) => Promise<boolean>;
  isFailoverSaving: boolean;
  onThresholdChange: (threshold: number) => Promise<boolean>;
}

const TowerLockingSettingsComponent = ({
  config,
  failoverState,
  modemData,
  isLoading,
  onPersistChange,
  onFailoverChange,
  isFailoverSaving,
  onThresholdChange,
}: TowerLockingSettingsProps) => {
  const { t: tc } = useTranslation("common");

  // Whether any tower lock is active (from config — matches what failover daemon checks)
  const hasActiveLock = (config?.lte?.enabled || config?.nr_sa?.enabled) ?? false;

  // Local state for threshold input
  const [thresholdInput, setThresholdInput] = useState<string>("");
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const { saved: thresholdSaved, markSaved: markThresholdSaved } = useSaveFlash();

  // Sync threshold from config (adjust state during render)
  const [prevThreshold, setPrevThreshold] = useState<number | undefined>(
    undefined,
  );
  if (
    config?.failover?.threshold !== undefined &&
    config.failover.threshold !== prevThreshold
  ) {
    setPrevThreshold(config.failover.threshold);
    setThresholdInput(String(config.failover.threshold));
  }

  // Whether the input differs from the saved config value
  const thresholdDirty =
    thresholdInput !== String(config?.failover?.threshold ?? "");

  // Save threshold via Update button
  const handleThresholdSave = useCallback(async () => {
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 0 || val > 100) return;
    setIsSavingThreshold(true);
    const ok = await onThresholdChange(val);
    setIsSavingThreshold(false);
    if (ok) {
      markThresholdSaved();
      toast.success("Failover threshold updated");
    }
  }, [thresholdInput, onThresholdChange, markThresholdSaved]);

  // --- Determine which RSRP to use based on network type ---
  const networkType = modemData?.network?.type ?? "";
  let activeRsrp: number | null = null;
  let activeEarfcn: number | string = "-";
  let activePci: number | string = "-";

  if (networkType === "5G-SA") {
    activeRsrp = modemData?.nr?.rsrp ?? null;
    activeEarfcn = modemData?.nr?.arfcn ?? "-";
    activePci = modemData?.nr?.pci ?? "-";
  } else {
    // LTE or 5G-NSA — use LTE PCell
    activeRsrp = modemData?.lte?.rsrp ?? null;
    activeEarfcn = modemData?.lte?.earfcn ?? "-";
    activePci = modemData?.lte?.pci ?? "-";
  }

  const signalQualityPct = rsrpToQualityPercent(activeRsrp);
  const qualityLvl = qualityLevel(signalQualityPct);

  // --- Signal quality badge styling ---
  // `fair` and `poor` share the warning tone, and the two warning containers are
  // the same surface to the eye, so the glyph is the only thing separating them.
  // They previously shared TriangleAlertIcon too, which left the label doing all
  // the work; `poor` now carries a circle rather than a triangle.
  const qualityBadgeVariants: Record<string, BadgeVariant> = {
    good: "success",
    fair: "warning",
    poor: "warning",
    critical: "destructive",
    none: "muted",
  };

  const qualityIcons: Record<string, React.ReactNode> = {
    good: <MaterialSymbol name="check_circle" size={12} />,
    fair: <MaterialSymbol name="warning" size={12} />,
    poor: <MaterialSymbol name="error" size={12} />,
    critical: <MaterialSymbol name="cancel" size={12} />,
    none: <MaterialSymbol name="do_not_disturb_on" size={12} />,
  };

  // --- Failover status badge ---
  const renderFailoverBadge = () => {
    // Show loading only during initial load; after that show a fallback
    if (!failoverState && isLoading) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="progress_activity" size={12} className="animate-spin motion-reduce:animate-none" />
          Loading
        </Badge>
      );
    }

    if (!failoverState) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="do_not_disturb_on" size={12} />
          Unknown
        </Badge>
      );
    }

    if (failoverState.watcher_running) {
      return (
        <Badge variant="success">
          <MaterialSymbol name="check_circle" size={12} />
          Monitoring
        </Badge>
      );
    }

    if (failoverState.activated) {
      return (
        <Badge variant="warning">
          <MaterialSymbol name="warning" size={12} />
          Unlocked due to Poor Signal
        </Badge>
      );
    }

    if (!failoverState.enabled) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="do_not_disturb_on" size={12} />
          Disabled
        </Badge>
      );
    }

    return (
      <Badge variant="success">
        <MaterialSymbol name="check_circle" size={12} />
        Ready
      </Badge>
    );
  };

  // --- Schedule status badge ---
  const renderScheduleBadge = () => {
    // Show loading only during initial load; after that show a fallback
    if (!config && isLoading) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="progress_activity" size={12} className="animate-spin motion-reduce:animate-none" />
          Loading
        </Badge>
      );
    }

    if (!config) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="do_not_disturb_on" size={12} />
          Unknown
        </Badge>
      );
    }

    if (config.schedule.enabled) {
      return (
        <Badge variant="success">
          <MaterialSymbol name="check_circle" size={12} />
          Active
        </Badge>
      );
    }

    return (
      <Badge variant="muted">
        <MaterialSymbol name="do_not_disturb_on" size={12} />
        Inactive
      </Badge>
    );
  };

  // --- Connection state badge ---
  const renderConnectionStateBadge = () => {
    const serviceStatus = modemData?.network?.service_status;

    if (!modemData && isLoading) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="progress_activity" size={12} className="animate-spin motion-reduce:animate-none" />
          Loading
        </Badge>
      );
    }

    if (!modemData || !serviceStatus) {
      return (
        <Badge variant="muted">
          <MaterialSymbol name="do_not_disturb_on" size={12} />
          Unknown
        </Badge>
      );
    }

    switch (serviceStatus) {
      case "optimal":
      case "connected":
        return (
          <Badge variant="success">
            <MaterialSymbol name="check_circle" size={12} />
            Connected
          </Badge>
        );
      case "limited":
        return (
          <Badge variant="warning">
            <MaterialSymbol name="warning" size={12} />
            Limited Service
          </Badge>
        );
      case "searching":
        return (
          <Badge variant="warning">
            <MaterialSymbol name="warning" size={12} />
            Searching
          </Badge>
        );
      case "no_service":
        return (
          <Badge variant="destructive">
            <MaterialSymbol name="cancel" size={12} />
            No Service
          </Badge>
        );
      default:
        return (
          <Badge variant="muted">
            <MaterialSymbol name="do_not_disturb_on" size={12} />
            {serviceStatus}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Tower Locking Settings</CardTitle>
          <CardDescription>
            Lock the modem to a specific cell tower. Keeps your connection stable instead of roaming between towers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            {/* Persist Locking */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            {/* Failover */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            {/* Failover Threshold */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
            <Separator />
            {/* Current Signal Quality */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Separator />
            {/* Failover Status */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Separator />
            {/* Connection State */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Separator />
            {/* Schedule Locking Status */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Separator />
            {/* Active PCell E/AFRCN */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Separator />
            {/* Active PCell ID (PCI) */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Separator />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Tower Locking Settings</CardTitle>
        <CardDescription>
          Lock the modem to a specific cell tower. Keeps your connection stable instead of roaming between towers. Not compatible with 5G NSA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Keep Lock After Reboot info">
                    <MaterialSymbol name="info" filled size={20} className="text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When enabled, tower lock is restored automatically
                    after a reboot.
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="font-semibold text-muted-foreground text-sm">
                Keep Lock After Reboot
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="tower-persist"
                checked={config?.persist ?? false}
                disabled={!config}
                onCheckedChange={onPersistChange}
              />
              <Label htmlFor="tower-persist">
                {config?.persist ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Signal Failover info">
                    <MaterialSymbol name="info" filled size={20} className="text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When enabled, the device will unlock from the tower if
                    signal quality
                    <br />
                    degrades below a certain threshold or becomes unavailable.
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="font-semibold text-muted-foreground text-sm">
                Signal Failover
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="tower-failover"
                checked={config?.failover?.enabled ?? false}
                disabled={!config || !hasActiveLock || isFailoverSaving}
                onCheckedChange={async (checked) => {
                  const ok = await onFailoverChange(checked);
                  if (ok) {
                    if (checked) {
                      toast.success("Signal Failover enabled");
                    } else {
                      toast.warning("Signal Failover disabled");
                    }
                  } else {
                    toast.error(checked ? "Failed to enable Signal Failover" : "Failed to disable Signal Failover");
                  }
                }}
              />
              <Label htmlFor="tower-failover">
                {!hasActiveLock
                  ? "No active lock"
                  : (config?.failover?.enabled ?? false)
                    ? "Enabled"
                    : "Disabled"}
              </Label>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Failover Threshold info">
                    <MaterialSymbol name="info" filled size={20} className="text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    This will only take effect if Failover is enabled. Set the
                    signal quality
                    <br />
                    threshold below which the device will unlock from the tower.
                  </p>
                </TooltipContent>
              </Tooltip>
              <label
                htmlFor="failover-threshold"
                className="font-semibold text-muted-foreground text-sm"
              >
                Failover Threshold (%)
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <InputGroup>
                <InputGroupInput
                  id="failover-threshold"
                  type="text"
                  placeholder="Enter threshold"
                  className="w-10 h-6"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleThresholdSave();
                  }}
                />
                <InputGroupAddon align="inline-end">
                  %
                </InputGroupAddon>
              </InputGroup>
              {(thresholdDirty || thresholdSaved) && (
                <SaveButton
                  size="sm"
                  className="h-8"
                  isSaving={isSavingThreshold}
                  saved={thresholdSaved}
                  label={tc("actions.update")}
                  disabled={thresholdInput !== "" && (isNaN(Number(thresholdInput)) || Number(thresholdInput) < 0 || Number(thresholdInput) > 100)}
                  onClick={handleThresholdSave}
                />
              )}
            </div>
            {thresholdInput !== "" && (isNaN(Number(thresholdInput)) || Number(thresholdInput) < 0 || Number(thresholdInput) > 100) && (
              <p className="text-sm text-destructive" role="alert">
                Threshold must be between 0 and 100
              </p>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Current Signal Quality
            </span>
            <div className="flex items-center gap-1.5">
              <Badge variant={qualityBadgeVariants[qualityLvl]}>
                {qualityIcons[qualityLvl]}
                {activeRsrp !== null ? `${signalQualityPct}%` : "N/A"}
              </Badge>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Failover Status
            </span>
            <div className="flex items-center gap-1.5">
              {renderFailoverBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Connection State
            </span>
            <div className="flex items-center gap-1.5">
              {renderConnectionStateBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Schedule Locking Status
            </span>
            <div className="flex items-center gap-1.5">
              {renderScheduleBadge()}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Current Channel (EARFCN)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">
                {activeEarfcn !== null ? String(activeEarfcn) : "-"}
              </span>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">
              Current Cell ID (PCI)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">
                {activePci !== null ? String(activePci) : "-"}
              </span>
            </div>
          </div>
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
};

export default TowerLockingSettingsComponent;

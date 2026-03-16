"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DogIcon, InfoIcon, Loader2 } from "lucide-react";
import { useModemStatus } from "@/hooks/use-modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import type { WatchcatState } from "@/types/modem-status";

interface WatchdogStatusCardProps {
  revertSim: () => Promise<boolean>;
}

const STATE_BADGE_CONFIG: Record<
  WatchcatState,
  { label: string; className: string }
> = {
  monitor: {
    label: "Monitoring",
    className: "bg-success text-success-foreground border-success",
  },
  suspect: {
    label: "Detecting Issue",
    className: "bg-warning text-warning-foreground border-warning",
  },
  recovery: {
    label: "Recovering",
    className:
      "bg-destructive text-destructive-foreground border-destructive animate-pulse motion-reduce:animate-none",
  },
  cooldown: {
    label: "Cooldown",
    className: "bg-info text-info-foreground border-info",
  },
  locked: {
    label: "Locked",
    className: "bg-muted text-muted-foreground border-border",
  },
  disabled: {
    label: "Disabled",
    className: "bg-muted text-muted-foreground border-border",
  },
};

const TIER_LABELS: Record<number, string> = {
  0: "\u2014",
  1: "Restart Network Interface",
  2: "Restart Modem Radio",
  3: "Switch to Backup SIM",
  4: "Reboot Device",
};

export function WatchdogStatusCard({ revertSim }: WatchdogStatusCardProps) {
  const { data: modemStatus, isLoading } = useModemStatus({
    pollInterval: 5000,
  });
  const [isReverting, setIsReverting] = useState(false);

  const handleRevertSim = useCallback(async () => {
    setIsReverting(true);
    try {
      const success = await revertSim();
      if (success) {
        toast.success(
          "SIM revert requested. The watchdog will process this shortly."
        );
      } else {
        toast.error("Failed to request SIM revert");
      }
    } finally {
      setIsReverting(false);
    }
  }, [revertSim]);

  const watchcat = modemStatus?.watchcat;
  const simFailover = modemStatus?.sim_failover;

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Watchdog Status</CardTitle>
          <CardDescription>Live connection health status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-28" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty/disabled state
  if (!watchcat || !watchcat.enabled) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Watchdog Status</CardTitle>
          <CardDescription>Live connection health status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <DogIcon className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Watchdog is not active. Enable it in Settings to begin monitoring
              connection health.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stateKey = (watchcat.state as WatchcatState) || "disabled";
  const badge = STATE_BADGE_CONFIG[stateKey] || STATE_BADGE_CONFIG.disabled;
  const tierLabel = TIER_LABELS[watchcat.current_tier] || TIER_LABELS[0];

  const statusRows: { label: string; value: React.ReactNode }[] = [
    { label: "Current Step", value: tierLabel },
    {
      label: "Failed Checks",
      value: <span className="font-mono">{watchcat.failure_count}</span>,
    },
    ...(watchcat.cooldown_remaining > 0
      ? [
          {
            label: "Cooldown",
            value: (
              <span className="font-mono">
                {watchcat.cooldown_remaining}s remaining
              </span>
            ),
          },
        ]
      : []),
    {
      label: "Total Recoveries",
      value: <span className="font-mono">{watchcat.total_recoveries}</span>,
    },
    {
      label: "Reboots This Hour",
      value: <span className="font-mono">{watchcat.reboots_this_hour}</span>,
    },
    ...(watchcat.last_recovery_time != null
      ? [
          {
            label: "Last Recovery",
            value: (
              <span>
                {TIER_LABELS[watchcat.last_recovery_tier ?? 0]}{" "}
                <span className="text-muted-foreground">
                  ({formatTimeAgo(watchcat.last_recovery_time)})
                </span>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Watchdog Status</CardTitle>
            <CardDescription>Live connection health status.</CardDescription>
          </div>
          <Badge className={badge.className}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Status rows — data-driven for clean conditional rendering */}
          <dl className="grid grid-cols-[auto_1fr] @xs/card:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {statusRows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>

          {/* SIM Failover section */}
          {simFailover?.active && (
            <div className="pt-3 border-t">
              <Alert className="mb-3">
                <InfoIcon className="size-4" />
                <AlertDescription>
                  Running on backup SIM (slot {simFailover.current_slot}) since{" "}
                  {simFailover.switched_at
                    ? formatTimeAgo(simFailover.switched_at)
                    : "recently"}
                  . Original SIM was in slot {simFailover.original_slot}.
                </AlertDescription>
              </Alert>

              {/* H1: Confirmation dialog for destructive SIM revert */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isReverting}
                  >
                    {isReverting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Reverting…
                      </>
                    ) : (
                      "Revert to Original SIM"
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Revert to Original SIM?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will switch back to SIM slot{" "}
                      {simFailover.original_slot}. Your internet will briefly
                      disconnect while the modem reconnects.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRevertSim}>
                      Revert SIM
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

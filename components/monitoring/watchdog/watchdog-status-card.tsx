"use client";

import React, { useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DogIcon, InfoIcon, Loader2 } from "lucide-react";
import { useModemStatus } from "@/hooks/use-modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import type { WatchcatState } from "@/types/modem-status";

interface WatchdogStatusCardProps {
  revertSim: () => Promise<boolean>;
  /** Whether the user has enabled watchdog in settings (from CGI, not daemon) */
  settingsEnabled?: boolean;
}

const STATE_BADGE_CONFIG: Record<
  WatchcatState,
  { label: string; variant: "success" | "warning" | "destructive" | "info" | "secondary"; className?: string }
> = {
  monitor: {
    label: "Monitoring",
    variant: "success",
  },
  suspect: {
    label: "Detecting Issue",
    variant: "warning",
  },
  recovery: {
    label: "Recovering",
    variant: "destructive",
    className: "animate-pulse motion-reduce:animate-none",
  },
  cooldown: {
    label: "Cooldown",
    variant: "info",
  },
  locked: {
    label: "Locked",
    variant: "secondary",
  },
  disabled: {
    label: "Disabled",
    variant: "secondary",
  },
};

const TIER_LABELS: Record<number, string> = {
  0: "\u2014",
  1: "Restart Network Interface",
  2: "Restart Modem Radio",
  3: "Switch to Backup SIM",
  4: "Reboot Device",
};

export function WatchdogStatusCard({
  revertSim,
  settingsEnabled,
}: WatchdogStatusCardProps) {
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
          "SIM revert requested. The watchdog will process this shortly.",
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
  const daemonReporting = watchcat?.enabled;
  const enabledButNotReporting = settingsEnabled && !daemonReporting;

  if (!daemonReporting && !enabledButNotReporting) {
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

  // Enabled in settings but daemon hasn't reported yet (starting up / boot settle)
  if (enabledButNotReporting) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Watchdog Status</CardTitle>
          <CardDescription>Live connection health status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="size-10 text-muted-foreground animate-spin" />
            <p className="text-sm text-muted-foreground text-center">
              Watchdog is starting up. It will begin monitoring shortly.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // At this point watchcat is guaranteed to be defined and enabled
  // (both early returns above handle the undefined/disabled cases)
  if (!watchcat) return null;

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
        <CardTitle>Watchdog Status</CardTitle>
        <CardDescription>Live connection health status.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {/* State badge — animates when state changes */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">State</p>
            <AnimatePresence mode="wait">
              <motion.div
                key={stateKey}
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.88 }}
                transition={{ duration: 0.18, type: "spring", stiffness: 400, damping: 24 }}
              >
                <Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge>
              </motion.div>
            </AnimatePresence>
          </div>
          {/* Status rows — stagger in on mount */}
          <motion.div
            className="grid gap-2"
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
          >
            {statusRows.map((row) => (
              <motion.div
                key={row.label}
                variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Separator />
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm font-semibold text-muted-foreground">
                    {row.label}
                  </p>
                  <p className="text-sm font-semibold">{row.value}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
          <Separator />

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
                    <AlertDialogTitle>Revert to Original SIM?</AlertDialogTitle>
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

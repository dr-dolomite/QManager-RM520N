"use client";

import React, { useCallback, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  Card,
  CardAction,
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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InfoIcon,
  Loader2,
  CheckCircle2Icon,
  TriangleAlertIcon,
  AlertCircleIcon,
  ClockIcon,
  LockIcon,
  MinusCircleIcon,
  PowerOffIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useModemStatus } from "@/hooks/use-modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import type { WatchcatState } from "@/types/modem-status";
import type { WatchdogSettings } from "@/hooks/use-watchdog-settings";
import type { WatchdogForm } from "./use-watchdog-form";

interface WatchdogStatusCardProps {
  form: WatchdogForm;
  /** Server-truth settings — the hero reflects SAVED state, never form drafts. */
  settings: WatchdogSettings;
  autoDisabled: boolean;
  revertSim: () => Promise<boolean>;
}

type HeroTone = "success" | "warning" | "destructive" | "info" | "muted";

const STATE_META: Record<
  WatchcatState,
  { tone: HeroTone; icon: React.ReactNode; pulse?: boolean }
> = {
  monitor: { tone: "success", icon: <CheckCircle2Icon className="size-6" /> },
  suspect: { tone: "warning", icon: <TriangleAlertIcon className="size-6" /> },
  recovery: {
    tone: "destructive",
    icon: <AlertCircleIcon className="size-6" />,
    pulse: true,
  },
  cooldown: { tone: "info", icon: <ClockIcon className="size-6" /> },
  locked: { tone: "muted", icon: <LockIcon className="size-6" /> },
  disabled: { tone: "muted", icon: <MinusCircleIcon className="size-6" /> },
};

// State-name labels reuse the target status card's established copy.
const STATE_LABELS: Record<WatchcatState, string> = {
  monitor: "Monitoring",
  suspect: "Detecting Issue",
  recovery: "Recovering",
  cooldown: "Cooldown",
  locked: "Locked",
  disabled: "Disabled",
};

const STATE_BLURBS: Record<WatchcatState, string> = {
  monitor: "Connection is healthy. Watching for outages.",
  suspect: "A connectivity check just failed. Confirming before acting.",
  recovery: "Working through the recovery ladder to restore the connection.",
  cooldown: "Waiting for the last recovery step to settle before rechecking.",
  locked: "Recovery is paused after hitting the reboot limit.",
  disabled: "The watchdog is not monitoring the connection.",
};

// Full recovery-tier names, shared with the settings ladder for consistency.
const TIER_NAMES = [
  "Re-register to Network",
  "Restart Modem Radio",
  "Switch to Backup SIM",
  "Reboot Device",
];

const TONE_RING: Record<HeroTone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-info/15 text-info border-info/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/25",
};

const TONE_TILE: Record<HeroTone, string> = {
  success: "border-success/25 bg-success/5",
  warning: "border-warning/25 bg-warning/5",
  destructive: "border-destructive/25 bg-destructive/5",
  info: "border-info/25 bg-info/5",
  muted: "border-border bg-muted/20",
};

const stepLabel = (tier: number | null | undefined) =>
  tier ? `Tier ${tier}` : "None";

export function WatchdogStatusCard({
  form,
  settings,
  autoDisabled,
  revertSim,
}: WatchdogStatusCardProps) {
  const { data: modemStatus, isLoading } = useModemStatus({
    pollInterval: 5000,
  });
  const [isReverting, setIsReverting] = useState(false);
  const reduceMotion = useReducedMotion();

  const handleRevertSim = useCallback(async () => {
    setIsReverting(true);
    try {
      const ok = await revertSim();
      if (ok) {
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
  const daemonReporting = watchcat?.enabled;
  // Saved-State Honesty: the branch reflects SAVED settings + daemon truth, not
  // the (possibly dirty) master toggle. The toggle applies on Save.
  const savedEnabled = settings.enabled;

  const header = (
    <CardHeader>
      <CardTitle>Watchdog Status</CardTitle>
      <CardDescription>Live connection health status.</CardDescription>
      <CardAction>
        <Switch
          id="watchdog-enabled"
          checked={form.isEnabled}
          onCheckedChange={form.setIsEnabled}
          aria-label="Enable watchdog"
        />
      </CardAction>
    </CardHeader>
  );

  // ---- Loading (Skeleton-Mirror handled by the page-level skeleton) ----
  if (isLoading && !watchcat) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <StateTile
            tone="muted"
            icon={
              <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
            }
            title="Starting Up"
            subtitle="The watchdog is starting up."
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Off (saved disabled) ----
  if (!savedEnabled) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="grid gap-4">
          {autoDisabled && <AutoDisabledAlert />}
          <StateTile
            tone="muted"
            icon={<PowerOffIcon className="size-6" />}
            title="Watchdog Off"
            subtitle="Enable it above to begin monitoring connection health."
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Settling (saved enabled, daemon not reporting yet) ----
  if (!daemonReporting) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="grid gap-4">
          {autoDisabled && <AutoDisabledAlert />}
          <StateTile
            tone="info"
            icon={
              <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
            }
            title="Starting Up"
            subtitle="It will begin monitoring shortly."
            reduceMotion={reduceMotion}
          />
        </CardContent>
      </Card>
    );
  }

  // ---- Live ----
  const stateKey = (watchcat!.state as WatchcatState) || "disabled";
  const meta = STATE_META[stateKey] ?? STATE_META.disabled;
  const runningTier = watchcat!.current_tier;

  const stats: {
    key: string;
    label: string;
    value: React.ReactNode;
    tint?: "warning";
  }[] = [
    {
      key: "step",
      label: "Current Step",
      value: stepLabel(watchcat!.current_tier),
    },
    {
      key: "failed",
      label: "Failed Checks",
      value: watchcat!.failure_count,
      tint: watchcat!.failure_count > 0 ? "warning" : undefined,
    },
    // Cooldown only when actually counting down — an honest readout of the
    // SIM-settle floor when a Tier-3 swap is settling.
    ...(watchcat!.cooldown_remaining > 0
      ? [
          {
            key: "cooldown",
            label: "Cooldown",
            value: `${watchcat!.cooldown_remaining}s remaining`,
          },
        ]
      : []),
    {
      key: "recoveries",
      label: "Total Recoveries",
      value: watchcat!.total_recoveries,
    },
    {
      key: "reboots",
      label: "Reboots This Hour",
      value: watchcat!.reboots_this_hour,
      tint: watchcat!.reboots_this_hour > 0 ? "warning" : undefined,
    },
    {
      key: "last",
      label: "Last Recovery",
      value:
        watchcat!.last_recovery_time != null ? (
          watchcat!.last_recovery_tier ? (
            <span>
              {stepLabel(watchcat!.last_recovery_tier)}
              <span className="text-muted-foreground font-normal">
                {" "}
                ({formatTimeAgo(watchcat!.last_recovery_time)})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">
              {formatTimeAgo(watchcat!.last_recovery_time)}
            </span>
          )
        ) : (
          <span className="text-muted-foreground font-normal">None</span>
        ),
    },
  ];

  return (
    <Card className="@container/card">
      {header}
      <CardContent className="grid gap-5">
        {autoDisabled && <AutoDisabledAlert />}

        {/* Screen-reader announcement of state-name changes. */}
        <p className="sr-only" role="status" aria-live="polite">
          Watchdog state: {STATE_LABELS[stateKey] ?? STATE_LABELS.disabled}
        </p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stateKey}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
          >
            <StateTile
              tone={meta.tone}
              icon={meta.icon}
              pulse={meta.pulse}
              title={STATE_LABELS[stateKey] ?? STATE_LABELS.disabled}
              subtitle={STATE_BLURBS[stateKey] ?? ""}
              reduceMotion={reduceMotion}
            />
          </motion.div>
        </AnimatePresence>

        {/* Hairline divider, then the counter strip. */}
        <div className="border-t pt-5">
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            {stats.map((s) => (
              <div key={s.key} className="grid gap-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {s.label}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    s.tint === "warning" && "text-warning",
                  )}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Read-only ladder stepper — the SAVED enabled state of the four tiers,
            with the currently-running tier highlighted. Saved-State Honesty:
            reads server truth, never form drafts. */}
        <HeroLadder
          savedTiers={[
            settings.tier1_enabled,
            settings.tier2_enabled,
            settings.tier3_enabled,
            settings.tier4_enabled,
          ]}
          runningTier={runningTier}
        />

        {simFailover?.active && (
          <div className="border-t pt-5">
            <Alert className="mb-3">
              <InfoIcon className="size-4" />
              <AlertDescription>
                <p>
                  Running on backup SIM (slot {simFailover.current_slot}) since{" "}
                  {simFailover.switched_at
                    ? formatTimeAgo(simFailover.switched_at)
                    : "recently"}
                  . Original SIM was in slot {simFailover.original_slot}.
                </p>
              </AlertDescription>
            </Alert>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isReverting}>
                  {isReverting ? (
                    <>
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
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
      </CardContent>
    </Card>
  );
}

function AutoDisabledAlert() {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon className="size-4" />
      <AlertDescription>
        <p>
          Watchdog disabled itself after too many reboots in one hour. Re-enable
          it once your connection is stable.
        </p>
      </AlertDescription>
    </Alert>
  );
}

// -----------------------------------------------------------------------------
// State tile — the single "what is it doing right now" focal element.
// -----------------------------------------------------------------------------
function StateTile({
  tone,
  icon,
  title,
  subtitle,
  pulse,
  reduceMotion,
}: {
  tone: HeroTone;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pulse?: boolean;
  reduceMotion: boolean | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border p-4",
        TONE_TILE[tone],
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full border",
          TONE_RING[tone],
          pulse && !reduceMotion && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-base font-semibold">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground text-sm">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Hero ladder — a compact, read-only stepper of the four recovery tiers showing
// their SAVED enabled state and which one (if any) is running right now.
// -----------------------------------------------------------------------------
function HeroLadder({
  savedTiers,
  runningTier,
}: {
  savedTiers: boolean[];
  runningTier: number;
}) {
  return (
    <div className="border-t pt-5" aria-label="Recovery ladder" role="group">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          Recovery ladder
        </span>
      </div>
      <ol className="flex items-center gap-1.5">
        {savedTiers.map((enabled, i) => {
          const tier = i + 1;
          const running = runningTier === tier;
          const srText = running
            ? `${TIER_NAMES[i]}: running now`
            : enabled
              ? `${TIER_NAMES[i]}: enabled`
              : `${TIER_NAMES[i]}: disabled`;
          return (
            <li key={tier} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                  running
                    ? "border-warning/40 bg-warning/15 text-warning ring-warning/30 ring-2"
                    : enabled
                      ? "border-transparent bg-secondary text-secondary-foreground"
                      : "border-border bg-muted/40 text-muted-foreground",
                )}
                aria-hidden
              >
                {tier}
              </span>
              <span className="sr-only">{srText}</span>
              {i < savedTiers.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px min-w-4 flex-1",
                    enabled && savedTiers[i + 1] ? "bg-secondary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

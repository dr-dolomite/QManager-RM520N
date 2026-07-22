"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";
import { useAlerts, type UseAlertsReturn } from "@/hooks/use-alerts";
import { ALERT_EVENT_ORDER, ALERT_CHANNEL_ORDER } from "@/types/alerts";
import type { AlertsState } from "@/types/alerts";
import { useAlertsForm } from "./use-alerts-form";
import { AlertsStatusCard } from "./alerts-status-card";
import { AlertsSettingsCard } from "./alerts-settings-card";
import { AlertsLogCard, AlertsActivityTableSkeleton } from "./alerts-log-card";

// -----------------------------------------------------------------------------
// Alerts — page coordinator (status-first anatomy, 2-col desktop).
// -----------------------------------------------------------------------------
// The left column reads top-to-bottom (Channel Readiness → Activity) while the
// right holds the one write surface (Settings) for its full height. One
// `useAlerts` instance owns fetch/save/test/install; one `useAlertsForm`
// (remounted on a settings signature after every save) owns the whole editable
// form, and its single sticky Save bar commits every channel + the routing map.
// -----------------------------------------------------------------------------
const AlertsComponent = () => {
  const hook = useAlerts();

  return (
    <div className="@container/main mx-auto flex flex-col gap-6 p-2">
      <div>
        <h1 className="mb-2 text-3xl font-bold">Alerts</h1>
        <p className="text-muted-foreground">
          Get notified by SMS, email, or Discord when your connection drops and
          when it comes back.
        </p>
      </div>

      {hook.isLoading || !hook.state ? (
        <PageSkeleton />
      ) : (
        <AlertsBody
          key={settingsSignature(hook.state)}
          hook={hook}
          state={hook.state}
        />
      )}
    </div>
  );
};

function settingsSignature(state: AlertsState): string {
  const { sms, email, discord } = state.channels;
  const routing = ALERT_EVENT_ORDER.flatMap((ev) =>
    ALERT_CHANNEL_ORDER.map((ch) =>
      state.routing.events[ev]?.[ch] ? "1" : "0",
    ),
  ).join("");
  return [
    sms.enabled,
    sms.recipient_phone,
    sms.threshold_minutes,
    email.enabled,
    email.sender_email,
    email.recipient_email,
    email.app_password_set,
    email.threshold_minutes,
    email.msmtp_installed,
    discord.enabled,
    discord.owner_discord_id,
    discord.token_set,
    discord.threshold_minutes,
    discord.connected,
    routing,
  ].join("|");
}

function AlertsBody({
  hook,
  state,
}: {
  hook: UseAlertsReturn;
  state: AlertsState;
}) {
  const form = useAlertsForm({ state, isSaving: hook.isSaving });
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const bumpLog = useCallback(() => setLogRefreshKey((k) => k + 1), []);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 gap-6 @4xl/main:grid-cols-2 @4xl/main:items-stretch"
    >
      <motion.div
        variants={staggerItem}
        className="flex flex-col gap-6 @4xl/main:h-full"
      >
        <AlertsStatusCard state={state} />
        <AlertsLogCard refreshKey={logRefreshKey} reboots={state.reboots} />
      </motion.div>
      <motion.div
        variants={staggerItem}
        className="flex flex-col @4xl/main:h-full"
      >
        <AlertsSettingsCard
          form={form}
          state={state}
          hook={hook}
          onTested={bumpLog}
        />
      </motion.div>
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// Page skeleton — mirrors the live column geometry so content fills with no
// reflow (Skeleton-Mirror rule).
// -----------------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-6 @4xl/main:grid-cols-2 @4xl/main:items-stretch"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col gap-6 @4xl/main:h-full">
        <StatusSkeleton />
        <LogSkeleton />
      </div>
      <div className="flex flex-col @4xl/main:h-full">
        <SettingsSkeleton />
      </div>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <CardTitle>Alert channels</CardTitle>
        <CardDescription>
          Where QManager will reach you when the connection changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Channel readiness tiles — same DOM shape as the loaded tile (icon
            circle + name/badge row + detail line) so the row height the grid
            settles on doesn't jump once real copy replaces the placeholders. */}
        <div className="grid gap-3 @md/card:grid-cols-2 @2xl/card:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border p-3.5"
            >
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full max-w-36" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t pt-5">
          <span className="text-muted-foreground text-xs font-medium">
            What fires where
          </span>
          <div className="mt-3 grid gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// SettingsSkeleton — mirrors the Routing tab, the tab the page always lands
// on first, NOT the SMS/Email/Discord field-form shape. Loading briefly into
// the wrong tab's layout is its own reflow bug (Skeleton-Mirror rule).
// -----------------------------------------------------------------------------
function SettingsSkeleton() {
  return (
    <Card className="@container/card min-h-0 flex-1" aria-hidden>
      <CardHeader>
        <CardTitle>Alert Settings</CardTitle>
        <CardDescription>
          Choose which events reach each channel, then configure SMS, email,
          and Discord.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Skeleton className="h-9 w-full rounded-md" />
        <p className="text-muted-foreground mt-5 mb-4 text-sm">
          Pick which events go to which channel. Some combinations
          aren&apos;t possible and are shown as unavailable.
        </p>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-1 pb-3">
            <div className="flex-1" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="grid w-20 shrink-0 justify-items-center gap-1"
              >
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
          <div className="grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1 py-3.5",
                  i < 2 && "border-b",
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
                  <div className="grid min-w-0 gap-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
                {Array.from({ length: 3 }).map((_, j) => (
                  <div
                    key={j}
                    className="flex w-20 shrink-0 items-center justify-center"
                  >
                    <Skeleton className="h-5 w-9 rounded-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Turn a channel on in its tab to route events to it.
        </p>
        <div className="-mx-6 -mb-6 mt-6 flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4">
          <Skeleton className="h-3.5 w-28" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LogSkeleton() {
  return (
    <Card className="@container/card min-h-0 flex-1" aria-hidden>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              Sent alerts and recorded reboots, newest first.
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" disabled tabIndex={-1}>
            <RefreshCcwIcon className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <AlertsActivityTableSkeleton />
      </CardContent>
    </Card>
  );
}

export default AlertsComponent;

"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";
import { useAlerts, type UseAlertsReturn } from "@/hooks/use-alerts";
import { ALERT_EVENT_ORDER, ALERT_CHANNEL_ORDER } from "@/types/alerts";
import type { AlertsState } from "@/types/alerts";
import { useAlertsForm } from "./use-alerts-form";
import { AlertsStatusCard } from "./alerts-status-card";
import { AlertsSettingsCard } from "./alerts-settings-card";
import { AlertsLogCard } from "./alerts-log-card";

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
      <motion.div variants={staggerItem}>
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
      className="grid grid-cols-1 items-start gap-6 @4xl/main:grid-cols-2"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col gap-6">
        <StatusSkeleton />
        <LogSkeleton />
      </div>
      <SettingsSkeleton />
    </div>
  );
}

function StatusSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 @md/card:grid-cols-2 @2xl/card:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[70px] w-full rounded-xl" />
          ))}
        </div>
        <div className="border-t pt-5">
          <Skeleton className="mb-3 h-3 w-24" />
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="mt-5 grid gap-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full max-w-sm rounded-md" />
          </div>
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full max-w-[18rem] rounded-md" />
          </div>
        </div>
        <div className="-mx-6 -mb-6 mt-6 flex items-center justify-between gap-3 border-t px-6 py-4">
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
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="grid gap-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="size-8 rounded-md" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <div className="border-b px-4 py-3">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-14" />
            </div>
          </div>
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3 border-t pt-4">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-32" />
      </CardFooter>
    </Card>
  );
}

export default AlertsComponent;

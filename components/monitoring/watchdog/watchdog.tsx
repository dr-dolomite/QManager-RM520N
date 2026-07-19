"use client";

import { useWatchdogSettings } from "@/hooks/use-watchdog-settings";
import type { UseWatchdogSettingsReturn } from "@/hooks/use-watchdog-settings";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchdogForm } from "./use-watchdog-form";
import { WatchdogStatusCard } from "./watchdog-status-card";
import { WatchdogSettingsCard } from "./watchdog-settings-card";
import { WatchdogRecoveryActivityCard } from "./watchdog-recovery-activity-card";

// -----------------------------------------------------------------------------
// Connection Watchdog — page coordinator (status-first anatomy, 2-col desktop).
// -----------------------------------------------------------------------------
// Desktop widens into two columns: the left reads top-to-bottom (Live Status →
// Recovery Activity) while the right holds the one write surface (Settings)
// for its full height, so scanning state and editing configuration sit side
// by side instead of stacked in sequence. Narrower viewports fall back to the
// single-column status → settings → activity order. Because the backend save
// is atomic, one `useWatchdogForm` instance owns the whole form and every card
// consumes the slice it renders; the single Save / Discard pair lives in the
// settings card's sticky bar and commits every change.
const WatchdogComponent = () => {
  const hookData = useWatchdogSettings();

  return (
    <div className="@container/main mx-auto flex flex-col gap-6 p-2">
      <div>
        <h1 className="mb-2 text-3xl font-bold">Watchdog</h1>
        <p className="text-muted-foreground">
          Automatically detect and recover from internet outages with escalating
          recovery steps.
        </p>
      </div>

      {hookData.isLoading || !hookData.settings ? (
        <PageSkeleton />
      ) : (
        <WatchdogForm
          // Remount on a settings signature so the form re-seeds from fresh
          // server truth after every save / background refetch.
          key={settingsSignature(hookData)}
          hookData={hookData}
        />
      )}
    </div>
  );
};

function settingsSignature(hookData: UseWatchdogSettingsReturn): string {
  const s = hookData.settings;
  if (!s) return "empty";
  return [
    s.enabled,
    s.fail_threshold,
    s.probe_interval,
    s.check_interval,
    s.cooldown,
    s.tier1_enabled,
    s.tier2_enabled,
    s.tier3_enabled,
    s.tier4_enabled,
    s.backup_sim_slot,
    s.max_reboots_per_hour,
  ].join("-");
}

function WatchdogForm({ hookData }: { hookData: UseWatchdogSettingsReturn }) {
  const { settings, isSaving, error, saveSettings, autoDisabled, revertSim } =
    hookData;

  // settings is guaranteed non-null by the caller's guard.
  const form = useWatchdogForm({
    settings: settings!,
    isSaving,
    error,
    saveSettings,
  });

  return (
    <div className="grid grid-cols-1 gap-6 @4xl/main:grid-cols-2 @4xl/main:items-stretch">
      <div className="flex flex-col gap-6 @4xl/main:h-full">
        <WatchdogStatusCard
          form={form}
          settings={settings!}
          autoDisabled={autoDisabled}
          revertSim={revertSim}
        />
        <WatchdogRecoveryActivityCard />
      </div>
      <WatchdogSettingsCard form={form} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Page skeleton — mirrors the live column geometry (Skeleton-Mirror rule) so
// content replacement is a clean fill with zero reflow. Each sub-skeleton is
// shaped to the state its card lands in *next*: Status → the live hero, Activity
// → the recovery card's own loading table (header strip + rows, no pager yet),
// Settings → the Detection tab that opens by default. Getting the *next* state
// right, not the eventual one, is what makes the hand-off invisible.
// -----------------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div
      className="grid grid-cols-1 items-start gap-6 @4xl/main:grid-cols-2"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Every card below is aria-hidden, so voice the busy region here. */}
      <span className="sr-only">Loading watchdog…</span>
      <div className="flex flex-col gap-6">
        <StatusSkeleton />
        <ActivitySkeleton />
      </div>
      <SettingsSkeleton />
    </div>
  );
}

// Status hero: header + switch action, the state tile (matches the p-4 + size-12
// tile → 80px), the wrap-flow counter strip, and the read-only ladder stepper.
function StatusSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-64" />
        <CardAction>
          <Skeleton className="h-5 w-9 rounded-full" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="border-t pt-5">
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid gap-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t pt-5">
          <Skeleton className="mb-2.5 h-3 w-24" />
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-1 items-center gap-1.5">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                {i < 3 && <Skeleton className="h-px flex-1" />}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Settings: tab strip + the Detection tab's fields (each label + control +
// description, so the height matches the real tab) + the derived-preview row +
// the sticky save bar.
function SettingsSkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="mt-5 grid grid-cols-1 gap-4 @sm/card:grid-cols-2">
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <div className="mt-4 grid gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-9 w-full max-w-[18rem] rounded-md" />
          <Skeleton className="h-3 w-44" />
        </div>
        {/* "Declares down after ~Ns" derivation row (px-3 py-2 text-sm → 36px). */}
        <Skeleton className="mt-4 h-9 w-full rounded-lg" />
        {/* Sticky save-bar silhouette — same negative-margin bleed + rounded-b. */}
        <div className="-mx-6 -mb-6 mt-6 flex items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4">
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

// Activity: header + refresh action, then the exact bordered table the recovery
// card renders in its own loading state — header strip + four rows, and no pager
// (the footer only appears once >6 events land, never during load).
function ActivitySkeleton() {
  return (
    <Card className="@container/card" aria-hidden>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
        <CardAction>
          <Skeleton className="size-8 rounded-md" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="hidden @md/card:table-cell">
                  <Skeleton className="h-3 w-14" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-3 w-14" />
                </TableHead>
                <TableHead className="text-right @md/card:text-left">
                  <Skeleton className="ml-auto h-3 w-10 @md/card:ml-0" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell className="hidden @md/card:table-cell">
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-24 @md/card:ml-0" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default WatchdogComponent;

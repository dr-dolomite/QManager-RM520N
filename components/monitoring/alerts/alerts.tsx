"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useAlerts, type UseAlertsReturn } from "@/hooks/use-alerts";
import { useAlertsLog, type UseAlertsLogReturn } from "@/hooks/use-alerts-log";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AlertLogEntry, AlertsState } from "@/types/alerts";

import {
  AlertsStatusBand,
  AlertsStatusBandSkeleton,
  type LastAlertSummary,
} from "./alerts-status-card";
import { AlertsCoverageCard } from "./coverage-card";
import {
  AlertsSettingsCard,
  AlertsSettingsCardSkeleton,
} from "./alerts-settings-card";
import { AlertsLogCard } from "./alerts-log-card";
import { useCoverageModel } from "./coverage-model";
import { blockedChannels, useAlertsForm } from "./use-alerts-form";
import { COLS, PAGE_ROOT, PILL_ACTION, PILL_GLYPH } from "./shapes";

// -----------------------------------------------------------------------------
// Alerts — the page shell.
// -----------------------------------------------------------------------------
// Header, then the saved-truth band, then the coverage hero, then the Channels /
// Activity pair. Both data hooks live here: `useAlertsLog` feeds the Activity
// card AND the band's last-delivery tile, so the page fetches the log once.
// -----------------------------------------------------------------------------

/** The rest tone for a header or card-header pill. */
const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/**
 * `useAlertsForm` reads `state.channels.sms` straight through, so a partial
 * payload has to be caught BEFORE the form-consuming subtree mounts — a hook
 * cannot be called conditionally, which is why this is a component boundary.
 */
function isComplete(state: AlertsState | null): state is AlertsState {
  return (
    !!state?.channels?.sms &&
    !!state.channels.email &&
    !!state.channels.discord &&
    !!state.routing?.events &&
    !!state.capabilities
  );
}

/** Newest parsable delivery. Timestamps are device-local "YYYY-MM-DD HH:MM:SS". */
function newestDelivery(entries: AlertLogEntry[]): LastAlertSummary | null {
  let best: AlertLogEntry | undefined;
  let bestAt = -1;
  for (const entry of entries) {
    const at = Date.parse(entry.timestamp.replace(" ", "T"));
    if (Number.isFinite(at) && at > bestAt) {
      bestAt = at;
      best = entry;
    }
  }
  if (!best) return null;
  return {
    atMs: bestAt,
    trigger: best.trigger,
    channel: best.channel,
    status: best.status,
  };
}

const AlertsComponent = () => {
  const { t } = useTranslation("common");
  const hook = useAlerts();
  const log = useAlertsLog();
  const { state, isLoading, error, refresh } = hook;

  const reload = React.useCallback(() => {
    // `refresh` is the hook's `fetchState(silent?)`; a click event must never
    // reach that argument, or a user-triggered reload goes silent.
    refresh();
  }, [refresh]);

  // A failed read that produced nothing is not "never sent". It is not loading
  // either, so the band says so outright instead of pulsing forever.
  const activityUnreadable =
    !log.isLoading && log.error !== null && log.entries.length === 0;
  const lastAlert =
    log.isLoading || activityUnreadable ? undefined : newestDelivery(log.entries);

  const logCard = (
    <AlertsLogCard
      entries={log.entries}
      isLoading={log.isLoading}
      isRefreshing={log.isRefreshing}
      error={log.error}
      onRefresh={log.refresh}
      reboots={state?.reboots ?? []}
    />
  );

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t("alerts.page.title")}
          description={t("alerts.page.description")}
          actions={
            <Button
              type="button"
              variant="ghost"
              onClick={reload}
              disabled={isLoading}
              className={cn(PILL_ACTION, HEADER_PILL)}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "animate-spin")}
              />
              {t("alerts.page.refresh")}
            </Button>
          }
        />
      </motion.div>

      {isComplete(state) ? (
        <AlertsSurface
          hook={hook}
          state={state}
          log={log}
          lastAlert={lastAlert}
          activityUnreadable={activityUnreadable}
        >
          {logCard}
        </AlertsSurface>
      ) : isLoading ? (
        <>
          <motion.div variants={staggerItem}>
            <AlertsStatusBandSkeleton />
          </motion.div>
          <motion.div variants={staggerItem}>
            <AlertsCoverageCard coverage={null} onToggle={noop} />
          </motion.div>
          <motion.div variants={staggerItem} className={COLS}>
            <AlertsSettingsCardSkeleton />
            {logCard}
          </motion.div>
        </>
      ) : (
        <>
          {/* Nothing readable came back, so the band reports no verdict at all
              and the hero carries the failure. Activity is a separate read and
              may well have succeeded, so it keeps its full width. */}
          <motion.div variants={staggerItem}>
            <AlertsCoverageCard
              coverage={null}
              onToggle={noop}
              error={error ?? t("alerts.page.unreadable")}
              onRetry={reload}
            />
          </motion.div>
          <motion.div variants={staggerItem}>{logCard}</motion.div>
        </>
      )}
    </motion.div>
  );
};

function noop() {}

// -----------------------------------------------------------------------------
// The form-consuming subtree. Everything below reads one `useAlertsForm`, and
// the band/hero split reads one `useCoverageModel`: saved truth in the band,
// draft truth in the matrix.
// -----------------------------------------------------------------------------
function AlertsSurface({
  hook,
  state,
  log,
  lastAlert,
  activityUnreadable,
  children,
}: {
  hook: UseAlertsReturn;
  state: AlertsState;
  log: UseAlertsLogReturn;
  lastAlert?: LastAlertSummary | null;
  /** The activity read failed outright, so the last-alert tile is unknown. */
  activityUnreadable: boolean;
  /** The Activity card, built by the shell so it holds the hoisted log data. */
  children: React.ReactNode;
}) {
  const form = useAlertsForm({ state, isSaving: hook.isSaving });
  const { saved, draft } = useCoverageModel(state, form);

  const retry = React.useCallback(() => hook.refresh(), [hook]);
  const blocked = blockedChannels(form);

  return (
    <>
      <motion.div variants={staggerItem}>
        <AlertsStatusBand
          coverage={saved}
          lastAlert={lastAlert}
          unreadable={activityUnreadable}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <AlertsCoverageCard
          coverage={draft}
          onToggle={form.setRoute}
          error={hook.error}
          onRetry={retry}
          isDirty={form.isDirty}
          blockedChannels={blocked}
        />
      </motion.div>

      <motion.div variants={staggerItem} className={COLS}>
        <AlertsSettingsCard
          form={form}
          state={state}
          hook={hook}
          onTested={log.silentRefresh}
        />
        {children}
      </motion.div>
    </>
  );
}

export default AlertsComponent;

"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useAlerts } from "@/hooks/use-alerts";
import { useAlertsLog } from "@/hooks/use-alerts-log";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AlertsState } from "@/types/alerts";

import { AlertsCoverageCard } from "./coverage-card";
import {
  AlertsChannelsCondition,
  AlertsSettingsCard,
  AlertsSettingsCardSkeleton,
} from "./alerts-settings-card";
import { AlertsLogCard } from "./alerts-log-card";
import { BENTO, BENTO_AREA, PAGE_ROOT, PILL_GLYPH } from "./shapes";

// Header, then one bento: Coverage over Channels, Activity beside both. The
// three card wrappers mount once, so a loading-to-loaded swap replays nothing.

const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/** `useAlertsForm` reads every channel straight through, so a partial payload stops here. */
function isComplete(state: AlertsState | null): state is AlertsState {
  return (
    !!state?.channels?.sms &&
    !!state.channels.email &&
    !!state.channels.discord &&
    !!state.routing?.events &&
    !!state.capabilities
  );
}

const AlertsComponent = () => {
  const { t } = useTranslation("common");
  const hook = useAlerts();
  const log = useAlertsLog();
  const { state, isLoading, error, refresh } = hook;
  const logRefresh = log.refresh;

  // One Refresh reloads both reads. A click event must never reach `refresh(silent?)`.
  const reload = React.useCallback(() => {
    refresh();
    logRefresh();
  }, [refresh, logRefresh]);

  const retrySettings = React.useCallback(() => {
    refresh();
  }, [refresh]);

  const complete = isComplete(state) ? state : null;
  const busy = isLoading || log.isRefreshing;

  let channels: React.ReactNode = null;
  if (complete) {
    channels = (
      <AlertsSettingsCard state={complete} hook={hook} onTested={log.silentRefresh} />
    );
  } else if (isLoading) {
    channels = <AlertsSettingsCardSkeleton />;
  } else if (state && !error) {
    // The device answered without channels: a real empty, not a failure.
    channels = (
      <AlertsChannelsCondition
        tone="muted"
        title={t("alerts.channels.empty.title")}
        description={t("alerts.channels.empty.description")}
      />
    );
  } else {
    channels = (
      <AlertsChannelsCondition
        tone="destructive"
        title={t("alerts.channels.error.title")}
        description={t("alerts.channels.error.description")}
        actionLabel={t("alerts.channels.error.retry")}
        onAction={retrySettings}
      />
    );
  }

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
              disabled={busy}
              size="action"
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, busy && "motion-safe:animate-spin")}
                aria-hidden
              />
              {t("alerts.page.refresh")}
            </Button>
          }
        />
      </motion.div>

      <motion.div className={BENTO} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={BENTO_AREA.COVERAGE}>
          <AlertsCoverageCard
            state={complete}
            error={complete ? error : isLoading ? null : (error ?? t("alerts.page.unreadable"))}
            onRetry={retrySettings}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={BENTO_AREA.CHANNELS}>
          {channels}
        </motion.div>
        <motion.div variants={staggerItem} className={BENTO_AREA.ACTIVITY}>
          <AlertsLogCard
            entries={log.entries}
            isLoading={log.isLoading}
            error={log.error}
            onRetry={() => logRefresh()}
            reboots={state?.reboots ?? []}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default AlertsComponent;

"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon, WifiOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import {
  useWatchdogSettings,
  type UseWatchdogSettingsReturn,
  type WatchdogSettings,
} from "@/hooks/use-watchdog-settings";
import { useModemStatus, type UseModemStatusReturn } from "@/hooks/use-modem-status";
import {
  useRecentActivities,
  type UseRecentActivitiesReturn,
} from "@/hooks/use-recent-activities";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { FailoverBanner } from "./banners";
import { DetectionCard, DetectionCardSkeleton } from "./detection-card";
import {
  deriveBand,
  derivePhase,
  deriveStrip,
  useGraceGate,
  useTimeAgo,
} from "./derive";
import { LadderCard, LadderCardSkeleton } from "./ladder-card";
import { RecoveryActivityCard } from "./recovery-activity-card";
import {
  CONDITION,
  CONDITION_TONE,
  HEADER_PILL,
  PAGE_ROOT,
  PAIR,
  PAIR_CELL,
  PILL_GLYPH,
} from "./shapes";
import { StatusCard, StatusCardSkeleton } from "./status-band";
import { useWatchdogForm } from "./use-watchdog-form";

/**
 * `useWatchdogForm` seeds every field straight off `settings`, so a partial
 * payload is caught BEFORE the form-consuming subtree mounts.
 */
function isReady(s: WatchdogSettings | null): s is WatchdogSettings {
  return (
    !!s &&
    typeof s.enabled === "boolean" &&
    Number.isFinite(s.fail_threshold) &&
    Number.isFinite(s.probe_interval) &&
    Number.isFinite(s.check_interval) &&
    Number.isFinite(s.cooldown) &&
    Number.isFinite(s.max_reboots_per_hour)
  );
}

const WatchdogComponent = () => {
  const { t } = useTranslation("common");
  const hook = useWatchdogSettings();
  const modemStatus = useModemStatus({ pollInterval: 5000 });
  const activities = useRecentActivities({ maxEvents: 50 });
  const { settings, isLoading, error, refresh } = hook;

  const modemRefresh = modemStatus.refresh;
  const activityRefresh = activities.refresh;
  const reload = React.useCallback(() => {
    // `refresh` is `fetchSettings(silent?)`: a click event must never reach it.
    refresh();
    modemRefresh();
    activityRefresh();
  }, [refresh, modemRefresh, activityRefresh]);

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t("watchdog.page.title")}
          description={t("watchdog.page.description")}
          actions={
            <Button
              type="button"
              variant="ghost"
              onClick={reload}
              disabled={isLoading}
              size="action"
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(
                  PILL_GLYPH,
                  isLoading && "motion-safe:animate-spin",
                )}
              />
              {t("watchdog.page.refresh")}
            </Button>
          }
        />
      </motion.div>

      {isReady(settings) ? (
        <WatchdogSurface
          hook={hook}
          settings={settings}
          modemStatus={modemStatus}
          activities={activities}
        />
      ) : isLoading ? (
        <>
          <motion.div variants={staggerItem}>
            <StatusCardSkeleton />
          </motion.div>
          <div className={PAIR}>
            <motion.div variants={staggerItem} className={PAIR_CELL}>
              <LadderCardSkeleton />
            </motion.div>
            <motion.div variants={staggerItem} className={PAIR_CELL}>
              <DetectionCardSkeleton />
            </motion.div>
          </div>
          <motion.div variants={staggerItem}>
            <RecoveryActivityCard
              activities={activities}
              recentReboots={hook.recentReboots}
            />
          </motion.div>
        </>
      ) : (
        <>
          {/* Nothing readable came back, so the settings surface reports the
              failure outright. Activity is a separate read. */}
          <motion.div variants={staggerItem}>
            <SettingsUnreadable
              message={error ?? t("watchdog.page.unreadable")}
              onRetry={reload}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <RecoveryActivityCard
              activities={activities}
              recentReboots={hook.recentReboots}
            />
          </motion.div>
        </>
      )}
    </motion.div>
  );
};

/** One form owns both drafts; one `derivePhase` owns what the device is doing. */
function WatchdogSurface({
  hook,
  settings,
  modemStatus,
  activities,
}: {
  hook: UseWatchdogSettingsReturn;
  settings: WatchdogSettings;
  modemStatus: UseModemStatusReturn;
  activities: UseRecentActivitiesReturn;
}) {
  const { t } = useTranslation("common");
  const timeAgo = useTimeAgo();

  const form = useWatchdogForm({
    settings,
    isSaving: hook.isSaving,
    saveSettings: hook.saveSettings,
  });

  const watchcat = modemStatus.data?.watchcat ?? null;
  const failover = modemStatus.data?.sim_failover ?? null;
  const pastGrace = useGraceGate(modemStatus.receivedAtMs, settings.enabled);

  const phase = derivePhase({
    settingsEnabled: settings.enabled,
    autoDisabled: hook.autoDisabled,
    watchcat,
    snapshotAt: modemStatus.data?.timestamp ?? null,
    stale: modemStatus.isStale,
    unreachable: modemStatus.error !== null || modemStatus.data === null,
    pastGrace,
  });

  // The status card reports SAVED truth, never the half-edited form.
  const lastTime = watchcat?.last_recovery_time ?? null;
  const band = deriveBand({
    phase,
    settings,
    watchcat,
    lastAgo: lastTime !== null ? timeAgo(lastTime) : null,
  });
  const strip = deriveStrip(modemStatus.data?.connectivity ?? null, phase);

  return (
    <>
      {failover?.active ? (
        <motion.div variants={staggerItem}>
          <FailoverBanner
            failover={failover}
            since={
              failover.switched_at !== null
                ? timeAgo(failover.switched_at)
                : t("watchdog.failover.recently")
            }
            revertSim={hook.revertSim}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <StatusCard band={band} strip={strip} />
      </motion.div>

      <div className={PAIR}>
        <motion.div variants={staggerItem} className={PAIR_CELL}>
          {/* Not knowing outranks guessing: the same gate the status card applies. */}
          <LadderCard
            form={form}
            runningTier={
              phase === "unknown" ||
              phase === "off" ||
              phase === "starting" ||
              phase === "not_running" ||
              phase === "auto_disabled"
                ? 0
                : (watchcat?.current_tier ?? 0)
            }
          />
        </motion.div>
        <motion.div variants={staggerItem} className={PAIR_CELL}>
          <DetectionCard form={form} qualityLimits={hook.qualityLimits} />
        </motion.div>
      </div>

      <motion.div variants={staggerItem}>
        <RecoveryActivityCard
          activities={activities}
          recentReboots={hook.recentReboots}
        />
      </motion.div>
    </>
  );
}

/** The settings read failed. The block IS the state, so it takes the tone. */
function SettingsUnreadable({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation("common");
  const skin = CONDITION_TONE.destructive;
  return (
    <div role="status" className={cn(CONDITION.ROOT, skin.ROOT)}>
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <WifiOffIcon className={CONDITION.GLYPH} />
      </span>
      <p className={CONDITION.TITLE}>{t("watchdog.page.unreadableTitle")}</p>
      <p className={CONDITION.DESC}>{message}</p>
      <Button
        type="button"
        variant="ghost"
        onClick={onRetry}
        className={cn(CONDITION.ACTION, skin.ACTION)}
      >
        <RefreshCcwIcon className={PILL_GLYPH} />
        {t("watchdog.page.retry")}
      </Button>
    </div>
  );
}

export default WatchdogComponent;

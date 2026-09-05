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
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { AutoDisabledBanner, FailoverBanner } from "./banners";
import { DetectionCard, DetectionCardSkeleton } from "./detection-card";
import {
  deriveBand,
  derivePhase,
  useGraceGate,
  useTimeAgo,
  PHASE_LABEL_KEY,
} from "./derive";
import { LadderCard, LadderCardSkeleton } from "./ladder-card";
import { RecoveryActivityCard } from "./recovery-activity-card";
import { SaveBar, SaveBarSkeleton } from "./save-bar";
import {
  COLS,
  CONDITION,
  CONDITION_TONE,
  HEADER_PILL,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
} from "./shapes";
import { StatusBand, StatusBandSkeleton } from "./status-band";
import { useWatchdogForm } from "./use-watchdog-form";

/**
 * `useWatchdogForm` seeds ten fields straight off `settings`, so a partial
 * payload has to be caught BEFORE the form-consuming subtree mounts — a hook
 * cannot be called conditionally, which is why this is a component boundary.
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
  const { settings, isLoading, error, refresh } = hook;

  const reload = React.useCallback(() => {
    // `refresh` is the hook's `fetchSettings(silent?)`; a click event must
    // never reach that argument, or a user-triggered reload goes silent.
    refresh();
  }, [refresh]);

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
              className={cn(PILL_ACTION, HEADER_PILL)}
            >
              <RefreshCcwIcon
                className={cn(
                  PILL_GLYPH,
                  isLoading && "animate-spin motion-reduce:animate-none",
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
        />
      ) : isLoading ? (
        <>
          <motion.div variants={staggerItem}>
            <StatusBandSkeleton />
          </motion.div>
          <motion.div variants={staggerItem}>
            <LadderCardSkeleton />
          </motion.div>
          <motion.div variants={staggerItem} className={COLS}>
            <DetectionCardSkeleton />
            <RecoveryActivityCard />
          </motion.div>
          <motion.div variants={staggerItem}>
            <SaveBarSkeleton />
          </motion.div>
        </>
      ) : (
        <>
          {/* Nothing readable came back, so the settings surface reports the
              failure outright rather than drawing "-"-shaped optimism.
              Activity is a separate read and may well have succeeded, so it
              keeps its full width instead of a ragged pair. */}
          <motion.div variants={staggerItem}>
            <SettingsUnreadable
              message={error ?? t("watchdog.page.unreadable")}
              onRetry={reload}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <RecoveryActivityCard />
          </motion.div>
        </>
      )}
    </motion.div>
  );
};

/**
 * The form-consuming subtree. One `useWatchdogForm` owns the draft; one
 * `derivePhase` owns what the device is doing. The band reports SAVED truth,
 * never the half-edited form.
 */
function WatchdogSurface({
  hook,
  settings,
  modemStatus,
}: {
  hook: UseWatchdogSettingsReturn;
  settings: WatchdogSettings;
  modemStatus: UseModemStatusReturn;
}) {
  const { t } = useTranslation("common");
  const timeAgo = useTimeAgo();

  const form = useWatchdogForm({
    settings,
    isSaving: hook.isSaving,
    error: hook.error,
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

  const lastTier = watchcat?.last_recovery_tier ?? null;
  const lastTime = watchcat?.last_recovery_time ?? null;
  const tiles = deriveBand({
    phase,
    phaseLabel: t(PHASE_LABEL_KEY[phase]),
    settings,
    watchcat,
    lastTierName:
      lastTier !== null && lastTier >= 1 && lastTier <= 4
        ? t(`watchdog.ladder.tier${lastTier}.name`)
        : null,
    lastAgo: lastTime !== null ? timeAgo(lastTime) : null,
  });

  return (
    <>
      {hook.autoDisabled ? (
        <motion.div variants={staggerItem}>
          <AutoDisabledBanner />
        </motion.div>
      ) : null}

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
        <StatusBand tiles={tiles} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <LadderCard
          form={form}
          runningTier={watchcat?.current_tier ?? 0}
          registerField={form.registerField}
        />
      </motion.div>

      <motion.div variants={staggerItem} className={COLS}>
        <DetectionCard form={form} registerField={form.registerField} />
        <RecoveryActivityCard />
      </motion.div>

      <motion.div variants={staggerItem}>
        <SaveBar form={form} />
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
    <div className={cn(CONDITION.ROOT, skin.ROOT)}>
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

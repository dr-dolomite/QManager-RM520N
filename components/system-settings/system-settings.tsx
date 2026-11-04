"use client";

import { useCallback } from "react";
import { RefreshCcwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { RevealLabelButton } from "@/components/ui/reveal-label-button";
import { Tag } from "@/components/ui/tag";
import { useKnownSims } from "@/hooks/use-known-sims";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { staggerContainer, staggerItem } from "@/lib/motion";

import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import { StatusBand } from "@/components/system-settings/status-band";
import SystemSettingsCard from "@/components/system-settings/system-settings-card";
// Parked: the System Health card stays on disk and can return to the grid.
// import ModemSubsystemCard from "@/components/system-settings/modem-subsystem-card";

import {
  CARD_CELL,
  CARD_GRID,
  PAGE_HEAD,
  PAGE_ROOT,
} from "./shapes";

const K = "page";

const SystemSettings = () => {
  const { t } = useTranslation("system-settings");
  const settingsState = useSystemSettings();
  // Lifted: the hook has no shared cache, so a second consumer would double the GET
  // and drift from the Tracked SIMs row; Refresh also reconciles the count.
  const knownSims = useKnownSims();

  const { refresh: refreshSettings, isLoading, settings } = settingsState;
  const { refresh: refreshKnownSims } = knownSims;

  const handleRefresh = useCallback(() => {
    void refreshSettings();
    void refreshKnownSims();
  }, [refreshSettings, refreshKnownSims]);

  const hostname = settings?.hostname?.trim();

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once. Every child below is a
          staggerItem and must NOT declare its own, or it detaches from the clock. */}
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>
              {t(`${K}.title`)}
              {hostname ? (
                <Tag variant="neutral" className="ml-3 align-middle font-mono">
                  {hostname}
                </Tag>
              ) : null}
            </h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.description`)}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <RevealLabelButton
              icon={RefreshCcwIcon}
              label={t(`${K}.refresh`)}
              onClick={handleRefresh}
              disabled={isLoading}
              spinning={isLoading}
            />
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusBand
          settings={settingsState.settings}
          scheduledReboot={settingsState.scheduledReboot}
          knownCount={knownSims.count}
          isLoading={settingsState.isLoading}
          knownLoading={knownSims.isLoading}
          error={settingsState.error}
        />
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and gives each
          card its own 120ms step. It must not declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SystemSettingsCard
            {...settingsState}
            sims={{
              count: knownSims.count,
              isLoading: knownSims.isLoading,
              isClearing: knownSims.isClearing,
              refresh: knownSims.refresh,
              clear: knownSims.clear,
            }}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ScheduledOperationsCard {...settingsState} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default SystemSettings;

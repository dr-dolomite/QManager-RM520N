"use client";

import { useCallback } from "react";
import { RefreshCcwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { useSimRegistry } from "@/hooks/use-sim-registry";
import { useKnownSims } from "@/hooks/use-known-sims";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import SystemSettingsCard from "@/components/system-settings/system-settings-card";
import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import SSHPasswordCard from "@/components/system-settings/ssh-password-card";
// Parked for future use — the System Health card (subsystem state + host
// resource usage) is kept on disk and can be restored to the grid at any time.
// import ModemSubsystemCard from "@/components/system-settings/modem-subsystem-card";
import SimRegistryCard from "@/components/system-settings/sim-registry-card";
import { StatusBand } from "@/components/system-settings/status-band";

import {
  CARD_CELL,
  CARD_GRID,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
} from "./shapes";

const K = "page";

const SystemSettings = () => {
  const { t } = useTranslation("system-settings");
  const settingsState = useSystemSettings();
  // Lifted rather than mounted twice: `useSimRegistry` fetches on mount with no
  // shared cache, so a second consumer would mean a second GET and a count that
  // does not follow the list it sits above.
  const registry = useSimRegistry();
  // Lifted for the same reason, plus one the registry does not have: the page's
  // Refresh button is the surface's reconciliation affordance, and a hook it
  // cannot reach leaves the count frozen under a list that just moved.
  const knownSims = useKnownSims();

  const { refresh: refreshSettings, isLoading, settings } = settingsState;
  const { refresh: refreshRegistry } = registry;
  const { refresh: refreshKnownSims } = knownSims;

  const handleRefresh = useCallback(() => {
    refreshSettings();
    void refreshRegistry();
    void refreshKnownSims();
  }, [refreshSettings, refreshRegistry, refreshKnownSims]);

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
            <Button
              type="button"
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoading}
              className={PILL_ACTION}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "animate-spin")}
              />
              {t(`${K}.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusBand
          settings={settingsState.settings}
          scheduledReboot={settingsState.scheduledReboot}
          sims={registry.sims}
          isLoading={settingsState.isLoading}
          simsLoading={registry.isLoading}
          error={settingsState.error}
        />
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and gives each
          card its own 120ms step. It must not declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SystemSettingsCard {...settingsState} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ScheduledOperationsCard {...settingsState} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SSHPasswordCard />
        </motion.div>
        {/* <ModemSubsystemCard /> — parked, see the commented import above. */}
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SimRegistryCard
            {...registry}
            knownCount={knownSims.count}
            knownIsLoading={knownSims.isLoading}
            isClearingKnown={knownSims.isClearing}
            clearKnownSims={knownSims.clear}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default SystemSettings;

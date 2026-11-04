"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useBandLocking } from "@/hooks/use-band-locking";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { nextChangeAt, resolveScheduledScenario } from "@/lib/scenario-schedule";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { DEFAULT_SCENARIOS } from "@/types/connection-scenario";
import {
  BAND_CATEGORIES,
  getBandsForCategory,
  parseBandString,
  type BandActionResult,
  type BandCategory,
} from "@/types/band-locking";

import BandGridCard from "./band-grid-card";
import BandStatusCard from "./band-status-card";
import { categoryCardId } from "./shapes";

// =============================================================================
// BandLockingComponent — page coordinator for /cellular/cell-locking
// =============================================================================
// Owns every hook and distributes data down as props; no child talks to CGI. Layout ported from RM551E v0.1.34.
//
// Hooks: useModemStatus (supported bands, carriers), useBandLocking, useConnectionScenarios (scenario gate),
// useSimProfiles (profile gate, RM520N only; outranks scenario).
//
// The profile gate resolves the scenario in force NOW (schedule windows included), not `scenario.default`: the
// on-device timer applies the windowed one, and both write the same `AT+QNWPREFCFG` registers.
//
// Refresh is blocked while any write or the failover watcher runs: `current.sh`
// takes the AT lock, and the watcher treats a failed check as "no carrier".
// =============================================================================

const K = "band_locking";

const BandLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data, isLoading: statusLoading } = useModemStatus();
  const {
    currentBands,
    failover,
    isLoading: bandsLoading,
    isRefreshing,
    lockingCategory,
    readError,
    lockBands,
    unlockAll,
    toggleFailover,
    refresh,
  } = useBandLocking();
  const {
    activeScenarioId,
    customScenarios,
    isLoading: scenariosLoading,
  } = useConnectionScenarios();

  // --- SIM Profile gate -------------------------------------------------------
  // A Balanced binding is "no opinion": the profile re-applies AUTO mode with
  // bands untouched, so it does not compete for this setting.
  const { activeProfileId, getProfile } = useSimProfiles();
  const [profileGate, setProfileGate] = useState<{
    profileName: string;
    /** "HH:MM" of the next scheduled scenario boundary, when one exists. */
    nextChange: string | null;
  } | null>(null);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;
      const now = new Date();
      const boundId = profile
        ? resolveScheduledScenario(
            now,
            profile.scenario.schedule,
            profile.scenario.default,
          )
        : "";
      if (profile && boundId && boundId !== "balanced") {
        setProfileGate({
          profileName: profile.name,
          nextChange: nextChangeAt(
            now,
            profile.scenario.schedule,
            profile.scenario.default,
          ),
        });
      } else {
        setProfileGate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, getProfile]);

  const isProfileControlled = profileGate !== null;
  const isScenarioControlled = activeScenarioId !== "balanced";
  const isGated = isProfileControlled || isScenarioControlled;

  const activeScenarioName = useMemo(() => {
    if (!isScenarioControlled) return "";
    const fromDefaults = DEFAULT_SCENARIOS.find(
      (s) => s.id === activeScenarioId,
    );
    if (fromDefaults) return fromDefaults.name;
    const fromCustom = customScenarios.find((s) => s.id === activeScenarioId);
    if (fromCustom) return fromCustom.name;
    return activeScenarioId;
  }, [activeScenarioId, isScenarioControlled, customScenarios]);

  // --- Per-card write failures, from each mutator's returned result ---------
  const [writeErrors, setWriteErrors] = useState<
    Partial<Record<BandCategory, string>>
  >({});

  const track = async (
    category: BandCategory,
    run: () => Promise<BandActionResult>,
  ): Promise<BandActionResult> => {
    setWriteErrors((prev) => ({ ...prev, [category]: undefined }));
    const result = await run();
    if (!result.ok) {
      setWriteErrors((prev) => ({ ...prev, [category]: result.error }));
    }
    return result;
  };

  // --- Band data --------------------------------------------------------------
  const supportedBands = useMemo<Record<BandCategory, number[]>>(
    () => ({
      lte: parseBandString(data?.device.supported_lte_bands),
      nsa_nr5g: parseBandString(data?.device.supported_nsa_nr5g_bands),
      sa_nr5g: parseBandString(data?.device.supported_sa_nr5g_bands),
    }),
    [
      data?.device.supported_lte_bands,
      data?.device.supported_nsa_nr5g_bands,
      data?.device.supported_sa_nr5g_bands,
    ],
  );

  // An empty locked list is never a modem state, only a failed read; this flag
  // keeps that `[]` fallback from rendering as "0 of 31 bands allowed".
  const hasCurrentReading = currentBands !== null;
  const lockedBands = useMemo<Record<BandCategory, number[]>>(() => {
    const locked = (category: BandCategory) =>
      currentBands
        ? parseBandString(getBandsForCategory(currentBands, category))
        : [];
    return {
      lte: locked("lte"),
      nsa_nr5g: locked("nsa_nr5g"),
      sa_nr5g: locked("sa_nr5g"),
    };
  }, [currentBands]);

  const carrierComponents = data?.network.carrier_components ?? [];
  const isPageLoading = statusLoading || bandsLoading || scenariosLoading;

  const isBusy = lockingCategory !== null;
  const isWatcherRunning = failover.watcher_running === true;
  const isRefreshBlocked =
    isBusy || isRefreshing || bandsLoading || isWatcherRunning;
  const watcherReason = isWatcherRunning
    ? t(`${K}.refresh_blocked_watcher`)
    : undefined;

  // A refresh belongs to no card, so its failure is a toast; success is
  // evident from the page updating.
  const handleRefresh = async () => {
    const ok = await refresh();
    if (!ok) toast.error(t(`${K}.toast.refresh_error`));
  };

  const selectCategory = (category: BandCategory) => {
    document
      .getElementById(categoryCardId(category))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          <Button
            type="button"
            variant="tonal-neutral"
            size="action"
            onClick={handleRefresh}
            disabled={isRefreshBlocked}
            title={watcherReason}
          >
            <MaterialSymbol
              name="refresh"
              size={18}
              className={isRefreshing ? "motion-safe:animate-spin" : undefined}
            />
            {t(`${K}.actions.refresh`)}
          </Button>
        }
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isRefreshing ? t(`${K}.refreshing`) : ""}
      </div>

      {readError && !isPageLoading ? (
        <ConditionScreen
          tone="destructive"
          glyph="visibility_off"
          ariaRole="alert"
          title={t(`${K}.read_error_title`)}
          description={readError}
          onRetry={handleRefresh}
          retryLabel={t(`${K}.actions.refresh`)}
          disabled={isRefreshBlocked}
          disabledReason={watcherReason}
        />
      ) : null}

      {/* Profile outranks scenario; RM551E has no profile gate. */}
      {!isPageLoading && isProfileControlled && profileGate ? (
        <ProfileOverrideAlert
          profileName={profileGate.profileName}
          controls={t(`${K}.controls_label`)}
          note={
            profileGate.nextChange
              ? t(`${K}.gate.profile_note`, { time: profileGate.nextChange })
              : undefined
          }
        />
      ) : null}

      {!isPageLoading && !isProfileControlled && isScenarioControlled ? (
        <Banner
          role="override"
          title={t(`${K}.scenario_gate_title`, { scenario: activeScenarioName })}
          description={t(`${K}.scenario_gate_note`)}
          action={
            <Link
              href="/cellular/custom-profiles/"
              className={bannerActionVariants({ tone: "primary" })}
            >
              {t(`${K}.scenario_gate_action`)}
            </Link>
          }
        />
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <BandStatusCard
            failover={failover}
            carrierComponents={carrierComponents}
            supportedBands={supportedBands}
            lockedBands={lockedBands}
            hasCurrentReading={hasCurrentReading}
            onToggleFailover={toggleFailover}
            onSelectCategory={selectCategory}
            isLoading={isPageLoading}
            isGated={isGated}
          />
        </motion.div>

        {/* Nested cascade: inherits `visible`, so no initial/animate here. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          {BAND_CATEGORIES.map((category) => (
            <motion.div
              key={category}
              id={categoryCardId(category)}
              variants={staggerItem}
              className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
            >
              <BandGridCard
                bandCategory={category}
                supportedBands={supportedBands[category]}
                currentLockedBands={lockedBands[category]}
                hasCurrentReading={hasCurrentReading}
                onLock={(bands) =>
                  track(category, () => lockBands(category, bands))
                }
                onUnlockAll={() =>
                  track(category, () =>
                    unlockAll(category, supportedBands[category]),
                  )
                }
                isLocking={lockingCategory === category}
                isBusy={isBusy}
                isLoading={isPageLoading}
                error={writeErrors[category] ?? null}
                isGated={isGated}
                gatedBy={isProfileControlled ? "profile" : "scenario"}
              />
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BandLockingComponent;

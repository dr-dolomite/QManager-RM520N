"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { Banner } from "@/components/ui/banner";
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
  type BandCategory,
} from "@/types/band-locking";

import BandGridCard from "./band-grid-card";
import LiveBandHero from "./live-band-hero";

// =============================================================================
// BandLockingComponent — page coordinator for /cellular/cell-locking
// =============================================================================
// Owns every hook and distributes data down as props. No child talks to CGI.
//
// Data sources:
//   useModemStatus()          -> supported_*_bands, carrier_components
//   useBandLocking()          -> currentBands, failover, lock/restore actions
//   useConnectionScenarios()  -> activeScenarioId
//   useSimProfiles()          -> the profile gate
//
// -----------------------------------------------------------------------------
// PAGE ANATOMY
// -----------------------------------------------------------------------------
// A page header, then one hero, then a grid of peer cards. The incumbent put a
// read-only status panel and three interactive control surfaces into a single
// 2-column grid, which said they were the same kind of object. They are not: the
// hero reports what the modem IS doing, the cards change what it MAY do.
//
// -----------------------------------------------------------------------------
// ONE BANNER PRIMITIVE
// -----------------------------------------------------------------------------
// The two gates sit in adjacent branches of one conditional and used to render
// through two different components — the shared `Banner` for the profile gate, a
// legacy `Alert` for the scenario gate — so two near-identical sentences arrived
// in two different shapes depending on which override happened to be in force.
// Both now go through `Banner`, whose `override` role is the neutral page-scoped
// note (surface-container fill, `on-surface` ink) rather than a system condition.
//
// -----------------------------------------------------------------------------
// THE GATE CHAIN IS TIME-DEPENDENT — do not simplify it
// -----------------------------------------------------------------------------
// `resolveScheduledScenario(now, ...)` is deliberately not
// `profile.scenario.default`. The static field mirrors only the profile's default
// binding and is blind to a schedule window that is in force right now, while the
// on-device timer applies the WINDOWED scenario. Swapping one for the other makes
// this page disagree with the modem and lets a user edit bands a scheduled
// scenario is about to overwrite — and scenarios issue the identical
// `AT+QNWPREFCFG` writes, so this is a genuine last-writer-wins conflict, not an
// advisory hint.
// =============================================================================

const BandLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data, isLoading: statusLoading } = useModemStatus();
  const {
    currentBands,
    failover,
    isLoading: bandsLoading,
    lockingCategory,
    error,
    lockBands,
    unlockAll,
    toggleFailover,
  } = useBandLocking();
  const {
    activeScenarioId,
    customScenarios,
    isLoading: scenariosLoading,
  } = useConnectionScenarios();

  // --- SIM Profile gate -------------------------------------------------------
  // A Balanced binding is treated as "no opinion" and leaves bands editable: the
  // profile will re-apply Balanced (AUTO mode, bands untouched) next time it
  // activates, so it is not competing for this setting.
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
  /** The profile gate is the higher-level owner and wins when both apply. */
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

  // --- Band data --------------------------------------------------------------
  const supportedBands = useMemo(
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

  const lockedBands = useMemo(
    () => ({
      lte: currentBands
        ? parseBandString(getBandsForCategory(currentBands, "lte"))
        : [],
      nsa_nr5g: currentBands
        ? parseBandString(getBandsForCategory(currentBands, "nsa_nr5g"))
        : [],
      sa_nr5g: currentBands
        ? parseBandString(getBandsForCategory(currentBands, "sa_nr5g"))
        : [],
    }),
    [currentBands],
  );

  const carrierComponents = data?.network.carrier_components ?? [];
  const isPageLoading = statusLoading || bandsLoading || scenariosLoading;

  // --- Error scoping ----------------------------------------------------------
  // `useBandLocking` exposes ONE shared `error`, and the incumbent handed the
  // same string to all three cards — so a failed SA write painted an identical
  // red notice under LTE, NSA and SA, and the user had to guess which of the
  // three had actually failed.
  //
  // Tracking the category that last attempted a write is enough to scope it, and
  // it does so without reshaping the hook's contract. It is set BEFORE the call,
  // so it is already correct by the time a failure lands.
  const [lastAttempted, setLastAttempted] = useState<BandCategory | null>(null);

  /** True while ANY category is writing — see BandGridCard on why this blocks all. */
  const isBusy = lockingCategory !== null;

  return (
    // Root shape copied from the migrated `/cellular/` index
    // (`cellular-information.tsx`) rather than re-derived: the page gutter on
    // this family is `p-2` over the shell's own padding, and every sub-route
    // declaring its own `@container/main` is what makes a card's `@3xl/main:`
    // resolve against the content column instead of the viewport.
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("band_locking.page.title")}
        description={t("band_locking.page.description")}
      />

      {/* The two gates, one primitive. Profile outranks scenario. */}
      {!isPageLoading && isProfileControlled && profileGate ? (
        <ProfileOverrideAlert
          profileName={profileGate.profileName}
          controls={t("band_locking.controls_label")}
          note={
            profileGate.nextChange
              ? t("band_locking.gate.profile_note", {
                  time: profileGate.nextChange,
                })
              : undefined
          }
        />
      ) : null}

      {!isPageLoading && !isProfileControlled && isScenarioControlled ? (
        <Banner
          role="override"
          title={t("band_locking.gate.scenario_title", {
            scenario: activeScenarioName,
          })}
          description={t("band_locking.gate.scenario_note")}
        />
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <LiveBandHero
            failover={failover}
            carrierComponents={carrierComponents}
            supportedBands={supportedBands}
            lockedBands={lockedBands}
            onToggleFailover={toggleFailover}
            isLoading={isPageLoading}
            isGated={isGated}
          />
        </motion.div>

        {/* Nested cascade container: it inherits `visible` from its parent and
            must NOT declare its own initial/animate, or it detaches from the
            parent's clock. `h-full` on each cell so a card whose data has not
            landed matches its row-mates instead of sizing to its own content. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          {BAND_CATEGORIES.map((category) => (
            <motion.div
              key={category}
              id={`band-locking-card-${category}`}
              variants={staggerItem}
              // `scroll-mt` so a smooth-scroll from the hero's rail row lands
              // the card below the sticky shell header instead of under it.
              className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
            >
              <BandGridCard
                bandCategory={category}
                supportedBands={supportedBands[category]}
                currentLockedBands={lockedBands[category]}
                onLock={(bands) => {
                  setLastAttempted(category);
                  return lockBands(category, bands);
                }}
                onRestoreAll={() => {
                  setLastAttempted(category);
                  return unlockAll(category, supportedBands[category]);
                }}
                isLocking={lockingCategory === category}
                isBusy={isBusy}
                isLoading={isPageLoading}
                error={lastAttempted === category ? error : null}
                isGated={isGated}
              />
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BandLockingComponent;

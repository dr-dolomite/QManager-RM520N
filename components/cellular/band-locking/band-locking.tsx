"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { Banner } from "@/components/ui/banner";
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
  type BandCategory,
} from "@/types/band-locking";

import BandGridCard from "./band-grid-card";
import LiveBandHero from "./live-band-hero";
import { PILL_ACTION } from "./shapes";

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
// WHY THIS PAGE HAS A REFRESH AND THE RADIO PAGE DOES NOT
// -----------------------------------------------------------------------------
// `radio/page-header.tsx` cut its "Refresh now" pill on purpose, because that
// page reads `useModemStatus`, which polls — a manual refresh there duplicates
// something already happening. This page does not have that property. Its band
// configuration comes from `current.sh`, which `useBandLocking` fetches on mount
// and after a successful lock, AND NOTHING ELSE. A scheduled Connection Scenario
// rewriting the band lists on-device therefore leaves this page reporting the
// previous configuration until someone reloads the browser — on a surface whose
// header chip claims to report what the modem is actually set to. So the pill is
// a State-Honesty fix, not a convenience, and it is not a candidate for the same
// cut.
//
// It is disabled while `isBusy` for a hard reason: `current.sh` takes the AT
// mutex, and firing it into an in-flight `lock.sh` races that write.
//
// It drives its spinner and its live region from `isRefreshing`, NOT from the
// hook's `isLoading`, and the distinction is load-bearing rather than cosmetic.
// `isLoading` is ORed into `isPageLoading` below, which every card and the hero
// read — so driving the button from it made pressing Refresh collapse the whole
// page to skeletons, blanking the very surface the user asked to re-read. See
// `use-band-locking.ts` > Manual refresh for the two flags' definitions.
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
    readError,
    isRefreshing,
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

  /**
   * Whether `lockedBands` above describes the MODEM or describes a failed read.
   *
   * The fallback on each branch is `[]`, and an empty locked list is not a state
   * the modem can be in — so without this flag the surface reported a failed
   * `current.sh` as "Locked · 0 of 31 bands allowed", complete with the loaded
   * layout, because `supportedBands` comes from the poller snapshot and stays
   * populated right through the failure.
   *
   * A boolean rather than a nullable `lockedBands`: the chip grids, the
   * pending-change count and the live-axis set all want a real array, and making
   * them handle `null` would ripple optionality through the whole card for no
   * fact they do not already have from this flag.
   */
  const hasCurrentReading = currentBands !== null;

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

  /**
   * The failover watcher is live, so the UI must stay off the AT mutex.
   *
   * `isBusy` is NOT sufficient here and the gap is the dangerous part.
   * `lockingCategory` clears the instant the `lock.sh` POST resolves — but that
   * is precisely when `qmanager_band_failover` STARTS. It then spends ~30s
   * running `AT+QCAINFO` up to five times, and its carrier check treats any
   * failed `qcmd` — including one that simply lost the mutex race — as "no
   * carrier". A `current.sh` read fired into that window can therefore push a
   * check toward the branch that UNDOES the user's lock.
   *
   * So the button stays disabled for the whole watcher window, not just for the
   * write. This is the one guard on this page where the cost of being wrong is
   * the user's connection rather than their patience.
   */
  const isWatcherRunning = failover.watcher_running;
  const watcherBlockedReason = t("band_locking.a11y.refresh_blocked_watcher");

  /**
   * The refresh gate, as ONE expression for BOTH refresh affordances.
   *
   * Deliberately not restated at either call site. The header button and the
   * read-error block's retry fire the same `current.sh` read, so they carry the
   * same hazard and must carry the same gate - and they did not: the retry was
   * ungated entirely. That mattered more than it sounds, because the two are
   * causally linked. `lockBands` re-reads immediately after a write, which is
   * exactly when the failover watcher spawns and starts taking the AT mutex, so
   * the likeliest way to be looking at the error block at all is the one moment
   * pressing its retry is hazardous - and at that moment the header button is
   * greyed out, leaving the unguarded retry as the only live refresh on screen.
   */
  const isRefreshBlocked =
    isBusy || isRefreshing || bandsLoading || isWatcherRunning;

  /**
   * A failed refresh is reported by TOAST, on purpose.
   *
   * The hook's `error` is a single shared string, and this page scopes it to
   * one category via `lastAttempted` so a failed SA write does not paint a red
   * notice under LTE and NSA as well. A refresh belongs to no category, so
   * routing it through that channel would either land it under whichever card
   * last wrote (wrong) or nowhere at all (worse — a silent failure on a page
   * whose whole job is reporting what the modem is really set to). The toast
   * sidesteps the scoping rather than weakening it.
   *
   * No success toast: a refresh that worked is evident from the page updating,
   * and confirming every press would be noise.
   *
   * It survives the page-level `readError` block below rather than being
   * replaced by it, and the two are not duplicates. The block is a STANDING
   * condition and looks identical before and after a failed retry; the toast is
   * the only thing that tells the user their press did anything at all.
   */
  const handleRefresh = async () => {
    const ok = await refresh();
    if (!ok) toast.error(t("band_locking.toast.refresh_error"));
  };

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
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            // `bandsLoading` reaches the UI ONLY through `isRefreshBlocked`,
            // and only as a disable. It does not reach the spinner or the live
            // region, so it cannot re-create the blanking bug. It is in that
            // expression because during first load there is nothing on screen
            // to revalidate, and a press would put a second `current.sh` on the
            // AT mutex behind the mount fetch — the same hazard `isBusy` guards
            // against.
            disabled={isRefreshBlocked}
            title={isWatcherRunning ? watcherBlockedReason : undefined}
            aria-description={
              isWatcherRunning ? watcherBlockedReason : undefined
            }
            className={PILL_ACTION}
          >
            <MaterialSymbol
              name="refresh"
              size={18}
              className={isRefreshing ? "motion-safe:animate-spin" : undefined}
            />
            {t("band_locking.actions.refresh")}
          </Button>
        }
      />

      {/* The refresh keeps the loaded layout on screen, so the spinning glyph
          is the only visual tell — which is no tell at all for a screen-reader
          user. Hence the live announcement. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isRefreshing ? t("band_locking.a11y.refreshing") : ""}
      </div>

      {/* --- The band read failed ------------------------------------------
          PAGE-LEVEL, and independent of `lastAttempted`.

          `readError` is a separate channel from the write `error` below for a
          reason this block depends on: the write error is scoped to the card
          that attempted it, and `lastAttempted` is null until the user writes
          something — so a first-load read failure had no card to attach to and
          was displayed to NOBODY, while the rail cheerfully reported "0 of 31
          bands allowed" underneath it.

          `destructive`, not `warning`: every band figure on this page is now
          either stale or absent, and the page's entire job is reporting what
          the modem is really set to. `ariaRole="alert"` follows.

          `visibility_off`, NOT the `error` mark `NOTICE_TONE` already carries.
          `error` means "your write failed" everywhere else on this surface and
          the two can be on screen together; this block shares the glyph of the
          `unavailable` chips it explains instead, so the reader can see that
          the block and the three "Not readable" chips are one fact.

          Retry is `handleRefresh` — the same `current.sh` read that failed —
          so the user's fix is one press rather than a browser reload. */}
      {readError ? (
        <ConditionScreen
          tone="destructive"
          glyph="visibility_off"
          ariaRole="alert"
          title={t("band_locking.states.read_error_title")}
          description={t("band_locking.states.read_error_body", {
            reason: readError,
          })}
          onRetry={handleRefresh}
          retryLabel={t("band_locking.actions.refresh")}
          disabled={isRefreshBlocked}
          disabledReason={isWatcherRunning ? watcherBlockedReason : undefined}
        />
      ) : null}

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
            hasCurrentReading={hasCurrentReading}
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
                hasCurrentReading={hasCurrentReading}
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

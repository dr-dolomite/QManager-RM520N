"use client";

import { useEffect, useMemo, useState } from "react";
import BandCardsComponent from "./band-cards";
import BandSettingsComponent from "./band-settings";
import { useBandLocking } from "@/hooks/use-band-locking";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import {
  parseBandString,
  getBandsForCategory,
  type BandCategory,
} from "@/types/band-locking";
import { DEFAULT_SCENARIOS } from "@/types/connection-scenario";
import {
  resolveScheduledScenario,
  nextChangeAt,
} from "@/lib/scenario-schedule";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// =============================================================================
// BandLockingComponent — Page Coordinator
// =============================================================================
// Owns all hooks and distributes data to child components via props.
//
// Data sources:
//   useModemStatus()          → supported_*_bands, carrier_components
//   useBandLocking()          → currentBands, failover, lock/unlock actions
//   useConnectionScenarios()  → activeScenarioId (for scenario override check)
//
// Scenario override:
//   When a non-Balanced scenario is active, band cards are disabled and an
//   info banner is shown. This keeps the mental model clean: the scenario
//   "owns" RF configuration. Switch to Balanced for manual band control.
// =============================================================================

/** Band card configuration — static, one entry per card */
const BAND_CARDS: {
  category: BandCategory;
  title: string;
  description: string;
}[] = [
  {
    category: "lte",
    title: "LTE Band Locking",
    description: "Select the LTE bands to lock for your device.",
  },
  {
    category: "nsa_nr5g",
    title: "NSA Band Locking",
    description: "Select the 5G NSA bands to lock (5G via LTE anchor).",
  },
  {
    category: "sa_nr5g",
    title: "SA Band Locking",
    description: "Select the 5G SA bands to lock (standalone 5G).",
  },
];

const BandLockingComponent = () => {
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

  // --- SIM Profile override check -------------------------------------------
  // When a Custom SIM Profile binds a NON-Balanced scenario_id, the profile
  // owns radio config and band controls are disabled. A Balanced binding is
  // treated as "no opinion" and leaves bands freely editable — the user can
  // still lock bands manually, and the profile will re-apply Balanced (AUTO
  // mode, bands unchanged) on its next activation.
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
      // Resolve the scenario in force RIGHT NOW from the schedule, not the
      // static settings.scenario_id (which only mirrors scenario.default and
      // is blind to active schedule windows). This keeps the band-lock gate in
      // sync with what the on-device timer is actually applying.
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

  // --- Scenario override check ----------------------------------------------
  const isScenarioControlled = activeScenarioId !== "balanced";

  // Final disabled state — profile gate trumps scenario gate (and is shown
  // first when both apply, since profile is the higher-level owner)
  const isLocked = isProfileControlled || isScenarioControlled;

  const activeScenarioName = useMemo(() => {
    if (!isScenarioControlled) return "";
    // Check defaults first
    const defaultMatch = DEFAULT_SCENARIOS.find(
      (s) => s.id === activeScenarioId,
    );
    if (defaultMatch) return defaultMatch.name;
    // Check custom scenarios
    const customMatch = customScenarios.find((s) => s.id === activeScenarioId);
    if (customMatch) return customMatch.name;
    // Fallback — ID without prefix
    return activeScenarioId;
  }, [activeScenarioId, isScenarioControlled, customScenarios]);

  // --- Derive supported bands from poller boot data -------------------------
  const supportedBands = {
    lte: parseBandString(data?.device.supported_lte_bands),
    nsa_nr5g: parseBandString(data?.device.supported_nsa_nr5g_bands),
    sa_nr5g: parseBandString(data?.device.supported_sa_nr5g_bands),
  };

  // --- Derive active bands from carrier_components (QCAINFO) ----------------
  const carrierComponents = data?.network.carrier_components ?? [];

  // Overall loading: either poller hasn't loaded yet or bands haven't loaded
  const isPageLoading = statusLoading || bandsLoading || scenariosLoading;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Band Locking</h1>
        <p className="text-muted-foreground">
          Restrict which LTE and NR bands the modem can use.
        </p>
      </div>

      {/* Profile override banner — takes priority when both gates apply */}
      {isProfileControlled && profileGate && !isPageLoading && (
        <ProfileOverrideAlert
          profileName={profileGate.profileName}
          controls="Band locking"
          note={
            profileGate.nextChange
              ? `The active scenario is scheduled to change at ${profileGate.nextChange}.`
              : undefined
          }
        />
      )}

      {/* Scenario override banner — shown only when there's no profile gate */}
      {!isProfileControlled && isScenarioControlled && !isPageLoading && (
        <Alert className="mb-4">
          <InfoIcon className="size-4" />
          <AlertDescription>
            <p>
              Band configuration is managed by the{" "}
              <span className="font-semibold">{activeScenarioName}</span>{" "}
              scenario.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <BandSettingsComponent
          failover={failover}
          carrierComponents={carrierComponents}
          onToggleFailover={toggleFailover}
          isLoading={isPageLoading}
          isScenarioControlled={isLocked}
        />
        {BAND_CARDS.map(({ category, title, description }) => (
          <BandCardsComponent
            key={category}
            title={title}
            description={description}
            bandCategory={category}
            supportedBands={supportedBands[category]}
            currentLockedBands={
              currentBands
                ? parseBandString(getBandsForCategory(currentBands, category))
                : []
            }
            onLock={(bands) => lockBands(category, bands)}
            onUnlockAll={() => unlockAll(category, supportedBands[category])}
            isLocking={lockingCategory === category}
            isLoading={isPageLoading}
            error={error}
            disabled={isLocked}
          />
        ))}
      </div>
    </div>
  );
};

export default BandLockingComponent;

"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import CellularPageHeader from "@/components/cellular/page-header";
import { Button } from "@/components/ui/button";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { useApnPresets } from "@/hooks/use-apn-presets";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import { APN_PAIR, BANNER_ACTION, PAGE_ROOT } from "../shapes";

// =============================================================================
// APN Management — the route shell (RM551E v0.1.34 layout)
// =============================================================================
// Two write cards side by side on desktop (`APN_PAIR`), stacked below `@4xl/main`: the APN card (including the
// network-granted readout) and the carrier profile (MBN).
//
// THREE DATA SOURCES, DELIBERATELY SEPARATE:
// Hooks: useApnSettings (apn_setting.json + live CIDs), useMbnSettings (own clock), useModemStatus (granted APN, WAN
// addresses, IMSI for suggestions).
//
// THE OVERRIDE GATE covers only the APN card (a disabled fieldset while a Custom SIM Profile owns the APN); MBN sits
// outside it.
// =============================================================================

const K = "core_settings.apn";

const APNSettingsComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    apn,
    cids,
    active,
    activeCid,
    isLoading,
    isSaving,
    isReconciling,
    error,
    save,
    deactivate,
    refresh,
  } = useApnSettings();

  const {
    profiles: mbnProfiles,
    autoSel,
    isLoading: mbnLoading,
    isSaving: mbnSaving,
    error: mbnError,
    saveMbn,
    rebootDevice: rebootMbn,
    refresh: refreshMbn,
  } = useMbnSettings();

  const {
    data: status,
    isStale: statusStale,
    error: statusError,
  } = useModemStatus();

  // Suggested APNs for the SIM in the slot, matched by its IMSI's home PLMN.
  const presetMatch = useApnPresets(status?.device?.imsi);

  const { activeProfileId, isLoading: simLoading, getProfile } = useSimProfiles();

  // --- SIM Profile override check (async) ------------------------------------
  // Gate iff the active profile has a non-empty APN name.
  const [profileOverride, setProfileOverride] = React.useState<{
    profileId: string;
    name: string;
  } | null>(null);

  // The profile id whose APN fetch has completed, so render can tell a settled
  // verdict from one still in flight without a setState in the effect body.
  const [checkedId, setCheckedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (simLoading || !activeProfileId) return;

    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;

      if (profile && profile.settings.apn.name) {
        setProfileOverride({ profileId: activeProfileId, name: profile.name });
      } else {
        setProfileOverride(null);
      }
      setCheckedId(activeProfileId);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, simLoading, getProfile]);

  const isProfileControlled =
    !!activeProfileId && profileOverride?.profileId === activeProfileId;

  const overrideUndetermined =
    simLoading || (!!activeProfileId && checkedId !== activeProfileId);

  const profileName = isProfileControlled
    ? profileOverride.name
    : t(`${K}.managed_by_profile_fallback`);

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      {/* A failed RE-read only: the card keeps its last snapshot, so say it may
          be outdated. A never-read card carries its own error and retry. */}
      {error && !isLoading && apn ? (
        <TonalBanner
          tone="destructive"
          icon="error"
          title={t(`${K}.page.error_load_title`)}
        >
          <span className="flex flex-wrap items-center gap-2">
            {t(`${K}.page.error_load_description`)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              className={BANNER_ACTION}
            >
              {t("actions.retry", { ns: "common" })}
            </Button>
          </span>
        </TonalBanner>
      ) : null}

      {isProfileControlled ? (
        <ProfileOverrideAlert
          profileName={profileName}
          controls={t(`${K}.controls_label`)}
        />
      ) : null}

      <motion.div
        className={APN_PAIR.GRID}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem} className={APN_PAIR.CELL}>
          <fieldset
            disabled={isProfileControlled || overrideUndetermined}
            className={cn(
              "m-0 flex min-w-0 flex-col border-0 p-0",
              isProfileControlled && "pointer-events-none opacity-60",
            )}
          >
            <ApnSettingsCard
              apn={apn}
              cids={cids}
              active={active}
              activeCid={activeCid}
              isLoading={isLoading || overrideUndetermined}
              isSaving={isSaving}
              isReconciling={isReconciling}
              loadError={apn === null ? error : null}
              onRetry={() => refresh()}
              onSave={save}
              onDeactivate={deactivate}
              presets={presetMatch?.presets ?? null}
              status={status}
              statusStale={statusStale}
              statusError={statusError}
            />
          </fieldset>
        </motion.div>

        <motion.div variants={staggerItem} className={APN_PAIR.CELL}>
          <MBNCard
            profiles={mbnProfiles}
            autoSel={autoSel}
            isLoading={mbnLoading}
            isSaving={mbnSaving}
            loadError={mbnError}
            onSave={saveMbn}
            onReboot={rebootMbn}
            onRetry={refreshMbn}
          />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default APNSettingsComponent;

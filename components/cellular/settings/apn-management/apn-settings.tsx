"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";

// =============================================================================
// APNSettingsComponent — APN Settings page coordinator (single-APN model)
// =============================================================================
// Gating: when a Custom SIM Profile is active AND that profile sets a
// non-empty APN, this whole page becomes read-only. The user can still see
// the current configuration but can't edit it — the source of truth is the
// profile. We wrap the cards in a disabled <fieldset> rather than threading
// `disabled` through every child component.
//
// NOTE: this page renders ONLY the single-APN card (+ the MBN card). The
// legacy 6-slot WAN-profile list/edit UI (WanProfileListCard /
// WanProfileEditCard) is retired from this page per the RM551E pixel-strict
// port — those components are left in place (not deleted) since other code
// may still import them.
// =============================================================================

const APNSettingsComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    apn,
    cids,
    active,
    activeCid,
    isLoading,
    isSaving,
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
    saveMbn,
  } = useMbnSettings();

  const { activeProfileId, isLoading: simLoading, getProfile } = useSimProfiles();

  // --- SIM Profile override check (async) ----------------------------------
  // Gate iff the active profile has a non-empty APN name. Empty APN = profile
  // does not manage APN, so we leave the page editable.
  const [profileOverride, setProfileOverride] = useState<{
    profileId: string;
    name: string;
  } | null>(null);

  // The override verdict arrives over TWO sequential fetches: useSimProfiles
  // first learns `activeProfileId`, then the effect below fetches that
  // profile's APN. `checkedId` records the profile id whose APN fetch has
  // completed, so render can tell whether the current verdict is settled or
  // still in flight — without any synchronous setState in the effect.
  const [checkedId, setCheckedId] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch once the profile list has settled and there is an active
    // profile to inspect. Until then the verdict stays "undetermined" (derived
    // below) so the UI holds its skeleton rather than exposing live controls.
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

  // True while we still can't tell whether a profile owns the APN: the list is
  // still loading, or an active profile's APN fetch hasn't resolved yet
  // (`checkedId` lags `activeProfileId`). The interactive cards stay in their
  // loading state and the fieldset stays disabled until this clears, closing
  // the window where every button is live before the override gate engages.
  const overrideUndetermined =
    simLoading || (!!activeProfileId && checkedId !== activeProfileId);

  const profileName = isProfileControlled
    ? profileOverride.name
    : t("core_settings.apn.managed_by_profile_fallback");

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("core_settings.apn.page.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("core_settings.apn.page.description")}
        </p>
      </div>

      {error && !isLoading && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon />
          <AlertTitle>{t("core_settings.apn.page.error_load_title")}</AlertTitle>
          <AlertDescription className="flex items-center gap-2">
            <span>{t("core_settings.apn.page.error_load_description")}</span>
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCwIcon className="size-3.5" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isProfileControlled && (
        <ProfileOverrideAlert
          profileName={profileName}
          controls={t("core_settings.apn.controls_label")}
        />
      )}

      {/* Fieldset wrap: `pointer-events-none opacity-60` makes the
          disabled state visually obvious while leaving values readable. */}
      <fieldset
        disabled={isProfileControlled || overrideUndetermined}
        className={
          isProfileControlled
            ? "pointer-events-none opacity-60 grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4 border-0 p-0 m-0"
            : "grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4 border-0 p-0 m-0"
        }
      >
        <ApnSettingsCard
          apn={apn}
          cids={cids}
          active={active}
          activeCid={activeCid}
          isLoading={isLoading || overrideUndetermined}
          isSaving={isSaving}
          onSave={save}
          onDeactivate={deactivate}
        />

        <MBNCard
          profiles={mbnProfiles}
          autoSel={autoSel}
          isLoading={mbnLoading}
          isSaving={mbnSaving}
          onSave={saveMbn}
        />
      </fieldset>
    </div>
  );
};

export default APNSettingsComponent;

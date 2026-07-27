"use client";

import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

import CustomProfileFormComponent from "@/components/cellular/custom-profiles/custom-profile-form";
import CustomProfileViewComponent from "@/components/cellular/custom-profiles/custom-profile-view";
import { ApplyProgressDialog } from "@/components/cellular/custom-profiles/apply-progress-dialog";
import SuggestedProfiles from "@/components/cellular/custom-profiles/suggested-profiles";
import { useSimProfiles, type ProfileFormData } from "@/hooks/use-sim-profiles";
import { useProfileApply } from "@/hooks/use-profile-apply";
import { useCurrentSettings } from "@/hooks/use-current-settings";
import { useProfileSuggestions } from "@/hooks/use-profile-suggestions";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { SimProfile } from "@/types/sim-profile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// =============================================================================
// CustomProfileComponent — Page Layout & State Coordinator
// =============================================================================
// Owns all three hooks:
//   - useSimProfiles: CRUD operations
//   - useProfileApply: async apply lifecycle
//   - useCurrentSettings: modem query for form pre-fill
//
// Coordinates between form (left card) and view (right card).
// =============================================================================

const CustomProfileComponent = () => {
  const { t } = useTranslation("cellular");
  const { t: tc } = useTranslation("common");

  const {
    profiles,
    activeProfileId,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    deactivateProfile,
    getProfile,
    refresh,
  } = useSimProfiles();

  const { applyState, applyProfile, error: applyError } = useProfileApply();

  // fetchOnMount = true: the create form pre-fills from the SIM automatically on
  // page load. The AT read takes ~2-3s, so the form treats a mount-sourced
  // settings object as fill-empty-only (and skips IMEI) — see the prefill block
  // in custom-profile-form.tsx.
  const { settings: currentSettings, refresh: refreshCurrentSettings } =
    useCurrentSettings(true);

  const { data: modemStatus } = useModemStatus();
  const currentIccid = modemStatus?.device?.iccid ?? null;

  // ---------------------------------------------------------------------------
  // "Recommended for your SIM" — carrier-matched suggestions
  // ---------------------------------------------------------------------------
  // Pure decision layer over data this page already holds: the PLMN + ICCID from
  // current_settings.sh, the saved-profile list, and the modem's supported band
  // lists. No extra endpoint, no second poller.
  //
  // The ICCID here prefers current_settings.sh's value because the backend has
  // already canonicalized it (a trailing BCD pad `F` stripped); modem status
  // carries the raw string. The hook canonicalizes either way, but starting from
  // the canonical source keeps the comparison byte-identical to the backend's.
  const {
    suggestions,
    creatingId,
    error: suggestionsError,
    createFromSuggestion,
  } = useProfileSuggestions({
    mcc: currentSettings?.mcc,
    mnc: currentSettings?.mnc,
    // SIM-provisioned carrier names, used only to suppress suggestions for
    // known resellers whose APN differs from their host network's.
    spn: currentSettings?.spn,
    networkName: currentSettings?.network_name,
    currentIccid: currentSettings?.iccid ?? currentIccid,
    profiles,
    supportedNsaBands: modemStatus?.device?.supported_nsa_nr5g_bands,
    supportedSaBands: modemStatus?.device?.supported_sa_nr5g_bands,
    createProfile,
  });

  // Refresh the list on success so the new profile appears and the suggestion
  // that produced it disappears — the visibility rule is derived from the list,
  // so this single refresh drives both.
  const handleCreateFromSuggestion = useCallback(
    async (suggestionId: string) => {
      const newId = await createFromSuggestion(suggestionId);
      if (newId) refresh();
    },
    [createFromSuggestion, refresh],
  );

  const [editingProfile, setEditingProfile] = useState<SimProfile | null>(null);

  // Apply confirmation state
  const [activateTarget, setActivateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showApplyProgress, setShowApplyProgress] = useState(false);

  // Deactivate confirmation state
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  // ---------------------------------------------------------------------------
  // Handle Edit: fetch full profile, switch form to edit mode
  // ---------------------------------------------------------------------------
  const handleEdit = useCallback(
    async (id: string) => {
      const profile = await getProfile(id);
      if (profile) {
        setEditingProfile(profile);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [getProfile]
  );

  // ---------------------------------------------------------------------------
  // Handle Save: create or update depending on edit state
  // ---------------------------------------------------------------------------
  const handleSave = useCallback(
    async (data: ProfileFormData): Promise<string | null> => {
      if (editingProfile) {
        const success = await updateProfile(editingProfile.id, data);
        if (success) {
          setEditingProfile(null);
          return editingProfile.id;
        }
        return null;
      } else {
        return await createProfile(data);
      }
    },
    [editingProfile, createProfile, updateProfile]
  );

  // ---------------------------------------------------------------------------
  // Handle Cancel Edit
  // ---------------------------------------------------------------------------
  const handleCancelEdit = useCallback(() => {
    setEditingProfile(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Handle Delete
  // ---------------------------------------------------------------------------
  const handleDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await deleteProfile(id);
      if (success && editingProfile?.id === id) {
        setEditingProfile(null);
      }
      return success;
    },
    [deleteProfile, editingProfile]
  );

  // ---------------------------------------------------------------------------
  // Handle Activate: show confirmation → apply
  // ---------------------------------------------------------------------------
  const handleActivateRequest = useCallback(
    (id: string) => {
      const profile = profiles.find((p) => p.id === id);
      if (profile) {
        setActivateTarget({ id: profile.id, name: profile.name });
      }
    },
    [profiles]
  );

  const handleActivateConfirm = useCallback(async () => {
    if (!activateTarget) return;
    setActivateTarget(null);
    setShowApplyProgress(true);
    await applyProfile(activateTarget.id);
  }, [activateTarget, applyProfile]);

  const handleApplyProgressClose = useCallback(() => {
    setShowApplyProgress(false);
    // Intentionally NOT calling resetApply() — leaving applyState in memory so
    // the table row can show "Applied at HH:MM" until the next activation
    // (which clears it via applyProfile's own setApplyState(null)).
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(async () => {
    if (!applyState?.profile_id) return;
    await applyProfile(applyState.profile_id);
  }, [applyState, applyProfile]);

  // ---------------------------------------------------------------------------
  // Handle Deactivate: show confirmation → clear active marker
  // ---------------------------------------------------------------------------
  const handleDeactivateRequest = useCallback(() => {
    setShowDeactivateConfirm(true);
  }, []);

  const handleDeactivateConfirm = useCallback(async () => {
    setIsDeactivating(true);
    await deactivateProfile();
    setIsDeactivating(false);
    setShowDeactivateConfirm(false);
  }, [deactivateProfile]);

  // ---------------------------------------------------------------------------
  // Handle "Load Current Settings" from the form
  // ---------------------------------------------------------------------------
  const handleLoadCurrentSettings = useCallback(() => {
    refreshCurrentSettings();
  }, [refreshCurrentSettings]);

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t("custom_profiles.page.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("custom_profiles.page.description")}
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <CustomProfileFormComponent
          editingProfile={editingProfile}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          currentSettings={currentSettings}
          onLoadCurrentSettings={handleLoadCurrentSettings}
        />
        <CustomProfileViewComponent
          profiles={profiles}
          activeProfileId={activeProfileId}
          isLoading={isLoading}
          error={error}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onActivate={handleActivateRequest}
          onDeactivate={handleDeactivateRequest}
          onRefresh={refresh}
          currentIccid={currentIccid}
          lastApplyState={applyState}
        />
      </div>

      {/* Recommended for your SIM — renders nothing when there is no match.
          Deliberately OUTSIDE the grid: the empty state replaces the whole view
          card (custom-profile-view.tsx returns EmptyProfileViewComponent), so a
          section nested inside it would vanish for exactly the user who has no
          profiles yet — the one most likely to want a suggestion.

          Error prop falls back to the CRUD error because the create sequence
          spans two hooks: scenario failures surface on useProfileSuggestions,
          profile failures (incl. the MAX_PROFILES=10 cap) on useSimProfiles. */}
      <SuggestedProfiles
        suggestions={suggestions}
        creatingId={creatingId}
        error={suggestionsError ?? error}
        onCreate={handleCreateFromSuggestion}
      />

      {/* Activate Confirmation Dialog */}
      <AlertDialog
        open={!!activateTarget}
        onOpenChange={(open) => !open && setActivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.activate_dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.activate_dialog.description", {
                name: activateTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateConfirm}>
              {t("custom_profiles.activate_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog
        open={showDeactivateConfirm}
        onOpenChange={(open) => !open && !isDeactivating && setShowDeactivateConfirm(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.deactivate_dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.deactivate_dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>
              {tc("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivateConfirm}
              disabled={isDeactivating}
            >
              {isDeactivating
                ? t("custom_profiles.deactivate_dialog.deactivating")
                : t("custom_profiles.deactivate_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply Progress Dialog */}
      <ApplyProgressDialog
        open={showApplyProgress}
        onClose={handleApplyProgressClose}
        applyState={applyState}
        error={applyError}
        onRetry={handleRetry}
      />
    </div>
  );
};

export default CustomProfileComponent;

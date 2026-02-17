"use client";

import React, { useState, useCallback } from "react";

import CustomProfileFormComponent from "@/components/cellular/custom-profiles/custom-profile-form";
import CustomProfileViewComponent from "@/components/cellular/custom-profiles/custom-profile-view";
import { ApplyProgressDialog } from "@/components/cellular/custom-profiles/apply-progress-dialog";
import { useSimProfiles, type ProfileFormData } from "@/hooks/use-sim-profiles";
import { useProfileApply } from "@/hooks/use-profile-apply";
import { useCurrentSettings } from "@/hooks/use-current-settings";
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
  const {
    profiles,
    activeProfileId,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    getProfile,
    refresh,
  } = useSimProfiles();

  const {
    applyState,
    isApplying,
    applyProfile,
    reset: resetApply,
    error: applyError,
  } = useProfileApply();

  const { settings: currentSettings, refresh: refreshCurrentSettings } =
    useCurrentSettings(false);

  const [editingProfile, setEditingProfile] = useState<SimProfile | null>(null);

  // Apply confirmation state
  const [activateTarget, setActivateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showApplyProgress, setShowApplyProgress] = useState(false);

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
    resetApply();
    // Refresh profile list to pick up new active profile
    refresh();
  }, [resetApply, refresh]);

  // ---------------------------------------------------------------------------
  // Handle "Load Current Settings" from the form
  // ---------------------------------------------------------------------------
  const handleLoadCurrentSettings = useCallback(() => {
    refreshCurrentSettings();
  }, [refreshCurrentSettings]);

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Custom SIM Profile</h1>
        <p className="text-muted-foreground max-w-5xl">
          Create and manage custom SIM profiles for your cellular device. Each
          profile bundles APN, IMEI, TTL, network mode, and band lock settings
          for one-click application.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
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
          onRefresh={refresh}
        />
      </div>

      {/* Activate Confirmation Dialog */}
      <AlertDialog
        open={!!activateTarget}
        onOpenChange={(open) => !open && setActivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Apply &ldquo;{activateTarget?.name}&rdquo; to the modem? This will
              update APN, network mode, band locks, TTL/HL, and IMEI settings as
              configured in the profile. Unchanged settings will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateConfirm}>
              Activate
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
      />
    </div>
  );
};

export default CustomProfileComponent;

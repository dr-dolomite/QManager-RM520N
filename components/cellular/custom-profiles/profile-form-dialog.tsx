"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CustomProfileFormComponent, {
  type WizardTab,
} from "@/components/cellular/custom-profiles/custom-profile-form";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import type {
  CurrentModemSettings,
  SimProfile,
} from "@/types/sim-profile";

// =============================================================================
// ProfileFormDialog — the create/edit wizard, hosted in a dialog
// =============================================================================
// The wizard itself (`custom-profile-form.tsx`) is UNTOUCHED. This file only
// hosts it, so the four-step flow, its validation, its own Cancel/Clear
// behaviour and its `onSave` contract all still live there.
//
// WHY THE DIALOG IS UNPADDED AND ITS HEADER IS SCREEN-READER ONLY.
// The wizard renders its own `<Card>` with a `CardHeader` that already carries
// the create/edit title and description. Wrapping that in a padded dialog with
// a second visible `DialogHeader` would double-frame it — two nested rounded
// containers and two titles saying the same thing. Radix, however, REQUIRES an
// accessible name and description on the content or it warns and leaves the
// dialog unnamed for assistive tech. So the dialog keeps a real `DialogTitle`
// and `DialogDescription` and hides them visually (`sr-only`), and the wizard's
// own card header remains the single visible one. Nothing was stripped from the
// wizard to achieve this.
//
// The content is `rounded-card` (the card role, not the hero role — this is one
// surface among the page's cards, temporarily promoted, not the page anchor),
// capped at `85dvh`, and the BODY scrolls rather than the dialog growing: a
// four-step wizard on a field tablet in landscape would otherwise push its own
// submit button off the bottom of the viewport with no way to reach it.
// `dvh`, not `vh`, so a mobile browser's collapsing URL bar does not cut it off.
// =============================================================================

interface ProfileFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Non-null puts the wizard in edit mode. */
  editingProfile?: SimProfile | null;
  /** Current modem settings for pre-fill (from useCurrentSettings). */
  currentSettings?: CurrentModemSettings | null;
  /** Ask the coordinator to read the SIM for pre-fill. */
  onLoadCurrentSettings?: () => void;
  /**
   * The wizard's own save contract, passed straight through: the new/updated
   * profile id on success, `null` on failure.
   */
  onSave: (data: ProfileFormData) => Promise<string | null>;
  /**
   * True when this save is about to trigger an auto-reapply (editing the
   * currently active profile). Passed straight through so the wizard can
   * withhold its own "Profile updated" toast and let the reapply's
   * `ApplyProgressDialog` own the verdict instead of racing it.
   */
  willAutoReapply?: boolean;
  /** Which wizard step to open on. Passed straight through; see the form's own doc. */
  initialTab?: WizardTab;
}

export function ProfileFormDialog({
  open,
  onOpenChange,
  editingProfile = null,
  currentSettings = null,
  onLoadCurrentSettings,
  onSave,
  willAutoReapply = false,
  initialTab,
}: ProfileFormDialogProps) {
  const { t } = useTranslation("cellular");
  const isEditing = Boolean(editingProfile);

  // The wizard already toasts both outcomes and owns its own error surface.
  // The only thing this wrapper decides is whether the dialog closes: a
  // non-null id means the profile landed on the device, so the input is safe to
  // dismiss. `null` means the save failed and everything the user typed is
  // still the only copy of it — closing here would destroy it, so the dialog
  // deliberately stays open and lets them retry or copy their values out.
  const handleSave = React.useCallback(
    async (data: ProfileFormData): Promise<string | null> => {
      const id = await onSave(data);
      if (id) onOpenChange(false);
      return id;
    },
    [onSave, onOpenChange],
  );

  const handleCancel = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] w-full max-w-3xl gap-0 overflow-hidden rounded-card p-0">
        {/* Required for accessibility; visually redundant with the wizard's own
            card header, so it is exposed to assistive tech only. */}
        <DialogHeader className="sr-only">
          <DialogTitle>
            {isEditing
              ? t("custom_profiles.form.edit_title")
              : t("custom_profiles.form.add_title")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("custom_profiles.form.edit_description_simple")
              : t("custom_profiles.form.add_description")}
          </DialogDescription>
        </DialogHeader>

        {/* The scroll container. The dialog shell stays fixed at its cap and
            this is what moves, so the wizard's tab strip and submit row are
            always reachable. `overscroll-contain` stops a flick at the end of
            the wizard from scrolling the page behind the overlay.

            The `[&>[data-slot=card]]` rules neutralise the wizard's own `<Card>`
            shell. `DialogContent` now paints `bg-surface`, and `--card` is the
            SAME oklch value in both modes — so the Card's fill, hairline and
            shadow would draw a second identical rectangle inside the first.
            The user reads one panel here, so one element owns its fill: the
            dialog. Only the Card's decoration is dropped; its layout (`gap-6`,
            `py-6`) and every child, including the `bg-surface-container`
            sections that still need a step above the panel, are untouched. */}
        <div className="max-h-[85dvh] overflow-y-auto overscroll-contain [scrollbar-width:thin] [&>[data-slot=card]]:border-0 [&>[data-slot=card]]:bg-transparent [&>[data-slot=card]]:shadow-none">
          <CustomProfileFormComponent
            key={editingProfile?.id ?? "new"}
            editingProfile={editingProfile}
            currentSettings={currentSettings}
            onLoadCurrentSettings={onLoadCurrentSettings}
            onSave={handleSave}
            onCancel={handleCancel}
            willAutoReapply={willAutoReapply}
            initialTab={initialTab}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProfileFormDialog;

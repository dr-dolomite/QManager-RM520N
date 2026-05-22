"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/components/ui/field";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import type { SimProfile, CurrentModemSettings } from "@/types/sim-profile";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import {
  PDP_TYPE_LABELS,
  type PdpType,
} from "@/types/sim-profile";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import {
  MNO_PRESETS,
  MNO_CUSTOM_ID,
  getMnoPreset,
} from "@/constants/mno-presets";

// =============================================================================
// CustomProfileFormComponent — Create / Edit SIM Profile Form
// =============================================================================

interface CustomProfileFormProps {
  editingProfile?: SimProfile | null;
  onSave: (data: ProfileFormData) => Promise<string | null>;
  onCancel?: () => void;
  /** Current modem settings for pre-fill (from useCurrentSettings) */
  currentSettings?: CurrentModemSettings | null;
  /** Callback to trigger loading current modem settings */
  onLoadCurrentSettings?: () => void;
}

// Sentinel value used by the "Create new custom scenario…" SelectItem. It is
// intercepted in onValueChange and NEVER written to form state.
const CREATE_SCENARIO_SENTINEL = "__create__";

// Built-in scenario ids — kept in lockstep with DEFAULT_SCENARIOS from
// types/connection-scenario.ts. Used to detect "unknown id" fallbacks.
const BUILTIN_SCENARIO_IDS = ["balanced", "gaming", "streaming"] as const;

const DEFAULT_FORM_STATE: ProfileFormData = {
  name: "",
  mno: "Custom",
  sim_iccid: "",
  cid: 1,
  apn_name: "",
  pdp_type: "IPV4V6",
  imei: "",
  ttl: 64,
  hl: 64,
  scenario_id: "balanced",
};

function profileToFormData(profile: SimProfile): ProfileFormData {
  const s = profile.settings;
  return {
    name: profile.name,
    mno: profile.mno,
    sim_iccid: profile.sim_iccid,
    cid: s.apn.cid,
    apn_name: s.apn.name,
    pdp_type: s.apn.pdp_type,
    imei: s.imei,
    ttl: s.ttl,
    hl: s.hl,
    // Older profile JSONs may lack scenario_id (null/empty) — show Balanced.
    // This auto-migrates legacy profiles to a Balanced binding on next save,
    // which is a no-op for users on stock modems (Balanced sets mode=AUTO,
    // the modem default).
    scenario_id: s.scenario_id || "balanced",
  };
}

const CustomProfileFormComponent = ({
  editingProfile,
  onSave,
  onCancel,
  currentSettings,
  onLoadCurrentSettings,
}: CustomProfileFormProps) => {
  const router = useRouter();
  const { customScenarios } = useConnectionScenarios();

  const [form, setForm] = useState<ProfileFormData>(DEFAULT_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Discard-changes dialog state for the "Create new custom scenario…" path
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const isEditing = !!editingProfile;

  // Derive MNO selection from form.mno — no separate state needed
  const selectedMno = useMemo(() => {
    const match = MNO_PRESETS.find((p) => p.label === form.mno);
    return match ? match.id : MNO_CUSTOM_ID;
  }, [form.mno]);

  // Reset form when the editing target changes (React-recommended pattern:
  // compare previous prop during render instead of syncing via useEffect)
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null);
  const currentEditingId = editingProfile?.id ?? null;

  if (currentEditingId !== prevEditingId) {
    setPrevEditingId(currentEditingId);
    setForm(
      editingProfile ? profileToFormData(editingProfile) : DEFAULT_FORM_STATE,
    );
    setErrors({});
  }

  // Pre-fill from current modem settings when loaded (create mode only)
  // Compare during render instead of useEffect to avoid cascading setState.
  const [prevSettings, setPrevSettings] = useState<CurrentModemSettings | null>(
    null,
  );

  if (currentSettings && currentSettings !== prevSettings && !isEditing) {
    setPrevSettings(currentSettings);
    const apnPrefill =
      currentSettings.apn_profiles?.length > 0
        ? (() => {
            const activeCid = currentSettings.active_cid;
            const primary =
              currentSettings.apn_profiles.find((a) => a.cid === activeCid) ||
              currentSettings.apn_profiles[0];
            return {
              cid: primary.cid,
              apn_name: primary.apn || "",
              pdp_type: primary.pdp_type || "IPV4V6",
            };
          })()
        : {};

    setForm((prev) => ({
      ...prev,
      sim_iccid: currentSettings.iccid || prev.sim_iccid,
      imei: currentSettings.imei || prev.imei,
      ...apnPrefill,
    }));
  }

  const updateField = <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleMnoChange = (mnoId: string) => {
    const preset = getMnoPreset(mnoId);
    if (preset) {
      setForm((prev) => ({
        ...prev,
        mno: preset.label,
        apn_name: preset.apn_name,
        ttl: preset.ttl,
        hl: preset.hl,
      }));
    } else {
      setForm((prev) => ({ ...prev, mno: "Custom" }));
    }
  };

  // ---------------------------------------------------------------------------
  // Scenario Select handling
  // ---------------------------------------------------------------------------

  // Compute dirty-ness against the "baseline" form (existing profile or empty
  // defaults). Used by the discard dialog to decide whether to confirm before
  // navigating away to create a new scenario.
  const baselineForm = useMemo<ProfileFormData>(
    () => (editingProfile ? profileToFormData(editingProfile) : DEFAULT_FORM_STATE),
    [editingProfile],
  );

  const isFormDirty = useMemo(() => {
    return (
      form.name !== baselineForm.name ||
      form.mno !== baselineForm.mno ||
      form.sim_iccid !== baselineForm.sim_iccid ||
      form.cid !== baselineForm.cid ||
      form.apn_name !== baselineForm.apn_name ||
      form.pdp_type !== baselineForm.pdp_type ||
      form.imei !== baselineForm.imei ||
      form.ttl !== baselineForm.ttl ||
      form.hl !== baselineForm.hl ||
      form.scenario_id !== baselineForm.scenario_id
    );
  }, [form, baselineForm]);

  const navigateToCreateScenario = () => {
    router.push("/cellular/custom-profiles/connection-scenarios?action=create");
  };

  const handleScenarioChange = (value: string) => {
    if (value === CREATE_SCENARIO_SENTINEL) {
      // Sentinel: never persist to form state. Confirm only if dirty.
      if (isFormDirty) {
        setShowDiscardDialog(true);
      } else {
        navigateToCreateScenario();
      }
      return;
    }
    updateField("scenario_id", value);
  };

  // Detect "unknown id" — user selected a custom scenario that has since been
  // deleted. Show a fallback SelectItem so the user can re-select.
  const isUnknownScenario = useMemo(() => {
    const id = form.scenario_id;
    if (!id) return false;
    if ((BUILTIN_SCENARIO_IDS as readonly string[]).includes(id)) return false;
    return !customScenarios.some((s) => s.id === id);
  }, [form.scenario_id, customScenarios]);

  // ---------------------------------------------------------------------------
  // Validation & submit
  // ---------------------------------------------------------------------------

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = "Profile name is required.";
    }

    if (form.cid < 1 || form.cid > 15) {
      newErrors.cid = "CID must be 1–15.";
    }

    if (form.imei && !/^\d{15}$/.test(form.imei)) {
      newErrors.imei = "IMEI must be exactly 15 digits.";
    }

    if (form.ttl < 0 || form.ttl > 255) {
      newErrors.ttl = "TTL must be 0–255.";
    }

    if (form.hl < 0 || form.hl > 255) {
      newErrors.hl = "HL must be 0–255.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSaving(true);
    const result = await onSave(form);
    setIsSaving(false);

    if (result) {
      toast.success(
        isEditing
          ? "Profile updated successfully."
          : "Profile created successfully.",
      );
      if (!isEditing) {
        setForm(DEFAULT_FORM_STATE);
      }
    } else {
      toast.error(
        isEditing
          ? "Failed to update profile."
          : "Failed to create profile.",
      );
    }
  };

  const handleReset = () => {
    if (isEditing && onCancel) {
      onCancel();
    } else {
      setForm(DEFAULT_FORM_STATE);
      setErrors({});
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>
          {isEditing ? "Edit Profile" : "Create Custom SIM Profile"}
        </CardTitle>
        <CardDescription>
          {isEditing
            ? `Editing "${editingProfile?.name}". Update the fields below.`
            : "Create a custom SIM profile with specific APN, TTL, and IMEI settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex w-full justify-end">
          {!isEditing && onLoadCurrentSettings && (
            <Button type="button" size="sm" onClick={onLoadCurrentSettings}>
              <DownloadIcon className="size-4" />
              Load Current SIM
            </Button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              {/* --- Profile Identity --- */}
              <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="profileName">Profile Name *</FieldLabel>
                  <Input
                    id="profileName"
                    type="text"
                    placeholder="My LTE Profile"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    aria-describedby={errors.name ? "profileName-error" : undefined}
                  />
                  {errors.name && <FieldError id="profileName-error">{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="simIccid">SIM ICCID</FieldLabel>
                  <Input
                    id="simIccid"
                    type="text"
                    placeholder="Auto-filled from current SIM"
                    value={form.sim_iccid}
                    onChange={(e) => updateField("sim_iccid", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Mobile Network Operator</FieldLabel>
                  <Select value={selectedMno} onValueChange={handleMnoChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select carrier…" />
                    </SelectTrigger>
                    <SelectContent>
                      {MNO_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={MNO_CUSTOM_ID}>Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="apnName">APN Name</FieldLabel>
                  <Input
                    id="apnName"
                    type="text"
                    placeholder="internet"
                    value={form.apn_name}
                    onChange={(e) => updateField("apn_name", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>IP Protocol</FieldLabel>
                  <Select
                    value={form.pdp_type}
                    onValueChange={(v) => updateField("pdp_type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(PDP_TYPE_LABELS) as [PdpType, string][]
                      ).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="apnCid">Profile Slot (CID)</FieldLabel>
                  <Input
                    id="apnCid"
                    type="number"
                    min={1}
                    max={15}
                    value={form.cid}
                    onChange={(e) =>
                      updateField("cid", parseInt(e.target.value) || 1)
                    }
                    aria-describedby={errors.cid ? "apnCid-error" : undefined}
                  />
                  {errors.cid && <FieldError id="apnCid-error">{errors.cid}</FieldError>}
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="imei">Preferred IMEI</FieldLabel>
                <Input
                  id="imei"
                  type="text"
                  placeholder="Leave blank to keep current IMEI"
                  maxLength={15}
                  value={form.imei}
                  onChange={(e) => updateField("imei", e.target.value)}
                  aria-describedby={errors.imei ? "imei-error" : undefined}
                />
                {errors.imei && <FieldError id="imei-error">{errors.imei}</FieldError>}
              </Field>

              <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="ttl">TTL Value</FieldLabel>
                  <Input
                    id="ttl"
                    type="number"
                    min={0}
                    max={255}
                    value={form.ttl}
                    onChange={(e) =>
                      updateField("ttl", parseInt(e.target.value) || 0)
                    }
                    aria-describedby={errors.ttl ? "ttl-error" : undefined}
                  />
                  {errors.ttl && <FieldError id="ttl-error">{errors.ttl}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="hl">Hop Limit</FieldLabel>
                  <Input
                    id="hl"
                    type="number"
                    min={0}
                    max={255}
                    value={form.hl}
                    onChange={(e) =>
                      updateField("hl", parseInt(e.target.value) || 0)
                    }
                    aria-describedby={errors.hl ? "hl-error" : undefined}
                  />
                  {errors.hl && <FieldError id="hl-error">{errors.hl}</FieldError>}
                </Field>
              </div>

              {/* --- Connection Scenario binding --- */}
              <Field>
                <FieldLabel htmlFor="scenarioBinding">
                  Connection Scenario
                </FieldLabel>
                <Select
                  value={form.scenario_id || "balanced"}
                  onValueChange={handleScenarioChange}
                >
                  <SelectTrigger id="scenarioBinding">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Built-in scenarios */}
                    <SelectGroup>
                      <SelectLabel>Built-in</SelectLabel>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="gaming">Gaming</SelectItem>
                      <SelectItem value="streaming">Streaming</SelectItem>
                    </SelectGroup>

                    {/* Custom scenarios (only if any exist) */}
                    {customScenarios.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Custom</SelectLabel>
                        {customScenarios.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}

                    {/* Fallback for an unknown id (custom scenario was deleted
                        after the profile was saved). Lets the user see the
                        invalid state and re-select. */}
                    {isUnknownScenario && (
                      <SelectItem value={form.scenario_id}>
                        (missing — please re-select)
                      </SelectItem>
                    )}

                    <SelectSeparator />

                    {/* Sentinel — intercepted in onValueChange */}
                    <SelectItem value={CREATE_SCENARIO_SENTINEL}>
                      <span className="flex items-center gap-2">
                        <PlusIcon className="size-4" />
                        Create new custom scenario…
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  The profile applies this scenario&apos;s network mode and
                  band locks on activation. Balanced (AUTO mode, no band
                  lock) leaves the Scenarios and Band Locking pages freely
                  editable; any other binding disables them while the
                  profile is active.
                </FieldDescription>
              </Field>

              {/* --- Actions --- */}
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Spinner className="size-4" />}
                  {isEditing ? "Update Profile" : "Create Profile"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  disabled={isSaving}
                >
                  {isEditing ? "Cancel" : "Reset"}
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>

      {/* Discard-changes confirmation for the "Create new scenario" path */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose any unsaved changes to this profile. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={navigateToCreateScenario}>
              Discard &amp; go to Scenarios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default CustomProfileFormComponent;

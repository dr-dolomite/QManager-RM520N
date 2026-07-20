"use client";

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DEFAULT_SCENARIO_BINDING,
  type PdpType,
  type ScenarioScheduleBlock,
} from "@/types/sim-profile";
import { useScenarioList } from "@/hooks/use-scenario-list";
import {
  clientKey,
  ensureScenarioKeys,
  hasBlockingScheduleErrors,
  stripScenarioKeys,
  validateSchedule,
} from "@/lib/scenario-schedule";
import { ScenarioPicker } from "@/components/cellular/custom-profiles/scenario-binding/scenario-picker";
import { ScheduleRuleRow } from "@/components/cellular/custom-profiles/scenario-binding/schedule-rule-row";
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

// Up to two daily schedule windows per profile — mirrors the wizard's cap so
// the device cron generator and the resolver in lib/scenario-schedule.ts stay
// bounded and easy to reason about.
const MAX_WINDOWS = 2;

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
  scenario: DEFAULT_SCENARIO_BINDING,
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
    // The backend always normalizes `scenario` onto every profile (legacy
    // profiles fall back to DEFAULT_SCENARIO_BINDING at read time), but stay
    // defensive here too. Seed client-only `_key`s for the schedule editor —
    // persisted profiles never carry them.
    scenario: ensureScenarioKeys(profile.scenario ?? DEFAULT_SCENARIO_BINDING),
  };
}

const CustomProfileFormComponent = ({
  editingProfile,
  onSave,
  onCancel,
  currentSettings,
  onLoadCurrentSettings,
}: CustomProfileFormProps) => {
  const { t } = useTranslation("cellular");
  const { scenarios, isLoading: scenariosLoading, nameForId } = useScenarioList();

  const [form, setForm] = useState<ProfileFormData>(DEFAULT_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openBlockKey, setOpenBlockKey] = useState<string | null>(null);

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
    setOpenBlockKey(null);
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
  // Scenario binding — default scenario + optional up-to-2-window schedule
  // ---------------------------------------------------------------------------
  const scenarioBlocks = form.scenario.schedule.blocks;
  const atScheduleCap = scenarioBlocks.length >= MAX_WINDOWS;

  const updateScenario = (patch: Partial<ProfileFormData["scenario"]>) => {
    setForm((prev) => ({ ...prev, scenario: { ...prev.scenario, ...patch } }));
    if (errors.schedule) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.schedule;
        return next;
      });
    }
  };

  const updateSchedule = (
    patch: Partial<ProfileFormData["scenario"]["schedule"]>,
  ) => {
    updateScenario({ schedule: { ...form.scenario.schedule, ...patch } });
  };

  const addScheduleBlock = () => {
    if (atScheduleCap) return;
    const key = clientKey();
    const block: ScenarioScheduleBlock = {
      start: "22:00",
      end: "06:00",
      days: [0, 1, 2, 3, 4, 5, 6],
      scenario: form.scenario.default,
      _key: key,
    };
    updateSchedule({ blocks: [...scenarioBlocks, block] });
    setOpenBlockKey(key);
  };

  const updateScheduleBlock = (key: string, next: ScenarioScheduleBlock) => {
    updateSchedule({
      blocks: scenarioBlocks.map((b) => (b._key === key ? next : b)),
    });
  };

  const removeScheduleBlock = (key: string) => {
    updateSchedule({ blocks: scenarioBlocks.filter((b) => b._key !== key) });
    if (openBlockKey === key) setOpenBlockKey(null);
  };

  const moveScheduleBlock = (key: string, dir: -1 | 1) => {
    const idx = scenarioBlocks.findIndex((b) => b._key === key);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= scenarioBlocks.length) return;
    const next = [...scenarioBlocks];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    updateSchedule({ blocks: next });
  };

  const scheduleValidation = useMemo(
    () => validateSchedule(form.scenario.schedule),
    [form.scenario.schedule],
  );

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

    if (
      form.scenario.schedule.enabled &&
      hasBlockingScheduleErrors(form.scenario.schedule)
    ) {
      newErrors.schedule = t("custom_profiles.form.scenario.schedule_invalid");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSaving(true);
    const payload: ProfileFormData = {
      ...form,
      scenario: stripScenarioKeys(form.scenario),
    };
    const result = await onSave(payload);
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
      setOpenBlockKey(null);
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
                      <SelectItem value={MNO_CUSTOM_ID}>
                        {t("custom_profiles.form.fields.mno_custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {t("custom_profiles.form.mno_hint")}
                  </FieldDescription>
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
                <FieldLabel htmlFor="scenarioDefault">
                  {t("custom_profiles.form.default_scenario_label")}
                </FieldLabel>
                <ScenarioPicker
                  id="scenarioDefault"
                  value={form.scenario.default}
                  scenarios={scenarios}
                  loading={scenariosLoading}
                  aria-label={t("custom_profiles.form.default_scenario_label")}
                  onChange={(id) => updateScenario({ default: id })}
                />
                <FieldDescription>
                  {t("custom_profiles.form.default_scenario_hint")}
                </FieldDescription>
              </Field>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="scheduleEnabled">
                    {t("custom_profiles.form.schedule_inline_label")}
                  </Label>
                  <span className="text-muted-foreground text-xs">
                    {t("custom_profiles.form.schedule_inline_hint")}
                  </span>
                </div>
                <Switch
                  id="scheduleEnabled"
                  checked={form.scenario.schedule.enabled}
                  onCheckedChange={(checked) => updateSchedule({ enabled: checked })}
                />
              </div>

              {form.scenario.schedule.enabled && (
                <div className="flex flex-col gap-3">
                  {scenarioBlocks.length === 0 ? (
                    <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                      {t("custom_profiles.form.windows_empty")}
                    </div>
                  ) : (
                    scenarioBlocks.map((block, i) => {
                      const key = block._key ?? `idx-${i}`;
                      return (
                        <ScheduleRuleRow
                          key={key}
                          index={i}
                          block={block}
                          scenarios={scenarios}
                          scenariosLoading={scenariosLoading}
                          error={scheduleValidation.errors[i]}
                          overlap={scheduleValidation.overlapWarnings.includes(i)}
                          open={openBlockKey === key}
                          onOpenChange={(open) => setOpenBlockKey(open ? key : null)}
                          nameForId={nameForId}
                          canReorder={scenarioBlocks.length > 1}
                          isFirst={i === 0}
                          isLast={i === scenarioBlocks.length - 1}
                          onMoveUp={() => moveScheduleBlock(key, -1)}
                          onMoveDown={() => moveScheduleBlock(key, 1)}
                          onChange={(next) => updateScheduleBlock(key, next)}
                          onRemove={() => removeScheduleBlock(key)}
                        />
                      );
                    })
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("custom_profiles.form.windows_count", {
                        count: scenarioBlocks.length,
                        max: MAX_WINDOWS,
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addScheduleBlock}
                      disabled={atScheduleCap}
                    >
                      <PlusIcon />
                      {t("custom_profiles.form.add_window")}
                    </Button>
                  </div>

                  {errors.schedule && <FieldError>{errors.schedule}</FieldError>}
                </div>
              )}

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
    </Card>
  );
};

export default CustomProfileFormComponent;

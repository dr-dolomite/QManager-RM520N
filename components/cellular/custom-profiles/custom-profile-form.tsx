"use client";

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { FileDownIcon, PlusIcon, SquarePenIcon } from "lucide-react";

import type { SimProfile, CurrentModemSettings } from "@/types/sim-profile";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import {
  DEFAULT_SCENARIO_BINDING,
  type PdpType,
  type ScenarioScheduleBlock,
} from "@/types/sim-profile";
import { useScenarioList } from "@/hooks/use-scenario-list";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useApnSettings } from "@/hooks/use-apn-settings";
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
// CustomProfileFormComponent — Create / Edit SIM Profile Wizard
// =============================================================================
// A four-step wizard (identity → network → scenario → review) rendered inside a
// single card. Fields are controlled so Submit emits the flat ProfileFormData
// the backend save.sh expects (APN keys top-level; the backend nests them into
// settings.apn and mirrors scenario.default → settings.scenario_id). The
// coordinator prop contract is unchanged: create vs. edit is driven by
// `editingProfile`, and `onSave` returns the profile id (or null on failure).
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

// Up to two daily schedule windows per profile — mirrors the device cron
// generator and the resolver in lib/scenario-schedule.ts so both stay bounded.
const MAX_WINDOWS = 2;

// System EXPO ease-out — the silky settle used across QManager motion.
const EXPO = [0.16, 1, 0.3, 1] as const;

// Wizard tab order — the "Next" button walks the user forward through these.
const TAB_ORDER = ["identity", "network", "scenario", "review"] as const;
type WizardTab = (typeof TAB_ORDER)[number];

// Synthetic "Custom" value for the saved-APN quick-pick Select — shown when the
// typed APN matches none of the saved slots. Picking it is a no-op (the APN Name
// field stays the source of truth); it exists so the trigger reads "Custom"
// instead of going blank while the user types a custom APN.
const APN_CUSTOM_VALUE = "__custom__";

// One wizard step. Slides in from the direction of travel (+ forward, - back)
// and fades on the system EXPO curve. Reduced motion shows it instantly.
const WizardPanel = ({
  dir,
  children,
}: {
  dir: number;
  children: React.ReactNode;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, x: dir * 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EXPO }
      }
    >
      {children}
    </motion.div>
  );
};

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

/** Normalize any stored PDP token (case-insensitive) to a canonical PdpType. */
function normalizePdpType(raw: string): PdpType {
  const u = (raw || "").toUpperCase();
  if (u === "IP" || u === "IPV4") return "IP";
  if (u === "IPV6") return "IPV6";
  return "IPV4V6";
}

// Backend PDP token → i18n option key under custom_profiles.form.pdp_inline.*
const PDP_OPTIONS: { value: PdpType; key: string }[] = [
  { value: "IP", key: "custom_profiles.form.pdp_inline.ipv4" },
  { value: "IPV6", key: "custom_profiles.form.pdp_inline.ipv6" },
  { value: "IPV4V6", key: "custom_profiles.form.pdp_inline.dual" },
];

// Which wizard tab owns each validation error, so a failed submit can jump the
// user to the earliest offending step.
const ERROR_TAB: Record<string, WizardTab> = {
  name: "identity",
  sim_iccid: "identity",
  apn_name: "network",
  cid: "network",
  imei: "network",
  ttl: "network",
  hl: "network",
  schedule: "scenario",
};

const CustomProfileFormComponent = ({
  editingProfile,
  onSave,
  onCancel,
  currentSettings,
  onLoadCurrentSettings,
}: CustomProfileFormProps) => {
  const { t } = useTranslation("cellular");
  const {
    scenarios,
    isLoading: scenariosLoading,
    nameForId,
  } = useScenarioList();
  // Read-only use of the profiles list to power the live duplicate-ICCID guard.
  // A second hook instance is fine here — it only reads; the coordinator owns
  // the authoritative CRUD instance.
  const { profiles } = useSimProfiles();
  const savedApn = useApnSettings();

  const [form, setForm] = useState<ProfileFormData>(DEFAULT_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openBlockKey, setOpenBlockKey] = useState<string | null>(null);

  const [tab, setTab] = useState<WizardTab>("identity");
  const [tabDir, setTabDir] = useState(1);

  const isEditing = !!editingProfile;
  const isReview = tab === "review";

  // Route every tab change through here so the wizard panel knows which way it
  // travelled (forward from Next / a later tab, back from an earlier tab or an
  // Edit jump on Review). Direction drives the slide-in offset sign.
  const changeTab = (next: WizardTab) => {
    setTabDir(TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTab(next);
  };

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
    setTab("identity");
    setTabDir(1);
  }

  // Pre-fill from current modem settings when loaded (create mode only).
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
              pdp_type: normalizePdpType(primary.pdp_type),
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
        delete next[key as string];
        return next;
      });
    }
  };

  const handleMnoChange = (mnoId: string) => {
    // Plain preset apply: copy apn/ttl/hl. No carrier is special-cased — CID and
    // every other field stay fully user-editable.
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
  // Load current SIM settings (create mode). The button fires the coordinator
  // callback; the render-time compare above prefills once currentSettings lands.
  // ---------------------------------------------------------------------------
  const handleLoadFromSim = () => {
    if (onLoadCurrentSettings) onLoadCurrentSettings();
  };

  // ---------------------------------------------------------------------------
  // Saved-APN quick-pick. The single stored APN setting (APN Settings page) is
  // offered as a one-click pre-fill. Only shown when the stored APN is non-empty.
  // The Select value is DERIVED from the typed APN — no separate state.
  // ---------------------------------------------------------------------------
  const hasSavedApn = (savedApn.apn?.apn ?? "").trim() !== "";
  const savedApnMatch =
    hasSavedApn &&
    savedApn.apn !== null &&
    form.apn_name.trim().toLowerCase() === savedApn.apn.apn.trim().toLowerCase();
  const apnSelectValue = savedApnMatch
    ? "saved_apn"
    : form.apn_name.trim() !== ""
      ? APN_CUSTOM_VALUE
      : "";

  const handleApnSelect = (value: string) => {
    if (value === APN_CUSTOM_VALUE) return; // display-only; keep typed APN
    if (value === "saved_apn" && savedApn.apn) {
      setForm((prev) => ({
        ...prev,
        apn_name: savedApn.apn!.apn,
        pdp_type: normalizePdpType(savedApn.apn!.pdp_type),
        cid: savedApn.apn!.cid || prev.cid,
      }));
    }
  };

  // ---------------------------------------------------------------------------
  // Live duplicate-ICCID guard. An ICCID may belong to only one profile — a
  // second profile on the same SIM would make activation ambiguous.
  // ---------------------------------------------------------------------------
  const trimmedIccid = form.sim_iccid.trim();
  const duplicateIccid =
    trimmedIccid !== "" &&
    profiles.some(
      (p) =>
        p.id !== editingProfile?.id && (p.sim_iccid ?? "").trim() === trimmedIccid,
    );

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
  const requiredFilled = form.name.trim() !== "" && !duplicateIccid;

  const validate = (): Record<string, string> => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = t("custom_profiles.form.fields.profile_name_required");
    }

    if (duplicateIccid) {
      newErrors.sim_iccid = t("custom_profiles.form.fields.sim_iccid_duplicate");
    }

    if (form.cid < 1 || form.cid > 15) {
      newErrors.cid = t("custom_profiles.form.fields.cid_error");
    }

    if (form.imei && !/^\d{15}$/.test(form.imei)) {
      newErrors.imei = t("custom_profiles.form.fields.imei_error");
    }

    if (form.ttl < 0 || form.ttl > 255) {
      newErrors.ttl = t("custom_profiles.form.fields.ttl_error");
    }

    if (form.hl < 0 || form.hl > 255) {
      newErrors.hl = t("custom_profiles.form.fields.hl_error");
    }

    if (
      form.scenario.schedule.enabled &&
      hasBlockingScheduleErrors(form.scenario.schedule)
    ) {
      newErrors.schedule = t("custom_profiles.form.scenario.schedule_invalid");
    }

    return newErrors;
  };

  const goNext = () => {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx >= 0 && idx < TAB_ORDER.length - 1) changeTab(TAB_ORDER[idx + 1]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = validate();
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      // Jump to the earliest tab that owns a failing field.
      const target = TAB_ORDER.find((tb) =>
        Object.keys(newErrors).some((k) => ERROR_TAB[k] === tb),
      );
      if (target) changeTab(target);
      return;
    }

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
          ? t("custom_profiles.form.toast.update_success")
          : t("custom_profiles.form.toast.create_success"),
      );
      if (!isEditing) {
        setForm(DEFAULT_FORM_STATE);
        setTab("identity");
        setTabDir(1);
      }
    } else {
      toast.error(
        isEditing
          ? t("custom_profiles.form.toast.update_error")
          : t("custom_profiles.form.toast.create_error"),
      );
    }
  };

  const handleClear = () => {
    if (isEditing && onCancel) {
      onCancel();
    } else {
      setForm(DEFAULT_FORM_STATE);
      setErrors({});
      setOpenBlockKey(null);
      setTab("identity");
      setTabDir(1);
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>
          {isEditing
            ? t("custom_profiles.form.edit_title")
            : t("custom_profiles.form.add_title")}
        </CardTitle>
        <CardDescription>
          {isEditing
            ? t("custom_profiles.form.edit_description_simple")
            : t("custom_profiles.form.add_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Tabs
              value={tab}
              onValueChange={(v) => changeTab(v as WizardTab)}
              className="w-full"
            >
              <TabsList>
                <TabsTrigger value="identity">
                  {t("custom_profiles.form.steps.identity_short")}
                </TabsTrigger>
                <TabsTrigger value="network">
                  {t("custom_profiles.form.tab_network")}
                </TabsTrigger>
                <TabsTrigger value="scenario">
                  {t("custom_profiles.form.steps.scenario_short")}
                </TabsTrigger>
                <TabsTrigger value="review">
                  {t("custom_profiles.form.steps.review_short")}
                </TabsTrigger>
              </TabsList>

              {/* --- Step 1: Identity ------------------------------------- */}
              <TabsContent value="identity">
                <WizardPanel dir={tabDir}>
                  <FieldSet>
                    <div className="flex items-center justify-between gap-3">
                      <FieldDescription>
                        {t("custom_profiles.form.sections.identity_desc")}
                      </FieldDescription>
                      {!isEditing && onLoadCurrentSettings && (
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={handleLoadFromSim}
                        >
                          <FileDownIcon />
                          {t("custom_profiles.form.load_from_sim")}
                        </Button>
                      )}
                    </div>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="profileName">
                          {t("custom_profiles.form.fields.profile_name_label")}
                        </FieldLabel>
                        <Input
                          id="profileName"
                          type="text"
                          placeholder={t(
                            "custom_profiles.form.fields.profile_name_placeholder",
                          )}
                          value={form.name}
                          onChange={(e) => updateField("name", e.target.value)}
                          aria-invalid={!!errors.name || undefined}
                          aria-describedby={
                            errors.name ? "profileName-error" : undefined
                          }
                        />
                        {errors.name && (
                          <FieldError id="profileName-error">
                            {errors.name}
                          </FieldError>
                        )}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="simIccid">
                          {t("custom_profiles.form.fields.sim_iccid_label")}
                        </FieldLabel>
                        <Input
                          id="simIccid"
                          type="text"
                          placeholder={t(
                            "custom_profiles.form.sim_iccid_placeholder_inline",
                          )}
                          value={form.sim_iccid}
                          onChange={(e) =>
                            updateField("sim_iccid", e.target.value)
                          }
                          aria-invalid={duplicateIccid || undefined}
                        />
                        <FieldDescription
                          className={
                            duplicateIccid ? "text-destructive" : undefined
                          }
                        >
                          {duplicateIccid
                            ? t(
                                "custom_profiles.form.fields.sim_iccid_duplicate",
                              )
                            : t("custom_profiles.form.sim_iccid_hint_inline")}
                        </FieldDescription>
                      </Field>

                      <FieldSeparator />

                      <Field>
                        <FieldLabel htmlFor="mno">
                          {t("custom_profiles.form.fields.mno_label")}
                        </FieldLabel>
                        <Select
                          value={selectedMno}
                          onValueChange={handleMnoChange}
                        >
                          <SelectTrigger id="mno">
                            <SelectValue
                              placeholder={t(
                                "custom_profiles.form.fields.mno_placeholder",
                              )}
                            />
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
                    </FieldGroup>
                  </FieldSet>
                </WizardPanel>
              </TabsContent>

              {/* --- Step 2: Network ------------------------------------- */}
              <TabsContent value="network">
                <WizardPanel dir={tabDir}>
                  <FieldSet>
                    <FieldDescription>
                      {t("custom_profiles.form.network_desc")}
                    </FieldDescription>
                    <FieldGroup>
                      {hasSavedApn ? (
                        <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                          <Field>
                            <FieldLabel htmlFor="apnName">
                              {t("custom_profiles.form.fields.apn_name_label")}
                            </FieldLabel>
                            <Input
                              id="apnName"
                              type="text"
                              placeholder={t(
                                "custom_profiles.form.fields.apn_name_placeholder",
                              )}
                              value={form.apn_name}
                              onChange={(e) =>
                                updateField("apn_name", e.target.value)
                              }
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="reuseApn">
                              {t("custom_profiles.form.fields.reuse_apn_label")}
                            </FieldLabel>
                            <Select
                              value={apnSelectValue}
                              onValueChange={handleApnSelect}
                            >
                              <SelectTrigger id="reuseApn">
                                <SelectValue
                                  placeholder={t(
                                    "custom_profiles.form.fields.reuse_apn_placeholder",
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {apnSelectValue === APN_CUSTOM_VALUE && (
                                  <SelectItem value={APN_CUSTOM_VALUE}>
                                    {t(
                                      "custom_profiles.form.fields.reuse_apn_custom",
                                    )}
                                  </SelectItem>
                                )}
                                <SelectItem value="saved_apn">
                                  {t(
                                    "custom_profiles.form.fields.use_saved_apn",
                                    { apn: savedApn.apn?.apn ?? "" },
                                  )}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>
                      ) : (
                        <Field>
                          <FieldLabel htmlFor="apnName">
                            {t("custom_profiles.form.fields.apn_name_label")}
                          </FieldLabel>
                          <Input
                            id="apnName"
                            type="text"
                            placeholder={t(
                              "custom_profiles.form.fields.apn_name_placeholder",
                            )}
                            value={form.apn_name}
                            onChange={(e) =>
                              updateField("apn_name", e.target.value)
                            }
                          />
                        </Field>
                      )}

                      <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                        <Field>
                          <FieldLabel htmlFor="pdpType">
                            {t("custom_profiles.form.fields.ip_protocol_label")}
                          </FieldLabel>
                          <Select
                            value={form.pdp_type}
                            onValueChange={(v) => updateField("pdp_type", v)}
                          >
                            <SelectTrigger id="pdpType">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PDP_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {t(opt.key)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="apnCid">
                            {t("custom_profiles.form.fields.cid_label")}
                          </FieldLabel>
                          <Input
                            id="apnCid"
                            type="number"
                            min={1}
                            max={15}
                            value={form.cid}
                            onChange={(e) =>
                              updateField(
                                "cid",
                                parseInt(e.target.value) || 1,
                              )
                            }
                            aria-invalid={!!errors.cid || undefined}
                            aria-describedby={
                              errors.cid ? "apnCid-error" : undefined
                            }
                          />
                          {errors.cid && (
                            <FieldError id="apnCid-error">
                              {errors.cid}
                            </FieldError>
                          )}
                        </Field>
                      </div>

                      <FieldSeparator />

                      <Field>
                        <FieldLabel htmlFor="imei">
                          {t("custom_profiles.form.fields.imei_label")}
                        </FieldLabel>
                        <Input
                          id="imei"
                          type="text"
                          placeholder={t(
                            "custom_profiles.form.fields.imei_placeholder",
                          )}
                          maxLength={15}
                          value={form.imei}
                          onChange={(e) => updateField("imei", e.target.value)}
                          aria-invalid={!!errors.imei || undefined}
                          aria-describedby={
                            errors.imei ? "imei-error" : undefined
                          }
                        />
                        {errors.imei ? (
                          <FieldError id="imei-error">{errors.imei}</FieldError>
                        ) : (
                          <FieldDescription className="text-warning">
                            {t("custom_profiles.form.fields.imei_danger")}
                          </FieldDescription>
                        )}
                      </Field>

                      <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                        <Field>
                          <FieldLabel htmlFor="ttl">
                            {t("custom_profiles.form.fields.ttl_label")}
                          </FieldLabel>
                          <Input
                            id="ttl"
                            type="number"
                            min={0}
                            max={255}
                            value={form.ttl}
                            onChange={(e) =>
                              updateField("ttl", parseInt(e.target.value) || 0)
                            }
                            aria-invalid={!!errors.ttl || undefined}
                            aria-describedby={
                              errors.ttl ? "ttl-error" : undefined
                            }
                          />
                          {errors.ttl && (
                            <FieldError id="ttl-error">{errors.ttl}</FieldError>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="hl">
                            {t("custom_profiles.form.fields.hl_label")}
                          </FieldLabel>
                          <Input
                            id="hl"
                            type="number"
                            min={0}
                            max={255}
                            value={form.hl}
                            onChange={(e) =>
                              updateField("hl", parseInt(e.target.value) || 0)
                            }
                            aria-invalid={!!errors.hl || undefined}
                            aria-describedby={
                              errors.hl ? "hl-error" : undefined
                            }
                          />
                          {errors.hl && (
                            <FieldError id="hl-error">{errors.hl}</FieldError>
                          )}
                        </Field>
                      </div>
                    </FieldGroup>
                  </FieldSet>
                </WizardPanel>
              </TabsContent>

              {/* --- Step 3: Scenario ------------------------------------ */}
              <TabsContent value="scenario">
                <WizardPanel dir={tabDir}>
                  <FieldSet>
                    <FieldDescription>
                      {t("custom_profiles.form.scenario_desc_inline")}
                    </FieldDescription>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="scenarioDefault">
                          {t("custom_profiles.form.default_scenario_label")}
                        </FieldLabel>
                        <ScenarioPicker
                          id="scenarioDefault"
                          value={form.scenario.default}
                          scenarios={scenarios}
                          loading={scenariosLoading}
                          aria-label={t(
                            "custom_profiles.form.default_scenario_label",
                          )}
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
                          onCheckedChange={(checked) =>
                            updateSchedule({ enabled: checked })
                          }
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
                                  overlap={scheduleValidation.overlapWarnings.includes(
                                    i,
                                  )}
                                  open={openBlockKey === key}
                                  onOpenChange={(open) =>
                                    setOpenBlockKey(open ? key : null)
                                  }
                                  nameForId={nameForId}
                                  canReorder={scenarioBlocks.length > 1}
                                  isFirst={i === 0}
                                  isLast={i === scenarioBlocks.length - 1}
                                  onMoveUp={() => moveScheduleBlock(key, -1)}
                                  onMoveDown={() => moveScheduleBlock(key, 1)}
                                  onChange={(next) =>
                                    updateScheduleBlock(key, next)
                                  }
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

                          {errors.schedule && (
                            <FieldError>{errors.schedule}</FieldError>
                          )}
                        </div>
                      )}
                    </FieldGroup>
                  </FieldSet>
                </WizardPanel>
              </TabsContent>

              {/* --- Step 4: Review ------------------------------------- */}
              <TabsContent value="review">
                <WizardPanel dir={tabDir}>
                  <FieldSet>
                    <FieldDescription>
                      {isEditing
                        ? t("custom_profiles.form.review_desc_edit")
                        : t("custom_profiles.form.review_desc_add")}
                    </FieldDescription>
                    <div className="flex flex-col gap-5">
                      <SummarySection
                        title={t(
                          "custom_profiles.form.review.section_identity",
                        )}
                        onEdit={() => changeTab("identity")}
                        rows={[
                          {
                            label: t(
                              "custom_profiles.form.review.profile_name",
                            ),
                            value: form.name.trim() || null,
                          },
                          {
                            label: t("custom_profiles.form.review.sim_iccid"),
                            value:
                              form.sim_iccid.trim() ||
                              t("custom_profiles.form.review.all_sims"),
                            numeric: form.sim_iccid.trim() !== "",
                          },
                          {
                            label: t("custom_profiles.form.review.operator"),
                            value: form.mno,
                          },
                        ]}
                      />
                      <SummarySection
                        title={t("custom_profiles.form.review.section_network")}
                        onEdit={() => changeTab("network")}
                        rows={[
                          {
                            label: t("custom_profiles.form.review.apn"),
                            value: form.apn_name.trim() || null,
                          },
                          {
                            label: t(
                              "custom_profiles.form.review.ip_protocol",
                            ),
                            value: t(
                              PDP_OPTIONS.find(
                                (o) => o.value === form.pdp_type,
                              )?.key ?? "custom_profiles.form.pdp_inline.dual",
                            ),
                          },
                          {
                            label: t(
                              "custom_profiles.form.review.profile_slot",
                            ),
                            value:
                              form.cid === 1
                                ? t(
                                    "custom_profiles.form.review.cid_value_default",
                                    { cid: form.cid },
                                  )
                                : t("custom_profiles.form.review.cid_value", {
                                    cid: form.cid,
                                  }),
                            numeric: true,
                          },
                          {
                            label: t(
                              "custom_profiles.form.review.preferred_imei",
                            ),
                            value: form.imei.trim() || null,
                          },
                          {
                            label: t("custom_profiles.form.review.ttl_hl"),
                            value: `${form.ttl} / ${form.hl}`,
                            numeric: true,
                          },
                        ]}
                      />
                      <SummarySection
                        title={t(
                          "custom_profiles.form.review.section_scenario",
                        )}
                        onEdit={() => changeTab("scenario")}
                        rows={[
                          {
                            label: t("custom_profiles.form.review.default"),
                            value: nameForId(form.scenario.default),
                          },
                          ...(form.scenario.schedule.enabled
                            ? scenarioBlocks.length === 0
                              ? [
                                  {
                                    label: t(
                                      "custom_profiles.form.review.schedule",
                                    ),
                                    value: t(
                                      "custom_profiles.form.review.schedule_on_no_windows",
                                    ),
                                  },
                                ]
                              : scenarioBlocks.map((b, i) => ({
                                  label: t(
                                    "custom_profiles.form.window_label",
                                    { index: i + 1 },
                                  ),
                                  value: t(
                                    "custom_profiles.form.review.window_value",
                                    {
                                      scenario: nameForId(b.scenario),
                                      start: b.start,
                                      end: b.end,
                                    },
                                  ),
                                  numeric: true,
                                }))
                            : [
                                {
                                  label: t(
                                    "custom_profiles.form.review.schedule",
                                  ),
                                  value: t(
                                    "custom_profiles.form.review.schedule_off",
                                  ),
                                },
                              ]),
                        ]}
                      />
                    </div>
                  </FieldSet>
                </WizardPanel>
              </TabsContent>
            </Tabs>

            <FieldSeparator />

            <Field orientation="horizontal">
              {/*
                Distinct keys are LOAD-BEARING, not cosmetic. Without them React
                reconciles these two buttons by position and reuses the same
                <button> DOM node, mutating its `type` from "button" to "submit"
                in place. Because React 18 flushes the "Next" click synchronously,
                that mutation lands BEFORE the browser performs the click's
                default action — so the browser sees a submit button and submits
                the form, silently saving the profile on every Next→Review step.
                Separate keys force a remount: the clicked node stays type="button"
                for its whole life, so no stray submit fires.
              */}
              {isReview ? (
                <Button
                  key="profile-submit"
                  type="submit"
                  disabled={isSaving || !requiredFilled}
                >
                  {isSaving && <Spinner className="size-4" />}
                  {isEditing
                    ? t("custom_profiles.form.submit_edit")
                    : t("custom_profiles.form.submit_add")}
                </Button>
              ) : (
                <Button key="profile-next" type="button" onClick={goNext}>
                  {t("custom_profiles.form.next")}
                </Button>
              )}
              <Button variant="outline" type="button" onClick={handleClear}>
                {isEditing
                  ? t("custom_profiles.form.cancel")
                  : t("custom_profiles.form.clear")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
};

// -----------------------------------------------------------------------------
// Review-tab building blocks (presentational summary bound to live form state).
// -----------------------------------------------------------------------------
interface SummaryRow {
  label: string;
  value: string | null;
  numeric?: boolean;
}

const SummarySection = ({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: SummaryRow[];
  onEdit: () => void;
}) => {
  const { t } = useTranslation("cellular");
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2"
          onClick={onEdit}
        >
          <SquarePenIcon className="size-3.5" />
          {t("custom_profiles.form.review_edit_aria")}
        </Button>
      </div>
      <dl className="divide-border divide-y">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 py-2 text-sm"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={
                row.value === null
                  ? "text-muted-foreground/60"
                  : row.numeric
                    ? "text-right font-medium tabular-nums"
                    : "text-right font-medium"
              }
            >
              {row.value ?? t("custom_profiles.form.review.not_set")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

export default CustomProfileFormComponent;

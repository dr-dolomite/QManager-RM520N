"use client";

import React, { useState, useEffect } from "react";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
  FieldSeparator,
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
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { DownloadIcon } from "lucide-react";

import type { SimProfile, CurrentModemSettings } from "@/types/sim-profile";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import {
  NETWORK_MODE_LABELS,
  PDP_TYPE_LABELS,
  AUTH_TYPE_LABELS,
  type NetworkModePreference,
  type PdpType,
  type AuthType,
} from "@/types/sim-profile";

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

const DEFAULT_FORM_STATE: ProfileFormData = {
  name: "",
  mno: "",
  sim_iccid: "",
  cid: 1,
  apn_name: "",
  pdp_type: "IPV4V6",
  auth_type: 0,
  username: "",
  password: "",
  imei: "",
  ttl: 64,
  hl: 64,
  network_mode: "AUTO",
  lte_bands: "",
  nsa_nr_bands: "",
  sa_nr_bands: "",
  band_lock_enabled: false,
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
    auth_type: s.apn.auth_type,
    username: s.apn.username,
    password: s.apn.password,
    imei: s.imei,
    ttl: s.ttl,
    hl: s.hl,
    network_mode: s.network_mode,
    lte_bands: s.lte_bands,
    nsa_nr_bands: s.nsa_nr_bands,
    sa_nr_bands: s.sa_nr_bands,
    band_lock_enabled: s.band_lock_enabled,
  };
}

/**
 * Convert modem AT mode value to our NetworkModePreference enum.
 */
function atModeToFormMode(atMode: string): string {
  switch (atMode) {
    case "AUTO":
      return "AUTO";
    case "LTE":
      return "LTE_ONLY";
    case "NR5G":
      return "NR_ONLY";
    case "LTE:NR5G":
      return "LTE_NR";
    default:
      return "AUTO";
  }
}

const CustomProfileFormComponent = ({
  editingProfile,
  onSave,
  onCancel,
  currentSettings,
  onLoadCurrentSettings,
}: CustomProfileFormProps) => {
  const [form, setForm] = useState<ProfileFormData>(DEFAULT_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isEditing = !!editingProfile;

  // Populate form when editing
  useEffect(() => {
    if (editingProfile) {
      setForm(profileToFormData(editingProfile));
      setErrors({});
      setSuccessMsg(null);
    }
  }, [editingProfile]);

  // Pre-fill from current modem settings when loaded (create mode only)
  useEffect(() => {
    if (currentSettings && !isEditing) {
      setForm((prev) => ({
        ...prev,
        imei: currentSettings.imei || prev.imei,
        network_mode: currentSettings.network_mode
          ? atModeToFormMode(currentSettings.network_mode)
          : prev.network_mode,
        lte_bands: currentSettings.lte_bands || prev.lte_bands,
        nsa_nr_bands: currentSettings.nsa_nr_bands || prev.nsa_nr_bands,
        sa_nr_bands: currentSettings.sa_nr_bands || prev.sa_nr_bands,
        // Pre-fill APN from CID 1 if available
        ...(currentSettings.apn_profiles?.length > 0
          ? (() => {
              const primary =
                currentSettings.apn_profiles.find((a) => a.cid === 1) ||
                currentSettings.apn_profiles[0];
              return {
                cid: primary.cid,
                apn_name: primary.apn || "",
                pdp_type: primary.pdp_type || "IPV4V6",
              };
            })()
          : {}),
      }));
    }
  }, [currentSettings, isEditing]);

  const updateField = <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K]
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

    const bandRegex = /^(\d+(:\d+)*)?$/;
    if (form.lte_bands && !bandRegex.test(form.lte_bands)) {
      newErrors.lte_bands = "Use colon-delimited numbers (e.g., 1:3:7:28).";
    }
    if (form.nsa_nr_bands && !bandRegex.test(form.nsa_nr_bands)) {
      newErrors.nsa_nr_bands = "Use colon-delimited numbers (e.g., 41:78).";
    }
    if (form.sa_nr_bands && !bandRegex.test(form.sa_nr_bands)) {
      newErrors.sa_nr_bands = "Use colon-delimited numbers (e.g., 41:78).";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);

    if (!validate()) return;

    setIsSaving(true);
    const result = await onSave(form);
    setIsSaving(false);

    if (result) {
      setSuccessMsg(
        isEditing
          ? "Profile updated successfully."
          : "Profile created successfully."
      );
      if (!isEditing) {
        setForm(DEFAULT_FORM_STATE);
      }
    }
  };

  const handleReset = () => {
    if (isEditing && onCancel) {
      onCancel();
    } else {
      setForm(DEFAULT_FORM_STATE);
      setErrors({});
      setSuccessMsg(null);
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>
              {isEditing ? "Edit Profile" : "Create Custom SIM Profile"}
            </CardTitle>
            <CardDescription>
              {isEditing
                ? `Editing "${editingProfile?.name}". Update the fields below.`
                : "Fill out the form below to create a custom SIM profile."}
            </CardDescription>
          </div>
          {!isEditing && onLoadCurrentSettings && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLoadCurrentSettings}
            >
              <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
              Load Current
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              {/* --- Profile Identity --- */}
              <Field>
                <FieldLabel htmlFor="profileName">Profile Name *</FieldLabel>
                <Input
                  id="profileName"
                  type="text"
                  placeholder="My LTE Profile"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="mno">
                    Mobile Network Operator
                  </FieldLabel>
                  <Input
                    id="mno"
                    type="text"
                    placeholder="e.g., Smart, Globe, T-Mobile"
                    value={form.mno}
                    onChange={(e) => updateField("mno", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="simIccid">SIM ICCID</FieldLabel>
                  <Input
                    id="simIccid"
                    type="text"
                    placeholder="Optional — binds profile to a SIM"
                    value={form.sim_iccid}
                    onChange={(e) => updateField("sim_iccid", e.target.value)}
                  />
                  <FieldDescription>
                    Informational only. Not enforced.
                  </FieldDescription>
                </Field>
              </div>

              <FieldSeparator>APN Settings</FieldSeparator>

              <div className="grid grid-cols-1 @md/card:grid-cols-3 gap-4">
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
                <Field>
                  <FieldLabel>PDP Type</FieldLabel>
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
                  <FieldLabel htmlFor="apnCid">CID</FieldLabel>
                  <Input
                    id="apnCid"
                    type="number"
                    min={1}
                    max={15}
                    value={form.cid}
                    onChange={(e) =>
                      updateField("cid", parseInt(e.target.value) || 1)
                    }
                  />
                  {errors.cid && <FieldError>{errors.cid}</FieldError>}
                </Field>
              </div>

              <div className="grid grid-cols-1 @md/card:grid-cols-3 gap-4">
                <Field>
                  <FieldLabel>Auth Type</FieldLabel>
                  <Select
                    value={String(form.auth_type)}
                    onValueChange={(v) =>
                      updateField("auth_type", parseInt(v) as AuthType)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(AUTH_TYPE_LABELS) as [string, string][]
                      ).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {form.auth_type > 0 && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="apnUser">Username</FieldLabel>
                      <Input
                        id="apnUser"
                        type="text"
                        value={form.username}
                        onChange={(e) =>
                          updateField("username", e.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="apnPass">Password</FieldLabel>
                      <Input
                        id="apnPass"
                        type="password"
                        value={form.password}
                        onChange={(e) =>
                          updateField("password", e.target.value)
                        }
                      />
                    </Field>
                  </>
                )}
              </div>

              <FieldSeparator>Device Settings</FieldSeparator>

              <Field>
                <FieldLabel htmlFor="imei">Preferred IMEI</FieldLabel>
                <Input
                  id="imei"
                  type="text"
                  placeholder="Leave blank to keep current IMEI"
                  maxLength={15}
                  value={form.imei}
                  onChange={(e) => updateField("imei", e.target.value)}
                />
                {errors.imei && <FieldError>{errors.imei}</FieldError>}
                <FieldDescription>
                  15 digits. Changing IMEI requires a modem reboot.
                </FieldDescription>
              </Field>

              <div className="grid grid-cols-1 @md/card:grid-cols-3 gap-4">
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
                  />
                  {errors.ttl && <FieldError>{errors.ttl}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="hl">HL Value (IPv6)</FieldLabel>
                  <Input
                    id="hl"
                    type="number"
                    min={0}
                    max={255}
                    value={form.hl}
                    onChange={(e) =>
                      updateField("hl", parseInt(e.target.value) || 0)
                    }
                  />
                  {errors.hl && <FieldError>{errors.hl}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel>Network Mode</FieldLabel>
                  <Select
                    value={form.network_mode}
                    onValueChange={(v) => updateField("network_mode", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(NETWORK_MODE_LABELS) as [
                          NetworkModePreference,
                          string,
                        ][]
                      ).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <FieldSeparator>Band Locking</FieldSeparator>

              <Field orientation="horizontal">
                <div className="flex items-center justify-between">
                  <div>
                    <FieldLabel htmlFor="bandLockEnabled">
                      Enable Band Locking
                    </FieldLabel>
                    <FieldDescription>
                      When disabled, the modem uses all available bands.
                    </FieldDescription>
                  </div>
                  <Switch
                    id="bandLockEnabled"
                    checked={form.band_lock_enabled}
                    onCheckedChange={(checked) =>
                      updateField("band_lock_enabled", checked)
                    }
                  />
                </div>
              </Field>

              {form.band_lock_enabled && (
                <div className="grid grid-cols-1 gap-4">
                  <Field>
                    <FieldLabel htmlFor="lteBands">LTE Bands</FieldLabel>
                    <Input
                      id="lteBands"
                      type="text"
                      placeholder={
                        currentSettings?.supported_lte_bands
                          ? `Supported: ${currentSettings.supported_lte_bands}`
                          : "e.g., 1:3:7:28:40"
                      }
                      value={form.lte_bands}
                      onChange={(e) =>
                        updateField("lte_bands", e.target.value)
                      }
                    />
                    {errors.lte_bands && (
                      <FieldError>{errors.lte_bands}</FieldError>
                    )}
                    <FieldDescription>
                      Colon-separated band numbers.
                      {currentSettings?.supported_lte_bands && (
                        <> Hardware supports: {currentSettings.supported_lte_bands}</>
                      )}
                    </FieldDescription>
                  </Field>
                  <div className="grid grid-cols-1 @md/card:grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="nsaNrBands">
                        NSA NR5G Bands
                      </FieldLabel>
                      <Input
                        id="nsaNrBands"
                        type="text"
                        placeholder={
                          currentSettings?.supported_nsa_nr_bands
                            ? `Supported: ${currentSettings.supported_nsa_nr_bands}`
                            : "e.g., 41:78"
                        }
                        value={form.nsa_nr_bands}
                        onChange={(e) =>
                          updateField("nsa_nr_bands", e.target.value)
                        }
                      />
                      {errors.nsa_nr_bands && (
                        <FieldError>{errors.nsa_nr_bands}</FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="saNrBands">
                        SA NR5G Bands
                      </FieldLabel>
                      <Input
                        id="saNrBands"
                        type="text"
                        placeholder={
                          currentSettings?.supported_sa_nr_bands
                            ? `Supported: ${currentSettings.supported_sa_nr_bands}`
                            : "e.g., 41:78"
                        }
                        value={form.sa_nr_bands}
                        onChange={(e) =>
                          updateField("sa_nr_bands", e.target.value)
                        }
                      />
                      {errors.sa_nr_bands && (
                        <FieldError>{errors.sa_nr_bands}</FieldError>
                      )}
                    </Field>
                  </div>
                </div>
              )}

              {/* --- Actions --- */}
              {successMsg && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  {successMsg}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Spinner className="mr-2 h-4 w-4" />}
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

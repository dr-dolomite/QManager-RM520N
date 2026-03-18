"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { FolderOpenIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MNO_PRESETS,
  MNO_CUSTOM_ID,
  getMnoPreset,
} from "@/constants/mno-presets";

// =============================================================================
// StepConnection — Onboarding step 4: APN or Custom SIM Profile (optional)
// =============================================================================

const APN_ENDPOINT = "/cgi-bin/quecmanager/cellular/apn.sh";
const PROFILES_ENDPOINT = "/cgi-bin/quecmanager/profiles/save.sh";

type ConnectionType = "profile" | "apn" | null;

interface StepConnectionProps {
  onSubmitRef: (fn: () => Promise<void>) => void;
  onLoadingChange: (loading: boolean) => void;
  onSuccess: () => void;
}

export function StepConnection({
  onSubmitRef,
  onLoadingChange,
  onSuccess,
}: StepConnectionProps) {
  const [selectedType, setSelectedType] = useState<ConnectionType>(null);

  // Shared form state
  const [mno, setMno] = useState("");
  const [apnName, setApnName] = useState("");
  const [pdpType, setPdpType] = useState("IPV4V6");
  const [profileName, setProfileName] = useState("");
  const [formError, setFormError] = useState("");

  const handleTypeSelect = (type: "profile" | "apn") => {
    setSelectedType(type);
    setFormError("");
  };

  // When a carrier preset is picked, auto-fill APN
  const handleMnoChange = (id: string) => {
    setMno(id);
    const preset = getMnoPreset(id);
    if (preset) {
      setApnName(preset.apn_name);
    } else if (id === MNO_CUSTOM_ID) {
      setApnName("");
    }
  };

  const submit = useCallback(async () => {
    setFormError("");

    // No selection = skip
    if (selectedType === null) {
      onSuccess();
      return;
    }

    if (!apnName.trim()) {
      setFormError("APN name is required.");
      return;
    }

    if (selectedType === "profile" && !profileName.trim()) {
      setFormError("Profile name is required.");
      return;
    }

    onLoadingChange(true);
    try {
      if (selectedType === "apn") {
        await authFetch(APN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cid: 1, pdp_type: pdpType, apn: apnName }),
        });
      } else {
        // Profile creation
        const preset = getMnoPreset(mno);
        await authFetch(PROFILES_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileName,
            mno: mno || MNO_CUSTOM_ID,
            sim_iccid: "",
            cid: 1,
            apn_name: apnName,
            pdp_type: pdpType,
            imei: "",
            ttl: preset?.ttl ?? 0,
            hl: preset?.hl ?? 0,
          }),
        });
      }
    } catch {
      // Non-fatal: connection setup is optional
    } finally {
      onLoadingChange(false);
      onSuccess();
    }
  }, [selectedType, apnName, pdpType, profileName, mno, onLoadingChange, onSuccess]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">
          Configure your connection
        </h2>
        <p className="text-sm text-muted-foreground">
          Set up your data APN or create a custom SIM profile.
        </p>
      </div>

      {/* Choice cards */}
      <div className="grid grid-cols-2 gap-3">
        <ChoiceCard
          selected={selectedType === "profile"}
          onClick={() => handleTypeSelect("profile")}
          icon={<FolderOpenIcon className="size-5" />}
          title="Custom Profile"
          description="Save complete configs per SIM"
        />
        <ChoiceCard
          selected={selectedType === "apn"}
          onClick={() => handleTypeSelect("apn")}
          icon={<WrenchIcon className="size-5" />}
          title="APN Only"
          description="Quick setup for your carrier"
        />
      </div>

      {/* Inline form — animates in when a type is selected */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          selectedType !== null ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <FieldGroup>
            {selectedType === "profile" && (
              <Field>
                <FieldLabel htmlFor="conn-profile-name">Profile Name</FieldLabel>
                <Input
                  id="conn-profile-name"
                  placeholder="e.g. Home SIM, Data Only"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="conn-carrier">Carrier Preset</FieldLabel>
              <Select value={mno} onValueChange={handleMnoChange}>
                <SelectTrigger id="conn-carrier">
                  <SelectValue placeholder="Select carrier…" />
                </SelectTrigger>
                <SelectContent>
                  {MNO_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={MNO_CUSTOM_ID}>Custom</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="conn-apn">APN Name</FieldLabel>
              <Input
                id="conn-apn"
                placeholder="e.g. internet, SMARTLTE"
                value={apnName}
                onChange={(e) => setApnName(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="conn-pdp">IP Protocol</FieldLabel>
              <Select value={pdpType} onValueChange={setPdpType}>
                <SelectTrigger id="conn-pdp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IPV4V6">IPv4 + IPv6 (Default)</SelectItem>
                  <SelectItem value="IP">IPv4 Only</SelectItem>
                  <SelectItem value="IPV6">IPv6 Only</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {formError && <FieldError>{formError}</FieldError>}
          </FieldGroup>
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChoiceCard — selectable card for profile vs APN choice
// ---------------------------------------------------------------------------

interface ChoiceCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}

function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: ChoiceCardProps) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors duration-150",
        "hover:border-primary/50 hover:bg-primary/5",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card"
      )}
    >
      <span
        className={cn(
          "rounded-lg p-2 transition-colors duration-150",
          selected
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug">{title}</span>
        <span className="text-xs text-muted-foreground leading-snug">
          {description}
        </span>
      </div>
    </motion.button>
  );
}

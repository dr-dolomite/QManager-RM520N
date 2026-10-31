"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { toast } from "sonner";
import { FolderOpenIcon, WrenchIcon } from "lucide-react";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import { OptionRow } from "../option-row";
import { postStep, stepFailureMessage, type StepWriteResult } from "../post-step";
import { STEP_DESCRIPTION, STEP_HEADING } from "../shapes";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MNO_PRESETS, MNO_CUSTOM_ID, getMnoPreset } from "@/constants/mno-presets";

const APN_ENDPOINT = "/cgi-bin/quecmanager/cellular/apn.sh";
const PROFILES_ENDPOINT = "/cgi-bin/quecmanager/profiles/save.sh";

// The select holds the profile store's AT spelling (IP / IPV6 / IPV4V6);
// apn.sh validates the lowercase family names.
const APN_PDP: Record<string, string> = {
  IPV4V6: "ipv4v6",
  IP: "ipv4",
  IPV6: "ipv6",
};

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
  const { t } = useTranslation("onboarding");
  const [selectedType, setSelectedType] = useState<ConnectionType>(null);

  const [mno, setMno] = useState("");
  const [apnName, setApnName] = useState("");
  const [pdpType, setPdpType] = useState("IPV4V6");
  const [profileName, setProfileName] = useState("");
  const [formError, setFormError] = useState("");

  const handleTypeSelect = (type: "profile" | "apn") => {
    setSelectedType(type);
    setFormError("");
  };

  // A carrier preset fills in its APN.
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

    if (selectedType === null) {
      onSuccess();
      return;
    }

    if (!apnName.trim()) {
      setFormError(t("connection.error_apn_required"));
      return;
    }

    if (selectedType === "profile" && !profileName.trim()) {
      setFormError(t("connection.error_profile_name_required"));
      return;
    }

    onLoadingChange(true);
    let result: StepWriteResult;
    if (selectedType === "apn") {
      result = await postStep(APN_ENDPOINT, {
        action: "save",
        cid: 1,
        pdp_type: APN_PDP[pdpType] ?? "ipv4v6",
        apn: apnName.trim(),
      });
    } else {
      const preset = getMnoPreset(mno);
      result = await postStep(PROFILES_ENDPOINT, {
        name: profileName.trim(),
        mno: mno || MNO_CUSTOM_ID,
        sim_iccid: "",
        cid: 1,
        apn_name: apnName.trim(),
        pdp_type: pdpType,
        imei: "",
        ttl: preset?.ttl ?? 0,
        hl: preset?.hl ?? 0,
      });
    }
    onLoadingChange(false);

    if (!result.ok) {
      // Stay on the step so the user can correct and retry, or Skip.
      toast.error(
        stepFailureMessage(
          t,
          result,
          selectedType === "apn"
            ? t("connection.toast_apn_failed")
            : t("connection.toast_profile_failed"),
        ),
      );
      return;
    }
    onSuccess();
  }, [selectedType, apnName, pdpType, profileName, mno, onLoadingChange, onSuccess, t]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className={STEP_HEADING}>{t("connection.heading")}</h2>
        <p className={STEP_DESCRIPTION}>{t("connection.description")}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("connection.aria_connection_type")}
        className="flex flex-col gap-1.5"
      >
        <OptionRow
          selected={selectedType === "profile"}
          onSelect={() => handleTypeSelect("profile")}
          icon={<FolderOpenIcon className="size-4" />}
          label={t("connection.choice_profile_title")}
          detail={t("connection.choice_profile_desc")}
        />
        <OptionRow
          selected={selectedType === "apn"}
          onSelect={() => handleTypeSelect("apn")}
          icon={<WrenchIcon className="size-4" />}
          label={t("connection.choice_apn_title")}
          detail={t("connection.choice_apn_desc")}
        />
      </div>

      {/* The form arrives once a type is chosen (opacity and rise only) */}
      {selectedType !== null && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
        >
          <FieldGroup>
            {selectedType === "profile" && (
              <Field>
                <FieldLabel htmlFor="conn-profile-name">{t("connection.label_profile_name")}</FieldLabel>
                <Input
                  id="conn-profile-name"
                  placeholder={t("connection.placeholder_profile_name")}
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="conn-carrier">{t("connection.label_carrier")}</FieldLabel>
              <Select value={mno} onValueChange={handleMnoChange}>
                <SelectTrigger id="conn-carrier" className="w-full">
                  <SelectValue placeholder={t("connection.placeholder_carrier")} />
                </SelectTrigger>
                <SelectContent>
                  {MNO_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={MNO_CUSTOM_ID}>{t("connection.option_carrier_custom")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="conn-apn">{t("connection.label_apn")}</FieldLabel>
              <Input
                id="conn-apn"
                className="font-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("connection.placeholder_apn")}
                value={apnName}
                onChange={(e) => setApnName(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="conn-pdp">{t("connection.label_pdp_type")}</FieldLabel>
              <Select value={pdpType} onValueChange={setPdpType}>
                <SelectTrigger id="conn-pdp" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IPV4V6">{t("connection.option_pdp_ipv4v6")}</SelectItem>
                  <SelectItem value="IP">{t("connection.option_pdp_ipv4")}</SelectItem>
                  <SelectItem value="IPV6">{t("connection.option_pdp_ipv6")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {formError && <FieldError>{formError}</FieldError>}
          </FieldGroup>
        </motion.div>
      )}
    </div>
  );
}

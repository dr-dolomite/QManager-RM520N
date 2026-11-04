"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { failureReason } from "../ttl-mtu-settings/failure-reason";
import { CheckIcon } from "lucide-react";
import { HintIcon } from "@/components/ui/hint-icon";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { FIELD, HOTSPOT_GROUP, LABEL, MODE_REASON, ONOFF_CTL } from "./shapes";

// A shortcut onto the global TTL/HL setting (the TTL page's own backend). 0/0 is off,
// 64/64 is ours; anything else belongs to the TTL page or a SIM profile and renders locked.
const BYPASS_TTL = 64;
const BYPASS_HL = 64;

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

interface BypassHotspotRowProps {
  /** Composer-owned, so the Engine card's view swaps never refetch it. */
  ttl: UseTtlSettingsReturn;
}

/** The Engine card's Hotspot bypass: label above, an On / Off control. */
export function BypassHotspotRow({ ttl }: BypassHotspotRowProps) {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, saveTtlHl } = ttl;

  const active = data?.isEnabled ?? false;
  const ttlValue = data?.ttl ?? 0;
  const hlValue = data?.hl ?? 0;
  const externallyOwned = active && !(ttlValue === BYPASS_TTL && hlValue === BYPASS_HL);

  const handleChange = useCallback(
    async (next: boolean) => {
      const result = next ? await saveTtlHl(BYPASS_TTL, BYPASS_HL) : await saveTtlHl(0, 0);
      if (result.ok) {
        toast.success(
          t(next ? "traffic_engine.bypass_toast_enabled" : "traffic_engine.bypass_toast_disabled"),
        );
      } else {
        // The TTL hook already translates its reason; its generic fallback only restates this title.
        const title = t("traffic_engine.bypass_toast_error");
        const generic = t("ttlMtu.toast_ttl_error", { ns: "common" });
        toast.error(title, {
          description: failureReason(title, result.error === generic ? null : result.error),
        });
      }
    },
    [saveTtlHl, t],
  );

  return (
    <div className={HOTSPOT_GROUP}>
      <div className={FIELD.LABEL_ROW}>
        <span className={LABEL}>{t("traffic_engine.bypass_label")}</span>
        <HintIcon label={t("traffic_engine.aria_bypass_hint")}>
          {t("traffic_engine.bypass_hint")}
        </HintIcon>
      </div>
      <SegmentedField
        value={active ? "on" : "off"}
        onValueChange={(next) => void handleChange(next === "on")}
        ariaLabel={t("traffic_engine.bypass_label")}
        disabled={externallyOwned || isLoading || isSaving || data === null}
        breakpoint="never"
        glyph={renderCheckGlyph}
        className={ONOFF_CTL}
        options={[
          { value: "off", label: t("state.off", { ns: "common" }) },
          { value: "on", label: t("state.on", { ns: "common" }) },
        ]}
      />
      {externallyOwned ? (
        <p className={MODE_REASON}>
          {t("traffic_engine.bypass_helper_external", { ttl: ttlValue, hl: hlValue })}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useMtuSettings } from "@/hooks/use-mtu-settings";

// =============================================================================
// MTUSettingsCard — MTU Configuration
// =============================================================================
// Connected to the useMtuSettings hook for fetching and saving MTU.
// Toggle on/off enables or disables custom MTU across rmnet_data interfaces.
// =============================================================================

const MTUSettingsCard = () => {
  const { data, isLoading, isSaving, error, saveMtu, disableMtu } =
    useMtuSettings();

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Maximum Transmission Unit (MTU) Configuration</CardTitle>
          <CardDescription>
            Set the maximum packet size on the cellular data interface. Lower
            values can help with fragmentation issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <MTUForm
      data={data}
      isSaving={isSaving}
      error={error}
      saveMtu={saveMtu}
      disableMtu={disableMtu}
    />
  );
};

function MTUForm({
  data,
  isSaving,
  error,
  saveMtu,
  disableMtu,
}: {
  data: ReturnType<typeof useMtuSettings>["data"];
  isSaving: boolean;
  error: string | null;
  saveMtu: ReturnType<typeof useMtuSettings>["saveMtu"];
  disableMtu: ReturnType<typeof useMtuSettings>["disableMtu"];
}) {
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();

  // Form state initialized from data, then re-seeded by the render-phase sync
  const [prevData, setPrevData] = useState(data);
  const [isEnabled, setIsEnabled] = useState(data?.isEnabled ?? false);
  const [mtuValue, setMtuValue] = useState(
    data ? String(data.currentValue) : "",
  );

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  // Replaces the former data-derived `key` remount, which killed the pending
  // `saved` flash because the refetch and markSaved() land in one React batch.
  if (data !== prevData) {
    setPrevData(data);
    setIsEnabled(data?.isEnabled ?? false);
    setMtuValue(data ? String(data.currentValue) : "");
  }

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      mtuValue !== String(data.currentValue) || isEnabled !== data.isEnabled
    );
  }, [data, mtuValue, isEnabled]);

  const mtuNum = Number(mtuValue);
  const isMtuInvalid =
    isEnabled &&
    mtuValue !== "" &&
    (isNaN(mtuNum) || mtuNum < 576 || mtuNum > 9000);

  const handleToggle = useCallback(
    (checked: boolean) => {
      setIsEnabled(checked);
      if (!checked && data) {
        setMtuValue(String(data.currentValue));
      }
    },
    [data],
  );

  const handleSave = useCallback(async () => {
    if (!isEnabled) {
      const success = await disableMtu();
      if (success) {
        markSaved();
        toast.success("Custom MTU disabled");
      } else {
        toast.error(error || "Failed to disable MTU settings");
      }
      return;
    }

    const mtu = parseInt(mtuValue, 10);
    if (isNaN(mtu) || mtu < 576 || mtu > 9000) return;

    const success = await saveMtu(mtu);
    if (success) {
      markSaved();
      toast.success(`MTU set to ${mtu}`);
    } else {
      toast.error(error || "Failed to apply MTU settings");
    }
  }, [isEnabled, mtuValue, saveMtu, disableMtu, error, markSaved]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Maximum Transmission Unit (MTU) Configuration</CardTitle>
        <CardDescription>
          Set the maximum packet size on the cellular data interface. Lower
          values can help with fragmentation issues.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="mtu-setting">
                    Enable Custom MTU
                  </FieldLabel>
                  <Switch
                    id="mtu-setting"
                    checked={isEnabled}
                    onCheckedChange={handleToggle}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="mtu-value">MTU Value</FieldLabel>
                <Input
                  id="mtu-value"
                  type="number"
                  min="576"
                  max="9000"
                  placeholder="e.g. 1500"
                  className="w-full"
                  value={mtuValue}
                  onChange={(e) => setMtuValue(e.target.value)}
                  disabled={!isEnabled}
                  aria-invalid={isMtuInvalid}
                  aria-describedby={isMtuInvalid ? "mtu-error" : undefined}
                />
                {isMtuInvalid && (
                  <FieldError id="mtu-error">
                    MTU must be between 576 and 9000
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          </FieldSet>
          <div>
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              label={t("actions.apply")}
              disabled={!isDirty}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default MTUSettingsCard;

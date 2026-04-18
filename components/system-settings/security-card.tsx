"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import type { UseSystemSettingsReturn } from "@/hooks/use-system-settings";

// =============================================================================
// Unit helpers
// =============================================================================

type TimeUnit = "minutes" | "hours" | "days";

const UNIT_SECONDS: Record<TimeUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

function secondsToDisplay(seconds: number): { value: number; unit: TimeUnit } {
  if (seconds === 0) return { value: 1, unit: "hours" };
  if (seconds % UNIT_SECONDS.days === 0)
    return { value: seconds / UNIT_SECONDS.days, unit: "days" };
  if (seconds % UNIT_SECONDS.hours === 0)
    return { value: seconds / UNIT_SECONDS.hours, unit: "hours" };
  return { value: Math.ceil(seconds / UNIT_SECONDS.minutes), unit: "minutes" };
}

function displayToSeconds(value: number, unit: TimeUnit): number {
  return value * UNIT_SECONDS[unit];
}

// =============================================================================
// SecurityCard
// =============================================================================

type Props = Pick<
  UseSystemSettingsReturn,
  "settings" | "isLoading" | "isSaving" | "saveSecuritySettings"
>;

export default function SecurityCard({
  settings,
  isLoading,
  isSaving,
  saveSecuritySettings,
}: Props) {
  const { saved, markSaved } = useSaveFlash();

  const [neverExpire, setNeverExpire] = useState(false);
  const [value, setValue] = useState("1");
  const [unit, setUnit] = useState<TimeUnit>("hours");
  const [isDirty, setIsDirty] = useState(false);

  // Sync local state when settings load
  useEffect(() => {
    if (!settings) return;
    const age = settings.session_max_age ?? 3600;
    if (age === 0) {
      setNeverExpire(true);
      setValue("1");
      setUnit("hours");
    } else {
      const { value: v, unit: u } = secondsToDisplay(age);
      setNeverExpire(false);
      setValue(String(v));
      setUnit(u);
    }
    setIsDirty(false);
  }, [settings]);

  const handleValueChange = useCallback((v: string) => {
    setValue(v);
    setIsDirty(true);
  }, []);

  const handleUnitChange = useCallback((u: TimeUnit) => {
    setUnit(u);
    setIsDirty(true);
  }, []);

  const handleNeverExpireChange = useCallback((checked: boolean) => {
    setNeverExpire(checked);
    setIsDirty(true);
  }, []);

  const parsedValue = parseInt(value, 10);
  const valueValid =
    neverExpire ||
    (!isNaN(parsedValue) &&
      parsedValue >= 1 &&
      displayToSeconds(parsedValue, unit) >= 60);

  const canSave = isDirty && valueValid && !isSaving && !saved;

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const session_max_age = neverExpire
      ? 0
      : displayToSeconds(parsedValue, unit);

    const ok = await saveSecuritySettings({
      action: "save_security",
      session_max_age,
    });

    if (ok) {
      markSaved();
      setIsDirty(false);
      toast.success("Security settings saved.");
    } else {
      toast.error("Failed to save security settings.");
    }
  }, [canSave, neverExpire, parsedValue, unit, saveSecuritySettings, markSaved]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          Configure session authentication settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="session-timeout-value">
              Session Timeout
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="session-timeout-value"
                type="number"
                min={1}
                step={1}
                value={value}
                onChange={(e) => handleValueChange(e.target.value)}
                disabled={neverExpire || isSaving}
                className="w-24"
              />
              <Select
                value={unit}
                onValueChange={(v) => handleUnitChange(v as TimeUnit)}
                disabled={neverExpire || isSaving}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  Never expire
                </span>
                <Switch
                  checked={neverExpire}
                  onCheckedChange={handleNeverExpireChange}
                  disabled={isSaving}
                />
              </div>
            </div>
            {!neverExpire && !valueValid && (
              <p role="alert" className="text-sm text-destructive">
                Minimum timeout is 1 minute.
              </p>
            )}
            <FieldDescription>
              {neverExpire
                ? "Sessions will remain active until the device reboots or you log out."
                : "Time before an inactive session is automatically signed out."}
            </FieldDescription>
          </Field>
        )}

        <SaveButton
          isSaving={isSaving}
          saved={saved}
          disabled={!canSave}
          onClick={handleSave}
          type="button"
          className="w-full"
        />
      </CardContent>
    </Card>
  );
}

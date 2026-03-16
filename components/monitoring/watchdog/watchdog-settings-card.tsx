"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangleIcon, InfoIcon } from "lucide-react";
import type {
  WatchdogSavePayload,
  UseWatchdogSettingsReturn,
} from "@/hooks/use-watchdog-settings";
import { Separator } from "@/components/ui/separator";

type WatchdogSettingsCardProps = Pick<
  UseWatchdogSettingsReturn,
  | "settings"
  | "autoDisabled"
  | "isLoading"
  | "isSaving"
  | "error"
  | "saveSettings"
>;

export function WatchdogSettingsCard({
  settings,
  autoDisabled,
  isLoading,
  isSaving,
  error,
  saveSettings,
}: WatchdogSettingsCardProps) {
  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Watchdog Settings</CardTitle>
          <CardDescription>
            Configure connection health monitoring and recovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 @sm/card:grid-cols-2 gap-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <Skeleton className="h-5 w-32 mt-2" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-7 w-44" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Key-based remount: when settings change (initial load or post-save re-fetch),
  // the form reinitializes with fresh values from useState defaults.
  const formKey = settings
    ? `${settings.enabled}-${settings.max_failures}-${settings.check_interval}-${settings.cooldown}-${settings.backup_sim_slot}`
    : "empty";

  return (
    <WatchdogSettingsForm
      key={formKey}
      settings={settings}
      autoDisabled={autoDisabled}
      isSaving={isSaving}
      error={error}
      saveSettings={saveSettings}
    />
  );
}

function WatchdogSettingsForm({
  settings,
  autoDisabled,
  isSaving,
  error,
  saveSettings,
}: Omit<WatchdogSettingsCardProps, "isLoading">) {
  // --- Local form state (initialized from settings prop) ---
  const [isEnabled, setIsEnabled] = useState(settings?.enabled ?? false);
  const [maxFailures, setMaxFailures] = useState(
    String(settings?.max_failures ?? 5),
  );
  const [checkInterval, setCheckInterval] = useState(
    String(settings?.check_interval ?? 10),
  );
  const [cooldown, setCooldown] = useState(String(settings?.cooldown ?? 60));
  const [tier1Enabled, setTier1Enabled] = useState(
    settings?.tier1_enabled ?? true,
  );
  const [tier2Enabled, setTier2Enabled] = useState(
    settings?.tier2_enabled ?? true,
  );
  const [tier3Enabled, setTier3Enabled] = useState(
    settings?.tier3_enabled ?? false,
  );
  const [tier4Enabled, setTier4Enabled] = useState(
    settings?.tier4_enabled ?? true,
  );
  const [backupSimSlot, setBackupSimSlot] = useState<string>(
    settings?.backup_sim_slot != null ? String(settings.backup_sim_slot) : "",
  );
  const [maxRebootsPerHour, setMaxRebootsPerHour] = useState(
    String(settings?.max_reboots_per_hour ?? 3),
  );

  // --- Validation ---
  const maxFailuresError =
    maxFailures &&
    (isNaN(Number(maxFailures)) ||
      Number(maxFailures) < 1 ||
      Number(maxFailures) > 20)
      ? "Must be 1\u201320"
      : null;

  const cooldownError =
    cooldown &&
    (isNaN(Number(cooldown)) || Number(cooldown) < 10 || Number(cooldown) > 300)
      ? "Must be 10\u2013300 seconds"
      : null;

  const maxRebootsError =
    maxRebootsPerHour &&
    (isNaN(Number(maxRebootsPerHour)) ||
      Number(maxRebootsPerHour) < 1 ||
      Number(maxRebootsPerHour) > 10)
      ? "Must be 1\u201310"
      : null;

  const hasValidationErrors = !!(
    maxFailuresError ||
    cooldownError ||
    maxRebootsError
  );

  // --- Dirty check ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      isEnabled !== settings.enabled ||
      maxFailures !== String(settings.max_failures) ||
      checkInterval !== String(settings.check_interval) ||
      cooldown !== String(settings.cooldown) ||
      tier1Enabled !== settings.tier1_enabled ||
      tier2Enabled !== settings.tier2_enabled ||
      tier3Enabled !== settings.tier3_enabled ||
      tier4Enabled !== settings.tier4_enabled ||
      backupSimSlot !==
        (settings.backup_sim_slot != null
          ? String(settings.backup_sim_slot)
          : "") ||
      maxRebootsPerHour !== String(settings.max_reboots_per_hour)
    );
  }, [
    settings,
    isEnabled,
    maxFailures,
    checkInterval,
    cooldown,
    tier1Enabled,
    tier2Enabled,
    tier3Enabled,
    tier4Enabled,
    backupSimSlot,
    maxRebootsPerHour,
  ]);

  const canSave = !hasValidationErrors && isDirty && !isSaving;

  // --- Save handler ---
  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSave) return;

      const payload: WatchdogSavePayload = {
        action: "save_settings",
        enabled: isEnabled,
        max_failures: parseInt(maxFailures, 10),
        check_interval: parseInt(checkInterval, 10),
        cooldown: parseInt(cooldown, 10),
        tier1_enabled: tier1Enabled,
        tier2_enabled: tier2Enabled,
        tier3_enabled: tier3Enabled,
        tier4_enabled: tier4Enabled,
        backup_sim_slot: backupSimSlot ? parseInt(backupSimSlot, 10) : null,
        max_reboots_per_hour: parseInt(maxRebootsPerHour, 10),
      };

      const success = await saveSettings(payload);
      if (success) {
        toast.success("Watchdog settings saved");
      } else {
        toast.error(error || "Failed to save watchdog settings");
      }
    },
    [
      canSave,
      isEnabled,
      maxFailures,
      checkInterval,
      cooldown,
      tier1Enabled,
      tier2Enabled,
      tier3Enabled,
      tier4Enabled,
      backupSimSlot,
      maxRebootsPerHour,
      saveSettings,
      error,
    ],
  );

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Watchdog Settings</CardTitle>
        <CardDescription>
          Configure connection health monitoring and recovery.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {autoDisabled && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>
              Watchdog disabled itself after too many reboots in one hour.
              Re-enable it below once your connection is stable.
            </AlertDescription>
          </Alert>
        )}

        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              {/* Master toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="watchdog-enabled">
                  Enable Watchdog
                </FieldLabel>
                <Switch
                  id="watchdog-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </Field>

              <div className="grid grid-cols-1 @sm/card:grid-cols-2 gap-4">
                {/* Max Failures */}
                <Field>
                  <FieldLabel htmlFor="max-failures">
                    Failure Threshold
                  </FieldLabel>
                  <Input
                    id="max-failures"
                    type="number"
                    min="1"
                    max="20"
                    placeholder="5"
                    className="max-w-sm"
                    value={maxFailures}
                    onChange={(e) => setMaxFailures(e.target.value)}
                    disabled={!isEnabled}
                    aria-invalid={!!maxFailuresError}
                    aria-describedby={
                      maxFailuresError
                        ? "max-failures-error"
                        : "max-failures-desc"
                    }
                  />
                  {maxFailuresError ? (
                    <FieldError id="max-failures-error">
                      {maxFailuresError}
                    </FieldError>
                  ) : (
                    <FieldDescription id="max-failures-desc">
                      How many failed connectivity checks in a row before
                      recovery begins.
                    </FieldDescription>
                  )}
                </Field>

                {/* Check Interval */}
                <Field>
                  <FieldLabel htmlFor="check-interval">
                    Check Interval
                  </FieldLabel>
                  <Select
                    value={checkInterval}
                    onValueChange={setCheckInterval}
                    disabled={!isEnabled}
                  >
                    <SelectTrigger id="check-interval" className="max-w-sm">
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 seconds</SelectItem>
                      <SelectItem value="10">10 seconds</SelectItem>
                      <SelectItem value="15">15 seconds</SelectItem>
                      <SelectItem value="30">30 seconds</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    How often the watchdog checks your internet connection.
                  </FieldDescription>
                </Field>

                {/* Cooldown */}
                <Field>
                  <FieldLabel htmlFor="cooldown">
                    Cooldown Period (seconds)
                  </FieldLabel>
                  <Input
                    id="cooldown"
                    type="number"
                    min="10"
                    max="300"
                    placeholder="60"
                    className="max-w-sm"
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    disabled={!isEnabled}
                    aria-invalid={!!cooldownError}
                    aria-describedby={
                      cooldownError ? "cooldown-error" : "cooldown-desc"
                    }
                  />
                  {cooldownError ? (
                    <FieldError id="cooldown-error">{cooldownError}</FieldError>
                  ) : (
                    <FieldDescription id="cooldown-desc">
                      Wait time after each recovery step before checking
                      connectivity again.
                    </FieldDescription>
                  )}
                </Field>

                {tier4Enabled && (
                  <Field>
                    <FieldLabel htmlFor="max-reboots">
                      Max Reboots Per Hour
                    </FieldLabel>
                    <Input
                      id="max-reboots"
                      type="number"
                      min="1"
                      max="10"
                      placeholder="3"
                      className="max-w-sm"
                      value={maxRebootsPerHour}
                      onChange={(e) => setMaxRebootsPerHour(e.target.value)}
                      disabled={!isEnabled}
                      aria-invalid={!!maxRebootsError}
                      aria-describedby={
                        maxRebootsError
                          ? "max-reboots-error"
                          : "max-reboots-desc"
                      }
                    />
                    {maxRebootsError ? (
                      <FieldError id="max-reboots-error">
                        {maxRebootsError}
                      </FieldError>
                    ) : (
                      <FieldDescription id="max-reboots-desc">
                        Safety limit. The watchdog disables itself if this many
                        reboots happen in one hour.
                      </FieldDescription>
                    )}
                  </Field>
                )}

                <div aria-live="polite">
                  {tier3Enabled && (
                    <Field>
                      <FieldLabel htmlFor="backup-sim-slot">
                        Backup SIM Slot
                      </FieldLabel>
                      <Select
                        value={backupSimSlot}
                        onValueChange={setBackupSimSlot}
                        disabled={!isEnabled}
                      >
                        <SelectTrigger
                          id="backup-sim-slot"
                          className="max-w-sm"
                        >
                          <SelectValue placeholder="Select slot" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Slot 1</SelectItem>
                          <SelectItem value="2">Slot 2</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        The SIM slot to switch to when the primary SIM loses
                        connectivity. Must differ from the current active slot.
                      </FieldDescription>
                    </Field>
                  )}
                </div>
              </div>

              <Separator />
              <div className="grid gap-2">
                <CardTitle>Recovery Steps</CardTitle>
                <CardDescription>
                  Tried in order, from gentlest to most disruptive.
                </CardDescription>
              </div>

              <div className="grid grid-cols-1 @sm/card:grid-cols-2 gap-4">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="tier1-enabled">
                    Restart Network Interface
                  </FieldLabel>
                  <Switch
                    id="tier1-enabled"
                    checked={tier1Enabled}
                    onCheckedChange={setTier1Enabled}
                    disabled={!isEnabled}
                  />
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <div className="flex items-center justify-center gap-x-2">
                    <Tooltip>
                      <TooltipTrigger>
                        <InfoIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Automatically skipped when tower lock is active <br />{" "}
                          to preserve your locked cells.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <FieldLabel htmlFor="tier2-enabled">
                      Restart Modem Radio
                    </FieldLabel>
                    <Switch
                      id="tier2-enabled"
                      checked={tier2Enabled}
                      onCheckedChange={setTier2Enabled}
                      disabled={!isEnabled}
                      aria-describedby={tier2Enabled ? "tier2-note" : undefined}
                    />
                  </div>
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="tier3-enabled">
                    Switch to Backup SIM
                  </FieldLabel>
                  <Switch
                    id="tier3-enabled"
                    checked={tier3Enabled}
                    onCheckedChange={setTier3Enabled}
                    disabled={!isEnabled}
                  />
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="tier4-enabled">Reboot Device</FieldLabel>
                  <Switch
                    id="tier4-enabled"
                    checked={tier4Enabled}
                    onCheckedChange={setTier4Enabled}
                    disabled={!isEnabled}
                  />
                </Field>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" className="w-fit" disabled={!canSave}>
                  {isSaving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Settings"
                  )}
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}

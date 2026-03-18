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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  AlertTriangleIcon,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";

import type {
  UseSystemSettingsReturn,
  SaveSettingsPayload,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";
import { cn } from "@/lib/utils";

// ─── Component ──────────────────────────────────────────────────────────────

type SystemSettingsCardProps = Pick<
  UseSystemSettingsReturn,
  "settings" | "isLoading" | "isSaving" | "error" | "saveSettings"
>;

export default function SystemSettingsCard({
  settings,
  isLoading,
  isSaving,
  error,
  saveSettings,
}: SystemSettingsCardProps) {
  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Settings</CardTitle>
          <CardDescription>
            Configure device preferences and display options.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-9 w-52" />
            </div>
            <Separator />
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state ---
  if (error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Settings</CardTitle>
          <CardDescription>
            Configure device preferences and display options.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Key-based remount: when settings change after save/re-fetch,
  // the form reinitializes with fresh values from useState defaults.
  const formKey = settings
    ? `${settings.wan_guard_enabled}-${settings.temp_unit}-${settings.distance_unit}-${settings.zonename}`
    : "empty";

  return (
    <SystemSettingsForm
      key={formKey}
      settings={settings}
      isSaving={isSaving}
      error={error}
      saveSettings={saveSettings}
    />
  );
}

// ─── Form (remounts on settings change for clean state reset) ───────────────

interface SystemSettingsFormProps {
  settings: UseSystemSettingsReturn["settings"];
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<boolean>;
}

function SystemSettingsForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: SystemSettingsFormProps) {
  // --- Local form state (initialized from settings prop) ---
  const [tempUnit, setTempUnit] = useState<"celsius" | "fahrenheit">(
    settings?.temp_unit ?? "celsius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(
    settings?.distance_unit ?? "km",
  );
  const [zonename, setZonename] = useState(settings?.zonename ?? "UTC");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC0");
  const [tzOpen, setTzOpen] = useState(false);

  // WAN Guard toggle state (saves immediately, not via Save button)
  const [wanGuardEnabled, setWanGuardEnabled] = useState(
    settings?.wan_guard_enabled ?? false,
  );
  const [wanGuardSaving, setWanGuardSaving] = useState(false);

  // --- Dirty check (only for items 2-4, not WAN Guard) ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      tempUnit !== settings.temp_unit ||
      distanceUnit !== settings.distance_unit ||
      zonename !== settings.zonename
    );
  }, [settings, tempUnit, distanceUnit, zonename]);

  const canSave = isDirty && !isSaving;

  // --- WAN Guard immediate toggle handler ---
  const handleWanGuardChange = useCallback(
    async (checked: boolean) => {
      setWanGuardEnabled(checked);
      setWanGuardSaving(true);

      const success = await saveSettings({
        action: "save_settings",
        wan_guard_enabled: checked,
        temp_unit: settings?.temp_unit ?? "celsius",
        distance_unit: settings?.distance_unit ?? "km",
        timezone: settings?.timezone ?? "UTC0",
        zonename: settings?.zonename ?? "UTC",
      });

      setWanGuardSaving(false);

      if (success) {
        toast.success(checked ? "WAN Guard enabled" : "WAN Guard disabled");
      } else {
        // Revert on failure
        setWanGuardEnabled(!checked);
        toast.error("Failed to update WAN Guard");
      }
    },
    [saveSettings, settings],
  );

  // --- Timezone change handler ---
  const handleTimezoneChange = useCallback((selectedZonename: string) => {
    const entry = TIMEZONES.find((tz) => tz.zonename === selectedZonename);
    if (entry) {
      setZonename(entry.zonename);
      setTimezone(entry.timezone);
    }
  }, []);

  // --- Save handler (items 2-4) ---
  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const success = await saveSettings({
      action: "save_settings",
      wan_guard_enabled: wanGuardEnabled,
      temp_unit: tempUnit,
      distance_unit: distanceUnit,
      timezone,
      zonename,
    });

    if (success) {
      toast.success("Settings saved");
    } else {
      toast.error(error || "Failed to save settings");
    }
  }, [
    canSave,
    saveSettings,
    wanGuardEnabled,
    tempUnit,
    distanceUnit,
    timezone,
    zonename,
    error,
  ]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>System Settings</CardTitle>
        <CardDescription>
          Configure device preferences and display options.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2">
          {/* ── WAN Guard Toggle ──────────────────────────────────── */}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex"
                    aria-label="WAN Guard info"
                  >
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Checks WAN interface profiles at boot and disables <br />{" "}
                    any that don&apos;t have an active data connection, <br />{" "}
                    preventing unnecessary CPU usage.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                WAN Guard
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="wan-guard-enabled"
                checked={wanGuardEnabled}
                onCheckedChange={handleWanGuardChange}
                disabled={wanGuardSaving}
              />
              <Label htmlFor="wan-guard-enabled">
                {wanGuardEnabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>

          {/* ── Temperature Unit ──────────────────────────────────── */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Temperature Unit
            </p>
            <Select
              value={tempUnit}
              onValueChange={(v) => setTempUnit(v as "celsius" | "fahrenheit")}
            >
              <SelectTrigger className="w-36" aria-label="Temperature unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">Celsius</SelectItem>
                <SelectItem value="fahrenheit">Fahrenheit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── Distance Unit ─────────────────────────────────────── */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Distance Unit
            </p>
            <Select
              value={distanceUnit}
              onValueChange={(v) => setDistanceUnit(v as "km" | "miles")}
            >
              <SelectTrigger className="w-36" aria-label="Distance unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">Kilometers</SelectItem>
                <SelectItem value="miles">Miles</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── Timezone ──────────────────────────────────────────── */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Timezone
            </p>
            <Popover open={tzOpen} onOpenChange={setTzOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={tzOpen}
                  className="w-52 @sm/card:w-64 justify-between font-normal"
                >
                  <span className="truncate">
                    {TIMEZONES.find((tz) => tz.zonename === zonename)?.label ??
                      "Select timezone"}
                  </span>
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search timezone..." />
                  <CommandList>
                    <CommandEmpty>No timezone found.</CommandEmpty>
                    <CommandGroup>
                      {TIMEZONES.map((tz) => (
                        <CommandItem
                          key={tz.zonename}
                          value={tz.label}
                          onSelect={() => {
                            handleTimezoneChange(tz.zonename);
                            setTzOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              zonename === tz.zonename
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {tz.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* ── Save Button ───────────────────────────────────────── */}
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!canSave} className="w-fit">
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
        </div>
      </CardContent>
    </Card>
  );
}

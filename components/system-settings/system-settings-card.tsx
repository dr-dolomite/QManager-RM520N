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
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangleIcon,
  Check,
  ChevronsUpDown,
  TriangleAlertIcon,
} from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { motion, type Variants } from "motion/react";

import type {
  UseSystemSettingsReturn,
  SaveSettingsPayload,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";

// ─── Animation variants ────────────────────────────────────────────────────



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
          {/* Mirrors the loaded geometry exactly: three setting rows and the
              save action, so the card does not reflow when data lands. */}
          <div className="grid gap-2">
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

  return (
    <SystemSettingsForm
      settings={settings}
      isSaving={isSaving}
      error={error}
      saveSettings={saveSettings}
    />
  );
}

// ─── Form (re-seeds from settings via render-phase sync, never remounts) ────

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
  const { saved, markSaved } = useSaveFlash();

  // --- Local form state (initialized from settings prop) ---
  const [prevSettings, setPrevSettings] = useState(settings);
  const [tempUnit, setTempUnit] = useState<"celsius" | "fahrenheit">(
    settings?.temp_unit ?? "celsius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(
    settings?.distance_unit ?? "km",
  );
  const [zonename, setZonename] = useState(settings?.zonename ?? "UTC");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC0");
  const [tzOpen, setTzOpen] = useState(false);

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  // Replaces the former data-derived `key` remount, which killed the pending
  // `saved` flash because the refetch and markSaved() land in one React batch.
  // `tzOpen` is popover UI state, not server data — deliberately not synced.
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    setTempUnit(settings?.temp_unit ?? "celsius");
    setDistanceUnit(settings?.distance_unit ?? "km");
    setZonename(settings?.zonename ?? "UTC");
    setTimezone(settings?.timezone ?? "UTC0");
  }

  // --- Dirty check ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      tempUnit !== settings.temp_unit ||
      distanceUnit !== settings.distance_unit ||
      zonename !== settings.zonename ||
      timezone !== settings.timezone
    );
  }, [settings, tempUnit, distanceUnit, zonename, timezone]);

  const canSave = isDirty && !isSaving;

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
      temp_unit: tempUnit,
      distance_unit: distanceUnit,
      timezone,
      zonename,
    });

    if (success) {
      markSaved();
      toast.success("Settings saved");
    } else {
      toast.error(error || "Failed to save settings");
    }
  }, [
    canSave,
    saveSettings,
    tempUnit,
    distanceUnit,
    timezone,
    zonename,
    error,
    markSaved,
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

        <motion.div
          className="grid gap-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── Temperature Unit ──────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex items-center justify-between">
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
          </motion.div>

          {/* ── Distance Unit ─────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex items-center justify-between">
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
          </motion.div>

          {/* ── Timezone ──────────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="grid gap-2">
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

            {/* Timezone ground-truth: warn when the configured zone did not
                reach the live device clock. Only render when the backend
                explicitly reports the state (older backends omit the field). */}
            {settings?.timezone_applied === false && (
              <div className="flex flex-col items-start gap-1.5">
                <Badge variant="warning">
                  <TriangleAlertIcon className="size-3" />
                  Not applied — clock shows {settings.effective_offset}
                </Badge>
                <p className="text-muted-foreground text-sm">
                  Saved as {settings.zonename} ({settings.timezone}) but the
                  device clock is still {settings.effective_offset}. It may
                  apply shortly, or the timezone data may be missing.
                </p>
              </div>
            )}

            {settings?.timezone_applied === true &&
              settings.effective_zone_abbr &&
              settings.effective_offset && (
                <p className="text-muted-foreground text-sm">
                  Clock:{" "}
                  <span className="font-mono">
                    {settings.effective_zone_abbr} {settings.effective_offset}
                  </span>
                </p>
              )}
          </motion.div>

          {/* ── Save Button ───────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex justify-end">
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
            />
          </motion.div>
        </motion.div>
      </CardContent>

    </Card>
  );
}

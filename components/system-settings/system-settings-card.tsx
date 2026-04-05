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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangleIcon,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { motion, type Variants } from "motion/react";

import type {
  UseSystemSettingsReturn,
  SaveSettingsPayload,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";
import { cn } from "@/lib/utils";

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

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
    ? `${settings.temp_unit}-${settings.distance_unit}-${settings.zonename}-${settings.sms_tool_device}`
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
  const { saved, markSaved } = useSaveFlash();

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

  // --- Dirty check ---
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      tempUnit !== settings.temp_unit ||
      distanceUnit !== settings.distance_unit ||
      zonename !== settings.zonename
    );
  }, [settings, tempUnit, distanceUnit, zonename]);

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
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── Temperature Unit ──────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex items-center justify-between">
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
          <motion.div variants={itemVariants} className="flex items-center justify-between">
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
          <motion.div variants={itemVariants} className="flex items-center justify-between">
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
          </motion.div>

          {/* ── Save Button ───────────────────────────────────────── */}
          <Separator />
          <motion.div variants={itemVariants} className="flex justify-end">
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

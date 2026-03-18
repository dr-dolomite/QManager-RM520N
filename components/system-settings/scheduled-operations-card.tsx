"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TbInfoCircleFilled } from "react-icons/tb";
import { AlertTriangleIcon, CircleIcon } from "lucide-react";

import type {
  UseSystemSettingsReturn,
  SaveScheduledRebootPayload,
  SaveLowPowerPayload,
} from "@/hooks/use-system-settings";
import type { ScheduleConfig, LowPowerConfig } from "@/types/system-settings";
import { DAY_LABELS } from "@/types/system-settings";

type ScheduledOperationsCardProps = Pick<
  UseSystemSettingsReturn,
  | "scheduledReboot"
  | "lowPower"
  | "isLoading"
  | "error"
  | "saveScheduledReboot"
  | "saveLowPower"
>;

const ScheduledOperationsCard = ({
  scheduledReboot,
  lowPower,
  isLoading,
  error,
  saveScheduledReboot,
  saveLowPower,
}: ScheduledOperationsCardProps) => {

  // ─── Scheduled Reboot local state ──────────────────────────────────────────
  const [rebootEnabled, setRebootEnabled] = useState(false);
  const [rebootTime, setRebootTime] = useState("04:00");
  const [rebootDays, setRebootDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // ─── Low Power local state ─────────────────────────────────────────────────
  const [lpEnabled, setLpEnabled] = useState(false);
  const [lpStartTime, setLpStartTime] = useState("23:00");
  const [lpEndTime, setLpEndTime] = useState("06:00");
  const [lpDays, setLpDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // ─── Debounce timer refs ───────────────────────────────────────────────────
  const rebootSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Sync from hook data (render-time, not useEffect) ──────────────────────
  const [prevReboot, setPrevReboot] = useState<ScheduleConfig | null>(null);
  if (scheduledReboot && scheduledReboot !== prevReboot) {
    setPrevReboot(scheduledReboot);
    setRebootEnabled(scheduledReboot.enabled);
    setRebootTime(scheduledReboot.time);
    setRebootDays(scheduledReboot.days);
  }

  const [prevLowPower, setPrevLowPower] = useState<LowPowerConfig | null>(null);
  if (lowPower && lowPower !== prevLowPower) {
    setPrevLowPower(lowPower);
    setLpEnabled(lowPower.enabled);
    setLpStartTime(lowPower.start_time);
    setLpEndTime(lowPower.end_time);
    setLpDays(lowPower.days);
  }

  // ─── Cleanup timers on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rebootSaveTimerRef.current) clearTimeout(rebootSaveTimerRef.current);
      if (lpSaveTimerRef.current) clearTimeout(lpSaveTimerRef.current);
    };
  }, []);

  // ─── Debounced save helpers ────────────────────────────────────────────────
  const debouncedRebootSave = useCallback(
    (payload: SaveScheduledRebootPayload) => {
      if (rebootSaveTimerRef.current) {
        clearTimeout(rebootSaveTimerRef.current);
      }
      rebootSaveTimerRef.current = setTimeout(() => {
        saveScheduledReboot(payload);
      }, 800);
    },
    [saveScheduledReboot],
  );

  const debouncedLpSave = useCallback(
    (payload: SaveLowPowerPayload) => {
      if (lpSaveTimerRef.current) {
        clearTimeout(lpSaveTimerRef.current);
      }
      lpSaveTimerRef.current = setTimeout(() => {
        saveLowPower(payload);
      }, 800);
    },
    [saveLowPower],
  );

  // ===========================================================================
  // Scheduled Reboot handlers
  // ===========================================================================

  const handleRebootEnabledChange = async (checked: boolean) => {
    setRebootEnabled(checked);
    if (rebootSaveTimerRef.current) {
      clearTimeout(rebootSaveTimerRef.current);
      rebootSaveTimerRef.current = null;
    }
    const success = await saveScheduledReboot({
      action: "save_scheduled_reboot",
      enabled: checked,
      time: rebootTime,
      days: rebootDays,
    });
    if (!success) {
      setRebootEnabled(!checked);
      toast.warning("Failed to update reboot schedule");
    }
  };

  const handleRebootTimeChange = (value: string) => {
    setRebootTime(value);
    if (rebootEnabled) {
      debouncedRebootSave({
        action: "save_scheduled_reboot",
        enabled: rebootEnabled,
        time: value,
        days: rebootDays,
      });
    }
  };

  const handleRebootDayToggle = (dayIndex: number) => {
    const newDays = rebootDays.includes(dayIndex)
      ? rebootDays.filter((d) => d !== dayIndex)
      : [...rebootDays, dayIndex].sort();

    setRebootDays(newDays);
    if (rebootEnabled) {
      debouncedRebootSave({
        action: "save_scheduled_reboot",
        enabled: rebootEnabled,
        time: rebootTime,
        days: newDays,
      });
    }
  };

  // ===========================================================================
  // Low Power Mode handlers
  // ===========================================================================

  const handleLpEnabledChange = async (checked: boolean) => {
    setLpEnabled(checked);
    if (lpSaveTimerRef.current) {
      clearTimeout(lpSaveTimerRef.current);
      lpSaveTimerRef.current = null;
    }
    const success = await saveLowPower({
      action: "save_low_power",
      enabled: checked,
      start_time: lpStartTime,
      end_time: lpEndTime,
      days: lpDays,
    });
    if (!success) {
      setLpEnabled(!checked);
      toast.warning("Failed to update low power schedule");
    }
  };

  const handleLpStartTimeChange = (value: string) => {
    setLpStartTime(value);
    if (lpEnabled) {
      debouncedLpSave({
        action: "save_low_power",
        enabled: lpEnabled,
        start_time: value,
        end_time: lpEndTime,
        days: lpDays,
      });
    }
  };

  const handleLpEndTimeChange = (value: string) => {
    setLpEndTime(value);
    if (lpEnabled) {
      debouncedLpSave({
        action: "save_low_power",
        enabled: lpEnabled,
        start_time: lpStartTime,
        end_time: value,
        days: lpDays,
      });
    }
  };

  const handleLpDayToggle = (dayIndex: number) => {
    const newDays = lpDays.includes(dayIndex)
      ? lpDays.filter((d) => d !== dayIndex)
      : [...lpDays, dayIndex].sort();

    setLpDays(newDays);
    if (lpEnabled) {
      debouncedLpSave({
        action: "save_low_power",
        enabled: lpEnabled,
        start_time: lpStartTime,
        end_time: lpEndTime,
        days: newDays,
      });
    }
  };

  // ===========================================================================
  // Render
  // ===========================================================================

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Scheduled Operations</CardTitle>
          <CardDescription>
            Set up automated system tasks on a schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-36" />
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
            <Separator />
            <Skeleton className="h-9 w-full" />
            <Separator className="my-4" />
            <Skeleton className="h-5 w-32" />
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-8 w-32" />
            </div>
            <Separator />
            <Skeleton className="h-9 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !scheduledReboot && !lowPower) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Scheduled Operations</CardTitle>
          <CardDescription>
            Set up automated system tasks on a schedule.
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
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Scheduled Operations</CardTitle>
        <CardDescription>
          Set up automated system tasks on a schedule.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {/* ─── Section A: Scheduled Reboot ─────────────────────────────── */}
          <p className="font-semibold text-sm">Scheduled Reboot</p>
          <Separator />

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Enable Scheduled Reboot
            </p>
            <div className="flex items-center space-x-2">
              <Switch
                id="scheduled-reboot"
                checked={rebootEnabled}
                onCheckedChange={handleRebootEnabledChange}
              />
              <Label htmlFor="scheduled-reboot">
                {rebootEnabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>
          <Separator />

          {/* Reboot Time */}
          <div className="flex items-center justify-between mt-4">
            <Label className="font-semibold text-muted-foreground text-sm">
              Reboot Time
            </Label>
            <Input
              type="time"
              className="w-32 h-8"
              value={rebootTime}
              onChange={(e) => handleRebootTimeChange(e.target.value)}
            />
          </div>
          <Separator />

          {/* Repeat On (reboot) */}
          <fieldset className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            <legend className="font-semibold text-muted-foreground text-sm">
              Repeat On
            </legend>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Reboot days of the week"
            >
              {DAY_LABELS.map((day, index) => (
                <Toggle
                  aria-label={day}
                  key={day}
                  size="sm"
                  className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
                  variant="outline"
                  pressed={rebootDays.includes(index)}
                  onPressedChange={() => handleRebootDayToggle(index)}
                >
                  <CircleIcon />
                  {day}
                </Toggle>
              ))}
            </div>
          </fieldset>

          {/* ─── Visual break between sections ───────────────────────────── */}
          <Separator className="my-4" />

          {/* ─── Section B: Low Power Mode ───────────────────────────────── */}
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex"
                  aria-label="Low power mode info"
                >
                  <TbInfoCircleFilled className="size-5 text-info" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Disables the modem radio during the scheduled window.
                  Watchdog, email alerts, and network events are
                  automatically suspended for the duration.
                </p>
              </TooltipContent>
            </Tooltip>
            <p className="font-semibold text-sm">Low Power Mode</p>
          </div>
          <Separator />

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Enable Low Power Mode
            </p>
            <div className="flex items-center space-x-2">
              <Switch
                id="low-power-mode"
                checked={lpEnabled}
                onCheckedChange={handleLpEnabledChange}
              />
              <Label htmlFor="low-power-mode">
                {lpEnabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>
          <Separator />

          {/* Start Time */}
          <div className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                Start Time
              </Label>
              <Input
                type="time"
                className="w-32 h-8"
                value={lpStartTime}
                onChange={(e) => handleLpStartTimeChange(e.target.value)}
              />
            </div>

            {/* End Time */}
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                End Time
              </Label>
              <Input
                type="time"
                className="w-32 h-8"
                value={lpEndTime}
                onChange={(e) => handleLpEndTimeChange(e.target.value)}
              />
            </div>
          </div>
          <Separator />

          {/* Repeat On (low power) */}
          <fieldset className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            <legend className="font-semibold text-muted-foreground text-sm">
              Repeat On
            </legend>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Low power mode days of the week"
            >
              {DAY_LABELS.map((day, index) => (
                <Toggle
                  aria-label={day}
                  key={day}
                  size="sm"
                  className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
                  variant="outline"
                  pressed={lpDays.includes(index)}
                  onPressedChange={() => handleLpDayToggle(index)}
                >
                  <CircleIcon />
                  {day}
                </Toggle>
              ))}
            </div>
          </fieldset>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScheduledOperationsCard;

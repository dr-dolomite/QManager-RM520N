"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { TbInfoCircleFilled } from "react-icons/tb";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { CircleIcon } from "lucide-react";

import type {
  TowerLockConfig,
  TowerScheduleConfig,
  TowerScheduleSaveResult,
} from "@/types/tower-locking";
import { DAY_LABELS } from "@/types/tower-locking";

interface ScheduleTowerLockingProps {
  config: TowerLockConfig | null;
  onScheduleChange: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;
}

// Copy is hardcoded English to match this card (no useTranslation here) — do
// not introduce a lone i18n key into an otherwise-untranslated surface.
const SCHEDULE_ARM_REASONS: Record<string, string> = {
  unit_absent:
    "the scheduling service isn't installed on this device yet — update to the latest firmware to enable it",
};

function scheduleArmWarning(reason?: string): string {
  const detail = reason
    ? SCHEDULE_ARM_REASONS[reason] ?? reason
    : "reason unknown";
  return `Schedule saved, but it couldn't be armed on this device — ${detail}`;
}

const ScheduleTowerLockingComponent = ({
  config,
  onScheduleChange,
}: ScheduleTowerLockingProps) => {
  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  // Debounce timer ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from config (adjust state during render)
  const [prevSchedule, setPrevSchedule] = useState<TowerScheduleConfig | null>(null);
  if (config?.schedule && config.schedule !== prevSchedule) {
    setPrevSchedule(config.schedule);
    setEnabled(config.schedule.enabled);
    setStartTime(config.schedule.start_time);
    setEndTime(config.schedule.end_time);
    setDays(config.schedule.days);
  }

  // Debounced save — fires 800ms after last change
  const debouncedSave = useCallback(
    (schedule: TowerScheduleConfig) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(async () => {
        // Debounced saves only fire while the schedule is enabled, so intent is
        // always "armed". armed === false means it persisted but no live timer
        // was installed — warn honestly instead of a silent success.
        const result = await onScheduleChange(schedule);
        if (result.success && result.armed === false) {
          toast.warning(scheduleArmWarning(result.reason));
        }
      }, 800);
    },
    [onScheduleChange],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Toggle enable/disable — save immediately (not debounced)
  // Reverts local state if the backend rejects (e.g., no lock targets configured)
  const handleEnabledChange = async (checked: boolean) => {
    setEnabled(checked);
    // Cancel any pending debounced save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const result = await onScheduleChange({
      enabled: checked,
      start_time: startTime,
      end_time: endTime,
      days,
    });
    if (!result.success) {
      // Backend rejected — revert toggle
      setEnabled(!checked);
      toast.warning(
        "No lock targets configured"
      );
      return;
    }
    // Warn about arming only when turning the schedule ON — turning it OFF
    // disarms the timer by design, so armed === false is expected there.
    if (checked && result.armed === false) {
      toast.warning(scheduleArmWarning(result.reason));
    }
  };

  const handleStartTimeChange = (value: string) => {
    setStartTime(value);
    if (enabled) {
      debouncedSave({
        enabled,
        start_time: value,
        end_time: endTime,
        days,
      });
    }
  };

  const handleEndTimeChange = (value: string) => {
    setEndTime(value);
    if (enabled) {
      debouncedSave({
        enabled,
        start_time: startTime,
        end_time: value,
        days,
      });
    }
  };

  const handleDayToggle = (dayIndex: number) => {
    const newDays = days.includes(dayIndex)
      ? days.filter((d) => d !== dayIndex)
      : [...days, dayIndex].sort();

    setDays(newDays);
    if (enabled) {
      debouncedSave({
        enabled,
        start_time: startTime,
        end_time: endTime,
        days: newDays,
      });
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Schedule Tower Locking</CardTitle>
        <CardDescription>
          Set specific times to enable or disable tower locking.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="More info">
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Schedule tower locking to automatically enable or disable at
                    specified times.
                  </p>
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-muted-foreground text-sm">
                Enable Scheduled Locking
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="schedule-locking"
                checked={enabled}
                onCheckedChange={handleEnabledChange}
              />
              <Label htmlFor="schedule-locking">
                {enabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>
          <Separator />
          <div className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                Start Time
              </Label>
              <Input
                type="time"
                className="w-32 h-8"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-muted-foreground text-sm">
                End Time
              </Label>
              <Input
                type="time"
                className="w-32 h-8"
                value={endTime}
                onChange={(e) => handleEndTimeChange(e.target.value)}
              />
            </div>
          </div>
          <Separator />
          <fieldset className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            <legend className="font-semibold text-muted-foreground text-sm">
              Repeat On
            </legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
              {DAY_LABELS.map((day, index) => (
                <Toggle
                  aria-label={day}
                  key={day}
                  size="sm"
                  className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
                  variant="outline"
                  pressed={days.includes(index)}
                  onPressedChange={() => handleDayToggle(index)}
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

export default ScheduleTowerLockingComponent;

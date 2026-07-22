"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, type Variants } from "motion/react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon, CircleIcon } from "lucide-react";

import type {
  UseSystemSettingsReturn,
  SaveScheduledRebootPayload,
} from "@/hooks/use-system-settings";
import type { ScheduleConfig } from "@/types/system-settings";
import { DAY_LABELS } from "@/types/system-settings";

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

// Copy is hardcoded English to match this card (no useTranslation here) — do
// not introduce a lone i18n key into an otherwise-untranslated surface.
const REBOOT_ARM_REASONS: Record<string, string> = {
  unit_absent:
    "the scheduling service isn't installed on this device yet — update to the latest firmware to enable it",
};

function rebootArmWarning(reason?: string): string {
  const detail = reason
    ? REBOOT_ARM_REASONS[reason] ?? reason
    : "reason unknown";
  return `Reboot schedule saved, but it couldn't be armed on this device — ${detail}`;
}

type ScheduledOperationsCardProps = Pick<
  UseSystemSettingsReturn,
  | "scheduledReboot"
  | "isLoading"
  | "error"
  | "saveScheduledReboot"
>;

const ScheduledOperationsCard = ({
  scheduledReboot,
  isLoading,
  error,
  saveScheduledReboot,
}: ScheduledOperationsCardProps) => {
  // ─── Scheduled Reboot local state ──────────────────────────────────────────
  const [rebootEnabled, setRebootEnabled] = useState(false);
  const [rebootTime, setRebootTime] = useState("04:00");
  const [rebootDays, setRebootDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // ─── Debounce timer ref ───────────────────────────────────────────────────
  const rebootSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Sync from hook data (render-time, not useEffect) ──────────────────────
  const [prevReboot, setPrevReboot] = useState<ScheduleConfig | null>(null);
  if (scheduledReboot && scheduledReboot !== prevReboot) {
    setPrevReboot(scheduledReboot);
    setRebootEnabled(scheduledReboot.enabled);
    setRebootTime(scheduledReboot.time);
    setRebootDays(scheduledReboot.days);
  }

  // ─── Cleanup timer on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rebootSaveTimerRef.current) clearTimeout(rebootSaveTimerRef.current);
    };
  }, []);

  // ─── Debounced save helper ────────────────────────────────────────────────
  const debouncedRebootSave = useCallback(
    (payload: SaveScheduledRebootPayload) => {
      if (rebootSaveTimerRef.current) {
        clearTimeout(rebootSaveTimerRef.current);
      }
      rebootSaveTimerRef.current = setTimeout(async () => {
        const result = await saveScheduledReboot(payload);
        if (!result.success) {
          toast.error("Failed to save reboot schedule");
          return;
        }
        // Debounced saves only fire while the schedule is enabled, so the
        // user's intent is always "armed". armed === false means it persisted
        // but no live timer was installed — warn honestly instead of a green
        // success toast. Undefined armed (older backend) → assume armed.
        if (result.armed === false) {
          toast.warning(rebootArmWarning(result.reason));
        } else {
          toast.success("Reboot schedule saved");
        }
      }, 800);
    },
    [saveScheduledReboot],
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
    const result = await saveScheduledReboot({
      action: "save_scheduled_reboot",
      enabled: checked,
      time: rebootTime,
      days: rebootDays,
    });
    if (!result.success) {
      setRebootEnabled(!checked);
      toast.error("Failed to update reboot schedule");
      return;
    }
    // Only warn about arming when the user is turning the schedule ON. Turning
    // it OFF disarms the timer by design, so armed === false is expected there.
    if (checked && result.armed === false) {
      toast.warning(rebootArmWarning(result.reason));
    } else {
      toast.success(
        checked ? "Scheduled reboot enabled" : "Scheduled reboot disabled",
      );
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
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !scheduledReboot) {
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
        <motion.div
          className="grid gap-2"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ─── Section: Scheduled Reboot ─────────────────────────────── */}
          <motion.p variants={itemVariants} className="font-semibold text-sm">Scheduled Reboot</motion.p>
          <Separator />

          {/* Enable toggle */}
          <motion.div variants={itemVariants} className="flex items-center justify-between">
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
          </motion.div>
          <Separator />

          {/* Reboot Time */}
          <motion.div variants={itemVariants} className="flex items-center justify-between mt-4">
            <Label className="font-semibold text-muted-foreground text-sm">
              Reboot Time
            </Label>
            <Input
              type="time"
              className="w-32 h-8"
              value={rebootTime}
              onChange={(e) => handleRebootTimeChange(e.target.value)}
            />
          </motion.div>
          <Separator />

          {/* Repeat On */}
          <motion.fieldset variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
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
          </motion.fieldset>
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default ScheduledOperationsCard;

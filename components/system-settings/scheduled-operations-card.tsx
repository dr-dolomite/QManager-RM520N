"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ClockIcon,
  Loader2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSaveFlash } from "@/components/ui/save-button";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
  SaveScheduledRebootPayload,
  UseSystemSettingsReturn,
} from "@/hooks/use-system-settings";
import type { ScheduleConfig } from "@/types/system-settings";

import { ConditionBlock } from "./condition-block";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  CONDITION_PANEL,
  DAY_PILL,
  FIELD,
  FOCUS_RING,
  NOTICE,
  ROW,
  ROW_GROUP,
  SKELETON,
} from "./shapes";

const K = "reboot";

/** Index is the backend's day number (0=Sun). The label itself is translated. */
/** Index 0-6 = Sun-Sat, matching `ScheduleConfig.days`. The status band
    reads the same keys, so the two cannot ship rival weekday names. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// The autosave receipt's three layers share one grid cell, so the strip's width
// is max(idle, saving, saved) per locale and nothing reflows on a save.
const SAVE_LAYER =
  "col-start-1 row-start-1 flex items-center justify-end gap-1.5 text-on-surface-variant text-xs font-medium transition-opacity duration-[var(--duration-quick)] ease-out";

type ScheduledRebootCardProps = Pick<
  UseSystemSettingsReturn,
  "scheduledReboot" | "isLoading" | "error" | "saveScheduledReboot" | "refresh"
>;

const ScheduledRebootCard = ({
  scheduledReboot,
  isLoading,
  error,
  saveScheduledReboot,
  refresh,
}: ScheduledRebootCardProps) => {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  // No day is armed until the device says one is — a seeded week would be a
  // schedule the user never chose, and the switch below POSTs whatever is here.
  const [rebootEnabled, setRebootEnabled] = useState(false);
  const [rebootTime, setRebootTime] = useState("04:00");
  const [rebootDays, setRebootDays] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const rebootSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server value at render time, never copied in by an effect, and compared by
  // IDENTITY: a truthy guard leaves a read that carried no schedule on screen.
  const [prevReboot, setPrevReboot] = useState<ScheduleConfig | null>(null);
  if (scheduledReboot !== prevReboot) {
    setPrevReboot(scheduledReboot);
    setRebootEnabled(scheduledReboot?.enabled ?? false);
    setRebootTime(scheduledReboot?.time ?? "04:00");
    setRebootDays(scheduledReboot?.days ?? []);
  }

  useEffect(() => {
    return () => {
      if (rebootSaveTimerRef.current) clearTimeout(rebootSaveTimerRef.current);
    };
  }, []);

  const armWarning = useCallback(
    (reason?: string) => {
      const detail = reason
        ? t(`${K}.toast.reasons.${reason}`, { defaultValue: reason })
        : t(`${K}.toast.reason_unknown`);
      return t(`${K}.toast.not_armed`, { detail });
    },
    [t],
  );

  const debouncedRebootSave = useCallback(
    (payload: SaveScheduledRebootPayload) => {
      if (rebootSaveTimerRef.current) {
        clearTimeout(rebootSaveTimerRef.current);
      }
      rebootSaveTimerRef.current = setTimeout(async () => {
        setIsSaving(true);
        let result;
        try {
          result = await saveScheduledReboot(payload);
        } finally {
          setIsSaving(false);
        }
        if (!result.success) {
          toast.error(t(`${K}.toast.save_failed`));
          return;
        }
        markSaved();
        // Debounced saves only fire while the schedule is enabled, so the
        // user's intent is always "armed". armed === false means it persisted
        // but no live timer was installed — warn honestly instead of a green
        // success toast. Undefined armed (older backend) → assume armed.
        if (result.armed === false) {
          toast.warning(armWarning(result.reason));
        } else {
          toast.success(t(`${K}.toast.saved`));
        }
      }, 800);
    },
    [saveScheduledReboot, markSaved, armWarning, t],
  );

  const handleRebootEnabledChange = async (checked: boolean) => {
    setRebootEnabled(checked);
    if (rebootSaveTimerRef.current) {
      clearTimeout(rebootSaveTimerRef.current);
      rebootSaveTimerRef.current = null;
    }
    setIsSaving(true);
    let result;
    try {
      result = await saveScheduledReboot({
        action: "save_scheduled_reboot",
        enabled: checked,
        time: rebootTime,
        days: rebootDays,
      });
    } finally {
      setIsSaving(false);
    }
    if (!result.success) {
      setRebootEnabled(!checked);
      toast.error(t(`${K}.toast.update_failed`));
      return;
    }
    markSaved();
    // Only warn about arming when the user is turning the schedule ON. Turning
    // it OFF disarms the timer by design, so armed === false is expected there.
    if (checked && result.armed === false) {
      toast.warning(armWarning(result.reason));
    } else {
      toast.success(t(checked ? `${K}.toast.enabled` : `${K}.toast.disabled`));
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

  const head = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.card.description`)}
      </CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {head}
        <CardContent
          className={cn(CARD_PAD, CONDITION_PANEL.CONTENT, "gap-3.5")}
        >
          {/* The skeleton wears the real row boxes, so its height RESOLVES to
              the loaded view's rather than being asserted against a floor. */}
          <div className={cn(ROW_GROUP, "min-h-0 flex-1")}>
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.REBOOT.LABEL, "w-40")} />
                <Skeleton
                  className={cn(SKELETON.REBOOT.CONSEQUENCE, "w-full")}
                />
                <Skeleton
                  className={cn(SKELETON.REBOOT.CONSEQUENCE_2, "w-3/4")}
                />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className={SKELETON.REBOOT.SWITCH} />
              </div>
            </div>
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.REBOOT.LABEL, "w-20")} />
                <Skeleton className={cn(SKELETON.REBOOT.CONSEQUENCE, "w-3/5")} />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className={SKELETON.REBOOT.FIELD} />
              </div>
            </div>
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.REBOOT.LABEL, "w-24")} />
                <Skeleton className={cn(SKELETON.REBOOT.CONSEQUENCE, "w-4/5")} />
              </div>
              <div className={cn(ROW.CONTROL, "w-full @2xl/card:w-auto")}>
                <div className={cn(DAY_PILL.RAIL, "w-full")}>
                  {DAY_KEYS.map((key) => (
                    <Skeleton key={key} className={SKELETON.REBOOT.DAY} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* The autosave receipt strip. Absent, the card grows by the strip
              and its gap the moment the data lands. */}
          <div className="flex justify-end px-1">
            <Skeleton className={SKELETON.REBOOT.RECEIPT} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // No schedule to show — a failed read, or an envelope carrying none. The form
  // must not render: its fields would be defaults, and the switch would arm them.
  if (!scheduledReboot) {
    return (
      <Card className={CARD_SHELL}>
        {head}
        <CardContent className={cn(CARD_PAD, CONDITION_PANEL.CONTENT)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.states.error.title`)}
            description={t(`${K}.states.error.description`)}
            onRetry={() => refresh()}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      {head}
      <CardContent className={cn(CARD_PAD, CONDITION_PANEL.CONTENT, "gap-3.5")}>
        {/* A refresh failed but a schedule is still cached: non-blocking, so
            the card stays usable. */}
        {error ? (
          <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.states.stale`)}</span>
          </div>
        ) : null}

        <motion.div
          variants={staggerRows}
          className={cn(ROW_GROUP, "min-h-0 flex-1")}
        >
          {/* Row 1 — the switch the whole card hangs off. */}
          <motion.div variants={staggerRowItem} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <div className="flex items-center gap-2">
                <label htmlFor="scheduled-reboot" className={ROW.LABEL}>
                  {t(`${K}.rows.enabled.label`)}
                </label>
                {!rebootEnabled ? (
                  <Badge variant="muted">
                    <MinusCircleIcon className="size-3" aria-hidden="true" />
                    {t(`${K}.rows.enabled.off`)}
                  </Badge>
                ) : rebootDays.length === 0 ? (
                  <Badge variant="warning">
                    <TriangleAlertIcon className="size-3" aria-hidden="true" />
                    {t(`${K}.rows.enabled.no_day`)}
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <CheckCircle2Icon className="size-3" aria-hidden="true" />
                    {t(`${K}.rows.enabled.armed`)}
                  </Badge>
                )}
              </div>
              <span className={ROW.CONSEQUENCE}>
                {t(`${K}.rows.enabled.consequence`)}
              </span>
            </div>
            <div className={ROW.CONTROL}>
              <Switch
                id="scheduled-reboot"
                checked={rebootEnabled}
                onCheckedChange={handleRebootEnabledChange}
                className={COARSE_TARGET}
              />
            </div>
          </motion.div>

          {/* Row 2 — the clock the device reads, not the browser's. */}
          <motion.div variants={staggerRowItem} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <label htmlFor="scheduled-reboot-time" className={ROW.LABEL}>
                {t(`${K}.rows.time.label`)}
              </label>
              <span className={ROW.CONSEQUENCE}>
                {t(`${K}.rows.time.consequence`)}
              </span>
            </div>
            <div className={ROW.CONTROL}>
              <Input
                id="scheduled-reboot-time"
                type="time"
                className={FIELD}
                value={rebootTime}
                onChange={(e) => handleRebootTimeChange(e.target.value)}
              />
            </div>
          </motion.div>

          {/* Row 3 — the day rail. Fill carries selection; there is no glyph
              because the fill already says it. */}
          <motion.div variants={staggerRowItem} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <span className={ROW.LABEL}>{t(`${K}.rows.days.label`)}</span>
              <span className={ROW.CONSEQUENCE}>
                {t(`${K}.rows.days.consequence`)}
              </span>
            </div>
            {/* The rail stretches while the row is stacked so its seven pills
                divide a real width; side by side it sizes to content. */}
            <div className={cn(ROW.CONTROL, "w-full @2xl/card:w-auto")}>
              <div
                className={cn(DAY_PILL.RAIL, "w-full")}
                role="group"
                aria-label={t(`${K}.rows.days.rail`)}
              >
                {DAY_KEYS.map((key, index) => {
                  const selected = rebootDays.includes(index);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={t(`${K}.days.${key}`)}
                      aria-pressed={selected}
                      onClick={() => handleRebootDayToggle(index)}
                      className={cn(
                        DAY_PILL.ROOT,
                        selected ? DAY_PILL.ON : DAY_PILL.OFF,
                        FOCUS_RING,
                      )}
                    >
                      {t(`${K}.days.${key}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* The autosave receipt. Announcing the result is the toast's job, so
            the strip itself is decorative. */}
        <div className="flex justify-end px-1" aria-hidden="true">
          <span className="grid">
            <span
              className={cn(
                SAVE_LAYER,
                isSaving || saved ? "opacity-0" : "opacity-100",
              )}
            >
              <ClockIcon className="size-3.5" />
              {t(`${K}.states.autosave`)}
            </span>
            <span
              className={cn(SAVE_LAYER, isSaving ? "opacity-100" : "opacity-0")}
            >
              <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
              {t(`${K}.states.saving`)}
            </span>
            <span className={cn(SAVE_LAYER, saved ? "opacity-100" : "opacity-0")}>
              <CheckCircle2Icon className="size-3.5" />
              {t(`${K}.states.saved`)}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScheduledRebootCard;

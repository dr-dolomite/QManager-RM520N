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
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  CONDITION_PANEL,
  DAY_PILL,
  FIELD,
  FOCUS_RING,
  GROUP_FILL,
  LABEL_LINE,
  NOTICE,
  RECEIPT_ROW,
  ROW,
  ROW_GROUP,
  SAVE_LAYER,
  SKELETON,
} from "./shapes";

const K = "reboot";

/** Index is the backend's day number (0=Sun). The label itself is translated. */
/** Index 0-6 = Sun-Sat, matching `ScheduleConfig.days`. The status band
    reads the same keys, so the two cannot ship rival weekday names. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The sr-only line that says this card saves without a Save button. */
const AUTOSAVE_HINT_ID = "reboot-autosave-hint";

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
  // Only the newest save may lift `savePending`; an older one settling under a
  // queued edit must leave the latch armed.
  const saveSeqRef = useRef(0);
  const [savePending, setSavePending] = useState(false);

  // A save runs long after the render that scheduled it, so it reads the server
  // value and the translator from here rather than from a stale closure.
  const latestRef = useRef({ server: scheduledReboot, t });
  useEffect(() => {
    latestRef.current = { server: scheduledReboot, t };
  });

  // Server value at render time, never copied in by an effect, and compared by
  // IDENTITY: a truthy guard leaves a read that carried no schedule on screen.
  // Held off while a save is queued or in flight, or a refresh landing inside
  // the debounce window would overwrite the very edit being saved.
  const [prevReboot, setPrevReboot] = useState<ScheduleConfig | null>(null);
  if (!savePending && scheduledReboot !== prevReboot) {
    setPrevReboot(scheduledReboot);
    setRebootEnabled(scheduledReboot?.enabled ?? false);
    setRebootTime(scheduledReboot?.time ?? "04:00");
    setRebootDays(scheduledReboot?.days ?? []);
  }

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (!rebootSaveTimerRef.current) return;
      // The card promises it saves on its own, so a dropped edit must say so.
      clearTimeout(rebootSaveTimerRef.current);
      toast.warning(latestRef.current.t(`${K}.toast.unsaved`));
    };
  }, []);

  const armWarning = useCallback(
    (reason?: string) => {
      // An unmapped backend reason would splice a raw token into a translated
      // sentence, so it goes to the console and the user gets the generic line.
      const mapped = reason
        ? t(`${K}.toast.reasons.${reason}`, { defaultValue: "" })
        : "";
      if (reason && !mapped) {
        console.warn(`[system-settings] unmapped reboot arm reason: ${reason}`);
      }
      return t(`${K}.toast.not_armed`, {
        detail: mapped || t(`${K}.toast.reason_unknown`),
      });
    },
    [t],
  );

  const rejectionToast = useCallback(
    (fallbackKey: string, rejection?: string, detail?: string) => {
      const mapped = rejection
        ? t(`${K}.toast.rejected.${rejection}`, { defaultValue: "" })
        : "";
      if (rejection && !mapped) {
        console.warn(`[system-settings] unmapped reboot rejection: ${rejection}`);
      }
      if (mapped) {
        toast.error(mapped);
        return;
      }
      // Unmapped: generic translated line, with the device's own words quoted
      // beneath it rather than thrown away.
      toast.error(t(fallbackKey), { description: detail || undefined });
    },
    [t],
  );

  const debouncedRebootSave = useCallback(
    (payload: SaveScheduledRebootPayload) => {
      if (rebootSaveTimerRef.current) {
        clearTimeout(rebootSaveTimerRef.current);
      }
      const seq = ++saveSeqRef.current;
      setSavePending(true);
      rebootSaveTimerRef.current = setTimeout(async () => {
        // Cleared before the await so unmounting mid-flight does not warn about
        // a request that is already on the wire.
        rebootSaveTimerRef.current = null;
        setIsSaving(true);
        let result;
        try {
          result = await saveScheduledReboot(payload);
        } finally {
          setIsSaving(false);
          if (saveSeqRef.current === seq) setSavePending(false);
        }
        // Unmounted mid-flight: the request is on the wire, but the hook stops
        // reporting its result, so narrate nothing rather than claim a failure.
        if (!isMountedRef.current) return;
        if (!result.success) {
          // Revert to the server's values so the rail stops disagreeing with the
          // band, but not when a newer edit is already queued to replace them.
          if (saveSeqRef.current === seq) {
            const server = latestRef.current.server;
            setRebootDays(server?.days ?? []);
            setRebootTime(server?.time ?? "04:00");
          }
          rejectionToast(`${K}.toast.save_failed`, result.rejection, result.rejectionDetail);
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
    [saveScheduledReboot, markSaved, armWarning, rejectionToast, t],
  );

  const handleRebootEnabledChange = async (checked: boolean) => {
    setRebootEnabled(checked);
    if (rebootSaveTimerRef.current) {
      clearTimeout(rebootSaveTimerRef.current);
      rebootSaveTimerRef.current = null;
    }
    const seq = ++saveSeqRef.current;
    setSavePending(true);
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
      if (saveSeqRef.current === seq) setSavePending(false);
    }
    if (!isMountedRef.current) return;
    if (!result.success) {
      // Only the newest toggle may restore the switch; an older one settling
      // late would flip it against a server a newer save already changed.
      if (saveSeqRef.current === seq) setRebootEnabled(!checked);
      rejectionToast(`${K}.toast.update_failed`, result.rejection, result.rejectionDetail);
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
        <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-3.5")}>
          {/* The skeleton wears the real row boxes, so its height RESOLVES to
              the loaded view's rather than being asserted against a floor. */}
          <div className={cn(ROW_GROUP, GROUP_FILL)}>
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
            <div className={ROW.RAIL_ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.REBOOT.LABEL, "w-24")} />
                <Skeleton className={cn(SKELETON.REBOOT.CONSEQUENCE, "w-4/5")} />
              </div>
              <div className={DAY_PILL.RAIL}>
                {DAY_KEYS.map((key) => (
                  <Skeleton key={key} className={SKELETON.REBOOT.DAY} />
                ))}
              </div>
            </div>
          </div>
          {/* The autosave receipt strip. Absent, the card grows by the strip
              and its gap the moment the data lands. */}
          <div className={RECEIPT_ROW}>
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
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
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
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-3.5")}>
        {/* A refresh failed but a schedule is still cached: non-blocking, so
            the card stays usable. */}
        {error ? (
          <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.states.stale`)}</span>
          </div>
        ) : null}

        {/* Nothing else tells AT that this card autosaves — there is no Save
            button, and the receipt strip that says so on screen is decorative. */}
        <span id={AUTOSAVE_HINT_ID} className="sr-only">
          {t(`${K}.states.autosave`)}
        </span>

        <motion.div
          variants={staggerRows}
          className={cn(ROW_GROUP, GROUP_FILL)}
        >
          {/* Row 1 — the switch the whole card hangs off. */}
          <motion.div variants={staggerRowItem} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <div className={LABEL_LINE}>
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
                aria-describedby={AUTOSAVE_HINT_ID}
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
              because the fill already says it. The rail spans the row at every
              width: `auto-fit` counts its columns against a definite one, or
              collapses to a single track. */}
          <motion.div variants={staggerRowItem} className={ROW.RAIL_ROOT}>
            <div className={ROW.TEXT}>
              <span className={ROW.LABEL}>{t(`${K}.rows.days.label`)}</span>
              <span className={ROW.CONSEQUENCE}>
                {t(`${K}.rows.days.consequence`)}
              </span>
            </div>
            <div
              className={DAY_PILL.RAIL}
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
          </motion.div>
        </motion.div>

        {/* The autosave receipt. Announcing the result is the toast's job, so
            the strip itself is decorative. */}
        <div className={RECEIPT_ROW} aria-hidden="true">
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

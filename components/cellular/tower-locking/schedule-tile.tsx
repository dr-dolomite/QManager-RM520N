"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import type {
  TowerLockConfig,
  TowerScheduleConfig,
  TowerScheduleSaveResult,
} from "@/types/tower-locking";

import {
  AUTO_TILE,
  DAY_CHIP,
  FIELD_CONTROL,
  FIELD_LABEL,
  NOTICE,
  NOTICE_TONE,
  dayChipFill,
  discTone,
} from "./shapes";

// =============================================================================
// ScheduleTile — apply the tower lock only inside a daily window
// =============================================================================
// Enabling saves at once (reverts if refused); time/day edits debounce 800 ms and save only while enabled. A save
// that could not arm its systemd timers warns. Config sync is value-keyed so a re-read keeps an in-progress edit.
// =============================================================================

const K = "tower_locking";

export interface ScheduleTileProps {
  config: TowerLockConfig | null;
  onScheduleChange: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;
}

const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6] as const;

/** Literal keys: `i18n:check` cannot see an interpolated stem. */
const DAY_LABEL_KEYS = [
  `${K}.schedule.day_0`,
  `${K}.schedule.day_1`,
  `${K}.schedule.day_2`,
  `${K}.schedule.day_3`,
  `${K}.schedule.day_4`,
  `${K}.schedule.day_5`,
  `${K}.schedule.day_6`,
] as const;

const SAVE_DEBOUNCE_MS = 800;

function scheduleKey(s: TowerScheduleConfig | undefined): string {
  if (!s) return "";
  return `${s.enabled}|${s.start_time}|${s.end_time}|${[...s.days].sort().join(",")}`;
}

export function ScheduleTile({ config, onScheduleChange }: ScheduleTileProps) {
  const { t } = useTranslation("cellular");

  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [isSaving, setIsSaving] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Adopt the saved schedule whenever its VALUE changes.
  const incomingKey = scheduleKey(config?.schedule);
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (config?.schedule && incomingKey !== prevKey) {
    setPrevKey(incomingKey);
    setEnabled(config.schedule.enabled);
    setStartTime(config.schedule.start_time);
    setEndTime(config.schedule.end_time);
    setDays(config.schedule.days);
  }

  // A save that landed but left no live timer warns in place of the success.
  const unarmedMessage = useCallback(
    (result: TowerScheduleSaveResult): string | null => {
      if (result.armed !== false) return null;
      const reason =
        result.reason === "unit_absent"
          ? t(`${K}.schedule.arm_reason_unit_absent`)
          : t(`${K}.schedule.arm_reason_unknown`);
      return t(`${K}.schedule.arm_warning`, { reason });
    },
    [t],
  );

  const debouncedSave = useCallback(
    (schedule: TowerScheduleConfig) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        setIsSaving(true);
        try {
          const result = await onScheduleChange(schedule);
          if (!mountedRef.current) return;
          const unarmed = result.ok ? unarmedMessage(result) : null;
          if (unarmed) {
            toast.warning(unarmed);
          } else if (result.ok) {
            toast.success(t(`${K}.schedule.toast_saved`));
          } else {
            toast.error(result.error ?? t(`${K}.errors.schedule_failed`));
          }
        } finally {
          if (mountedRef.current) setIsSaving(false);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [onScheduleChange, t, unarmedMessage],
  );

  const handleEnabledChange = async (next: boolean) => {
    if (next === enabled) return;
    setEnabled(next);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setIsSaving(true);
    try {
      const result = await onScheduleChange({
        enabled: next,
        start_time: startTime,
        end_time: endTime,
        days,
      });
      if (!mountedRef.current) return;
      // Turning it off disarms by design, so only the ON path can be unarmed.
      const unarmed = result.ok && next ? unarmedMessage(result) : null;
      if (unarmed) {
        toast.warning(unarmed);
      } else if (result.ok) {
        toast.success(
          next
            ? t(`${K}.schedule.toast_enabled`)
            : t(`${K}.schedule.toast_disabled`),
        );
      } else {
        // The backend refused (no lock target, no days): the pill snaps back.
        setEnabled(!next);
        toast.error(result.error ?? t(`${K}.errors.schedule_failed`));
      }
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const commit = (next: Partial<TowerScheduleConfig>) => {
    const schedule: TowerScheduleConfig = {
      enabled,
      start_time: startTime,
      end_time: endTime,
      days,
      ...next,
    };
    // A schedule with no days cannot be saved; the notice below says why.
    if (enabled && schedule.days.length > 0) debouncedSave(schedule);
  };

  const handleDayToggle = (dayIndex: number) => {
    const nextDays = days.includes(dayIndex)
      ? days.filter((d) => d !== dayIndex)
      : [...days, dayIndex].sort((a, b) => a - b);
    setDays(nextDays);
    commit({ days: nextDays });
  };

  const noDays = enabled && days.length === 0;
  const scheduleLabel = enabled
    ? t(`${K}.schedule.status_active`)
    : t(`${K}.schedule.status_inactive`);

  return (
    <div className={`${AUTO_TILE.ROOT} h-full`}>
      <div className={AUTO_TILE.HEAD}>
        <span
          role="img"
          aria-label={scheduleLabel}
          title={scheduleLabel}
          className={`${AUTO_TILE.DISC} ${discTone(enabled ? "success" : "muted")}`}
        >
          <MaterialSymbol name="schedule" size={20} aria-hidden="true" />
        </span>
        <span className={AUTO_TILE.TITLE}>{t(`${K}.schedule.title`)}</span>
        {isSaving ? (
          <MaterialSymbol
            name="progress_activity"
            size={16}
            className="text-on-surface-variant motion-safe:animate-spin"
          />
        ) : null}
        <div
          className="ml-auto"
          role="group"
          {...(noDays ? { "aria-describedby": "tower-schedule-no-days" } : null)}
        >
          <SegmentedField
            value={enabled ? "on" : "off"}
            onValueChange={(v) => void handleEnabledChange(v === "on")}
            options={[
              { value: "off", label: t("state.off", { ns: "common" }) },
              { value: "on", label: t("state.on", { ns: "common" }) },
            ]}
            ariaLabel={t(`${K}.schedule.enable_label`)}
            disabled={isSaving}
            breakpoint="never"
            glyph={(className) => (
              <MaterialSymbol
                name="check"
                size={16}
                className={className}
                aria-hidden="true"
              />
            )}
          />
        </div>
      </div>

      {/* Stacks on a phone: a 12-hour time input clips at half of ~290px. */}
      <div className="grid grid-cols-1 gap-3 @xs/section:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tower-schedule-start" className={FIELD_LABEL}>
            {t(`${K}.schedule.start`)}
          </label>
          <Input
            id="tower-schedule-start"
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              commit({ start_time: e.target.value });
            }}
            host="container"
            className={FIELD_CONTROL}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tower-schedule-end" className={FIELD_LABEL}>
            {t(`${K}.schedule.end`)}
          </label>
          <Input
            id="tower-schedule-end"
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              commit({ end_time: e.target.value });
            }}
            host="container"
            className={FIELD_CONTROL}
          />
        </div>
      </div>

      <fieldset className={`${AUTO_TILE.FOOT} flex flex-col gap-1.5`}>
        <legend className={`${FIELD_LABEL} mb-3`}>
          {t(`${K}.schedule.days`)}
        </legend>
        <div
          className={DAY_CHIP.ROW}
          role="group"
          aria-label={t(`${K}.schedule.days_a11y`)}
        >
          {DAY_INDICES.map((index) => {
            const selected = days.includes(index);
            const label = t(DAY_LABEL_KEYS[index]);
            return (
              <button
                key={index}
                type="button"
                aria-pressed={selected}
                aria-label={
                  selected
                    ? t(`${K}.schedule.day_selected`, { day: label })
                    : t(`${K}.schedule.day_unselected`, { day: label })
                }
                onClick={() => handleDayToggle(index)}
                className={`${DAY_CHIP.ROOT} ${dayChipFill(selected)}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {noDays ? (
        <div
          role="alert"
          className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.fill} text-xs`}
        >
          <span
            aria-hidden="true"
            className={`${NOTICE.DISC} ${NOTICE_TONE.warning.disc}`}
          >
            <MaterialSymbol name={NOTICE_TONE.warning.glyph} size={16} />
          </span>
          <span
            id="tower-schedule-no-days"
            className="min-w-0 flex-1 leading-relaxed"
          >
            {t(`${K}.schedule.no_days`)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default ScheduleTile;

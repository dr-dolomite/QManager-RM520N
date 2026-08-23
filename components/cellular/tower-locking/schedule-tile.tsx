"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Switch } from "@/components/ui/switch";
import type {
  TowerLockConfig,
  TowerScheduleConfig,
  TowerScheduleSaveResult,
} from "@/types/tower-locking";

import {
  AUTO_TILE,
  BADGE_GLYPH_SIZE,
  DAY_CHIP,
  FIELD_CONTROL_ON_CONTAINER,
  FIELD_LABEL,
  NOTICE,
  NOTICE_TONE,
  SWITCH_TARGET,
  dayChipFill,
} from "./shapes";

// =============================================================================
// ScheduleTile — apply the tower lock only inside a daily window
// =============================================================================
// One of the three tiles in the automation card. It was a peer CARD in a 2-up
// grid until this change, which is what made it read as disconnected: it sat as
// the orphaned third cell beside empty space, at the same visual rank as the two
// lock forms, while actually answering a different question from either of them.
// It is not a third way to choose a cell — it is one of three answers to "what
// happens to this lock when nobody is watching".
//
// It writes `config.schedule`, which the backend turns into TWO runtime systemd
// timers (apply + clear) rather than a `systemctl enable` — so a save can
// legitimately succeed at the config layer and still not arm, which is what
// `armed: false` reports and what this tile has to say out loud.
//
// -----------------------------------------------------------------------------
// THREE SAVE PATHS, DELIBERATELY DIFFERENT
// -----------------------------------------------------------------------------
//   ENABLE TOGGLE   immediate, and REVERTS the switch if the backend refuses.
//                   The most common refusal is "no lock target configured",
//                   which is a real precondition rather than an error.
//   TIME / DAY EDIT 800ms debounce, and ONLY while enabled — editing a window
//                   on a disabled schedule writes nothing, because there is no
//                   timer to re-arm.
//   ARM RESULT      a save that returns `{success: true, armed: false}` warns.
//                   Not on the OFF path: disarming is what turning it off means.
//
// -----------------------------------------------------------------------------
// THE DAY CHIPS
// -----------------------------------------------------------------------------
// The incumbent drew these as `Toggle variant="outline"` whose pressed state was
// an arbitrary-child selector painting a dot `bg-blue-500` — a raw Tailwind
// palette value in an OKLCH-only system, the one colour on the page that was
// byte-identical in light and dark. They are now real `aria-pressed` buttons on
// the shared `DAY_CHIP` construction, where the FILL carries selection.
// =============================================================================

export interface ScheduleTileProps {
  config: TowerLockConfig | null;
  onScheduleChange: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;
}

const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * A value key for the config-sync comparison.
 *
 * `config` is re-parsed from JSON on every fetch, so `config.schedule` is a NEW
 * object each time even when nothing changed. The incumbent compared object
 * identity, so every poll re-seeded the form and wiped whatever the user was
 * mid-way through typing.
 */
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

  // --- Config sync (render-time adjustment, keyed on VALUE not identity) ------
  const incomingKey = scheduleKey(config?.schedule);
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (config?.schedule && incomingKey !== prevKey) {
    setPrevKey(incomingKey);
    setEnabled(config.schedule.enabled);
    setStartTime(config.schedule.start_time);
    setEndTime(config.schedule.end_time);
    setDays(config.schedule.days);
  }

  /** Map an `armed: false` reason onto translated copy. */
  const armReason = useCallback(
    (reason?: string): string =>
      reason === "unit_absent"
        ? t("tower_locking.schedule.arm_reason_unit_absent")
        : (reason ?? t("tower_locking.schedule.arm_reason_unknown")),
    [t],
  );

  const warnIfUnarmed = useCallback(
    (result: TowerScheduleSaveResult) => {
      if (result.success && result.armed === false) {
        toast.warning(
          t("tower_locking.schedule.arm_warning", {
            reason: armReason(result.reason),
          }),
        );
      }
    },
    [armReason, t],
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
          if (!result.success) {
            toast.error(t("tower_locking.schedule.toast_error"));
            return;
          }
          warnIfUnarmed(result);
        } finally {
          if (mountedRef.current) setIsSaving(false);
        }
      }, 800);
    },
    [onScheduleChange, t, warnIfUnarmed],
  );

  const handleEnabledChange = async (checked: boolean) => {
    setEnabled(checked);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setIsSaving(true);
    try {
      const result = await onScheduleChange({
        enabled: checked,
        start_time: startTime,
        end_time: endTime,
        days,
      });
      if (!mountedRef.current) return;
      if (!result.success) {
        // Revert — the switch must never claim a state the backend refused.
        setEnabled(!checked);
        // The incumbent hardcoded "No lock targets configured" for EVERY
        // failure. That reason is only right when it is actually the reason.
        toast.warning(
          result.reason === "no_targets"
            ? t("tower_locking.schedule.toast_no_targets")
            : t("tower_locking.schedule.toast_error"),
        );
        return;
      }
      // Only warn on the ON path — turning it off disarms by design.
      if (checked) warnIfUnarmed(result);
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
    if (enabled) debouncedSave(schedule);
  };

  const handleDayToggle = (dayIndex: number) => {
    const nextDays = days.includes(dayIndex)
      ? days.filter((d) => d !== dayIndex)
      : [...days, dayIndex].sort((a, b) => a - b);
    setDays(nextDays);
    commit({ days: nextDays });
  };

  const status = enabled
    ? ({ variant: "success", glyph: "check_circle" } as const)
    : ({ variant: "muted", glyph: "do_not_disturb_on" } as const);
  const statusLabel = enabled
    ? t("tower_locking.schedule.status_active")
    : t("tower_locking.schedule.status_inactive");

  /** Enabled with no days selected can never fire. Worth saying. */
  const noDays = enabled && days.length === 0;

  return (
    <div className={`${AUTO_TILE.ROOT} h-full`}>
      <div className={AUTO_TILE.HEAD}>
        <span className={AUTO_TILE.DISC} aria-hidden="true">
          <MaterialSymbol name="schedule" size={20} />
        </span>
        <span className={AUTO_TILE.TITLE}>
          {t("tower_locking.schedule.title")}
        </span>
        {isSaving ? (
          <MaterialSymbol
            name="progress_activity"
            size={16}
            className="text-on-surface-variant animate-spin motion-reduce:animate-none"
          />
        ) : null}
        <Badge variant={status.variant}>
          <MaterialSymbol name={status.glyph} size={BADGE_GLYPH_SIZE} />
          {statusLabel}
        </Badge>
        <Switch
          id="tower-schedule-enabled"
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          aria-label={t("tower_locking.schedule.enable_label")}
          {...(noDays
            ? { "aria-describedby": "tower-schedule-no-days" }
            : null)}
          className={`${SWITCH_TARGET} ml-auto`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tower-schedule-start" className={FIELD_LABEL}>
            {t("tower_locking.schedule.start")}
          </label>
          <Input
            id="tower-schedule-start"
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              commit({ start_time: e.target.value });
            }}
            className={FIELD_CONTROL_ON_CONTAINER}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tower-schedule-end" className={FIELD_LABEL}>
            {t("tower_locking.schedule.end")}
          </label>
          <Input
            id="tower-schedule-end"
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              commit({ end_time: e.target.value });
            }}
            className={FIELD_CONTROL_ON_CONTAINER}
          />
        </div>
      </div>

      <fieldset className={`${AUTO_TILE.FOOT} flex flex-col gap-1.5`}>
        <legend className={FIELD_LABEL}>
          {t("tower_locking.schedule.days")}
        </legend>
        <div
          className={DAY_CHIP.ROW}
          role="group"
          aria-label={t("tower_locking.schedule.days_a11y")}
          /* The "no days selected" notice below is the REASON this group is
             the thing to fix, and a screen-reader user lands on the group
             without ever reaching the sentence sitting under it. */
          {...(noDays
            ? { "aria-describedby": "tower-schedule-no-days" }
            : null)}
        >
          {DAY_INDICES.map((index) => {
            const selected = days.includes(index);
            const label = t(`tower_locking.schedule.day_${index}`);
            return (
              <button
                key={index}
                type="button"
                aria-pressed={selected}
                aria-label={t(
                  selected
                    ? "tower_locking.schedule.day_selected"
                    : "tower_locking.schedule.day_unselected",
                  { day: label },
                )}
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
            {t("tower_locking.schedule.no_days")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default ScheduleTile;

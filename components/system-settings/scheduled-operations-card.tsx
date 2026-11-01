"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CheckIcon,
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
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
  SaveScheduledRebootPayload,
  UseSystemSettingsReturn,
} from "@/hooks/use-system-settings";
import type {
  DeviceClockReading,
  ScheduleConfig,
  ScheduledRebootSaveResult,
} from "@/types/system-settings";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CLOCK_VALUE,
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
  VALUE_NONE,
} from "./shapes";

const K = "reboot";

/** The lucide check that `SegmentedField` reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** Index 0-6 = Sun-Sat, matching `ScheduleConfig.days`. The status band reads
    the same keys, so the two cannot ship rival weekday names. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The sr-only line that says this card saves without a Save button. */
const AUTOSAVE_HINT_ID = "scheduled-autosave-hint";

/** The debounce between the last edit and the save it triggers. */
const SAVE_DEBOUNCE_MS = 800;

// useAutosaveSchedule: the switch saves at once, other edits 800ms after the last while on; a failed save reverts.
// A save that armed no live timer warns instead of claiming success.

interface ScheduleLike {
  enabled: boolean;
  days: number[];
}

interface ToastKeys {
  enabled: string;
  disabled: string;
  saved: string;
  saveFailed: string;
  updateFailed: string;
  unsaved: string;
}

interface AutosaveArgs<C extends ScheduleLike> {
  server: C | null;
  /** The draft a block shows before the device has answered. */
  fallback: C;
  save: (draft: C) => Promise<ScheduledRebootSaveResult>;
  keys: ToastKeys;
}

type SaveResult = ScheduledRebootSaveResult;
type Translate = ReturnType<typeof useTranslation>["t"];

/** The not-armed warning: a mapped reason, or the generic line. Raw tokens stay in the console. */
function armWarning(t: Translate, reason?: string): string {
  const mapped = reason
    ? t(`${K}.toast.reasons.${reason}`, { defaultValue: "" })
    : "";
  if (reason && !mapped) {
    console.warn(`[system-settings] unmapped reboot arm reason: ${reason}`);
  }
  return t(`${K}.toast.not_armed`, {
    detail: mapped || t(`${K}.toast.reason_unknown`),
  });
}

function useAutosaveSchedule<C extends ScheduleLike>({
  server,
  fallback,
  save,
  keys,
}: AutosaveArgs<C>) {
  const { t } = useTranslation("system-settings");

  const [draft, setDraft] = useState<C>(server ?? fallback);
  const [isSaving, setIsSaving] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest save may lift `savePending`; an older one settling under a
  // queued edit must leave the latch armed.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  // A save runs long after the render that scheduled it, so it reads the server
  // value, the saver and the translator from here rather than a stale closure.
  const latestRef = useRef({ server, save, t, keys, fallback });
  useEffect(() => {
    latestRef.current = { server, save, t, keys, fallback };
  });

  // Server value at render time, never copied in by an effect, and compared by
  // IDENTITY. Held off while a save is queued or in flight, or a refresh landing
  // inside the debounce window would overwrite the very edit being saved.
  const [prevServer, setPrevServer] = useState<C | null>(null);
  if (!savePending && server !== prevServer) {
    setPrevServer(server);
    setDraft(server ?? fallback);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!timerRef.current) return;
      // The card promises it saves on its own, so a dropped edit must say so.
      clearTimeout(timerRef.current);
      toast.warning(
        latestRef.current.t(latestRef.current.keys.unsaved),
      );
    };
  }, []);

  // A rejection token maps to its own sentence; an unmapped one gets the
  // generic line with the device's words quoted beneath, never spliced in.
  const reportFailure = useCallback((result: SaveResult, key: string) => {
    const { t: tr } = latestRef.current;
    const mapped = result.rejection
      ? tr(`${K}.toast.rejected.${result.rejection}`, { defaultValue: "" })
      : "";
    if (result.rejection && !mapped) {
      console.warn(`[system-settings] unmapped reboot rejection: ${result.rejection}`);
    }
    if (mapped) {
      toast.error(mapped);
      return;
    }
    toast.error(tr(key), { description: result.rejectionDetail || undefined });
  }, []);

  /** Debounced save of an edit made while the schedule is on. */
  const queueSave = useCallback(
    (next: C) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      setSavePending(true);
      timerRef.current = setTimeout(async () => {
        // Cleared before the await so unmounting mid-flight does not warn about
        // a request that is already on the wire.
        timerRef.current = null;
        setIsSaving(true);
        let result: SaveResult;
        try {
          result = await latestRef.current.save(next);
        } finally {
          setIsSaving(false);
          if (seqRef.current === seq) setSavePending(false);
        }
        // Unmounted mid-flight: the request is on the wire, but nothing is left
        // to narrate it to.
        if (!mountedRef.current) return;
        if (!result.success) {
          // Revert to the server's values so the rail stops disagreeing with
          // the band, but not when a newer edit is already queued to replace it.
          if (seqRef.current === seq) {
            const { server: current, fallback: base } = latestRef.current;
            setDraft(current ?? base);
          }
          reportFailure(result, latestRef.current.keys.saveFailed);
          return;
        }
        // Undefined `armed` is an older backend: assume armed.
        if (result.armed === false) {
          toast.warning(armWarning(latestRef.current.t, result.reason));
          return;
        }
        toast.success(latestRef.current.t(latestRef.current.keys.saved));
      }, SAVE_DEBOUNCE_MS);
    },
    [reportFailure],
  );

  /** Edit a non-switch field. Saves (debounced) only while the schedule is on. */
  const edit = useCallback(
    (patch: Partial<C>) => {
      const next = { ...draft, ...patch };
      setDraft(next);
      if (next.enabled) queueSave(next);
    },
    [draft, queueSave],
  );

  const toggleDay = useCallback(
    (dayIndex: number) => {
      const days = draft.days.includes(dayIndex)
        ? draft.days.filter((d) => d !== dayIndex)
        : [...draft.days, dayIndex].sort();
      edit({ days } as unknown as Partial<C>);
    },
    [draft.days, edit],
  );

  /** The switch saves at once and supersedes any queued edit. */
  const setEnabled = useCallback(
    async (checked: boolean) => {
      const next = { ...draft, enabled: checked };
      setDraft(next);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const seq = ++seqRef.current;
      setSavePending(true);
      setIsSaving(true);
      let result: SaveResult;
      try {
        result = await latestRef.current.save(next);
      } finally {
        setIsSaving(false);
        if (seqRef.current === seq) setSavePending(false);
      }
      if (!mountedRef.current) return;
      if (!result.success) {
        // Only the newest toggle may restore the switch; an older one settling
        // late would flip it against a server a newer save already changed.
        if (seqRef.current === seq) {
          setDraft((current) => ({ ...current, enabled: !checked }));
        }
        reportFailure(result, latestRef.current.keys.updateFailed);
        return;
      }
      // Turning it OFF disarms by design, so only an ON save can be unarmed.
      if (checked && result.armed === false) {
        toast.warning(armWarning(latestRef.current.t, result.reason));
        return;
      }
      toast.success(
        latestRef.current.t(
          checked
            ? latestRef.current.keys.enabled
            : latestRef.current.keys.disabled,
        ),
      );
    },
    [draft, reportFailure],
  );

  return { draft, isSaving, edit, toggleDay, setEnabled };
}

// Pieces

/** On / Off / Never-fires chip beside the switch's label. */
function StateChip({
  enabled,
  hasDays,
  ns,
}: {
  enabled: boolean;
  hasDays: boolean;
  ns: string;
}) {
  const { t } = useTranslation("system-settings");
  if (!enabled) {
    return (
      <Badge variant="muted">
        <MinusCircleIcon className="size-3" aria-hidden="true" />
        {t(`${ns}.rows.enabled.off`)}
      </Badge>
    );
  }
  if (!hasDays) {
    return (
      <Badge variant="warning">
        <TriangleAlertIcon className="size-3" aria-hidden="true" />
        {t(`${ns}.rows.enabled.no_day`)}
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <CheckCircle2Icon className="size-3" aria-hidden="true" />
      {t(`${ns}.rows.enabled.armed`)}
    </Badge>
  );
}

/** The seven-pill week. Fill carries selection; the rail spans its row. */
function DayRail({
  days,
  onToggle,
  label,
  consequence,
  railLabel,
}: {
  days: number[];
  onToggle: (index: number) => void;
  label: string;
  consequence: string;
  railLabel: string;
}) {
  const { t } = useTranslation("system-settings");
  return (
    <motion.div variants={staggerRowItem} className={ROW.RAIL_ROOT}>
      <div className={ROW.TEXT}>
        <span className={ROW.LABEL}>{label}</span>
        <span className={ROW.CONSEQUENCE}>{consequence}</span>
      </div>
      <div className={DAY_PILL.RAIL} role="group" aria-label={railLabel}>
        {DAY_KEYS.map((key, index) => {
          const selected = days.includes(index);
          return (
            <button
              key={key}
              type="button"
              aria-label={t(`${K}.days.${key}`)}
              aria-pressed={selected}
              onClick={() => onToggle(index)}
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
  );
}

/** A labelled time field row. */
function TimeRow({
  id,
  label,
  consequence,
  value,
  onChange,
}: {
  id: string;
  label: string;
  consequence: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <motion.div variants={staggerRowItem} className={ROW.ROOT}>
      <div className={ROW.TEXT}>
        <label htmlFor={id} className={ROW.LABEL}>
          {label}
        </label>
        <span className={ROW.CONSEQUENCE}>{consequence}</span>
      </div>
      <div className={ROW.CONTROL}>
        <Input
          id={id}
          type="time"
          host="container"
          className={FIELD}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </motion.div>
  );
}

/** The switch row the schedule hangs off. */
function EnableRow({
  id,
  ns,
  checked,
  hasDays,
  onChange,
}: {
  id: string;
  ns: string;
  checked: boolean;
  hasDays: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation("system-settings");
  return (
    <motion.div variants={staggerRowItem} className={ROW.ROOT}>
      <div className={ROW.TEXT}>
        <div className={LABEL_LINE}>
          <span className={ROW.LABEL}>{t(`${ns}.rows.enabled.label`)}</span>
          <StateChip enabled={checked} hasDays={hasDays} ns={ns} />
        </div>
        <span className={ROW.CONSEQUENCE}>
          {t(`${ns}.rows.enabled.consequence`)}
        </span>
      </div>
      {/* A pill, not a Switch (DESIGN.md > Segmented pills); a pick still
          autosaves at once, as the receipt strip below says. */}
      <div id={id} className={ROW.CONTROL} aria-describedby={AUTOSAVE_HINT_ID}>
        <SegmentedField
          value={checked ? "on" : "off"}
          onValueChange={(next) => onChange(next === "on")}
          options={[
            { value: "off", label: t("state.off", { ns: "common" }) },
            { value: "on", label: t("state.on", { ns: "common" }) },
          ]}
          ariaLabel={t(`${ns}.rows.enabled.label`)}
          breakpoint="never"
          glyph={renderCheckGlyph}
        />
      </div>
    </motion.div>
  );
}

/**
 * The schedule guard refuses to fire before this year: a clock that still
 * reads earlier has not been set from the network (no battery-backed RTC).
 */
const CLOCK_TRUSTED_YEAR = 2025;

/** "YYYY-MM-DDTHH:MM:SS" read as a wall time, in ms on a UTC axis. */
function parseWallTime(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

/** The modem's own ticking clock: epoch minus local wall time gives its UTC offset, not the browser's. */
function DeviceClockRow({ clock }: { clock: DeviceClockReading | null }) {
  const { t, i18n } = useTranslation("system-settings");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clock) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [clock]);

  const wallAtRead = clock ? parseWallTime(clock.local) : null;
  let text: string | null = null;
  let trusted = true;
  if (clock && wallAtRead !== null) {
    const wall = new Date(wallAtRead + Math.max(0, now - clock.receivedAt));
    trusted = wall.getUTCFullYear() >= CLOCK_TRUSTED_YEAR;
    text = new Intl.DateTimeFormat(i18n.language, {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(wall);
  }

  return (
    <motion.div variants={staggerRowItem} className={ROW.ROOT}>
      <div className={ROW.TEXT}>
        <div className={LABEL_LINE}>
          <span className={ROW.LABEL}>{t(`${K}.rows.clock.label`)}</span>
          {text && !trusted ? (
            <Badge variant="warning">
              <TriangleAlertIcon className="size-3" aria-hidden="true" />
              {t(`${K}.rows.clock.unsynced`)}
            </Badge>
          ) : null}
        </div>
        <span className={ROW.CONSEQUENCE}>
          {text && !trusted
            ? t(`${K}.rows.clock.unsynced_consequence`)
            : t(`${K}.rows.clock.consequence`)}
        </span>
      </div>
      <div className={ROW.CONTROL}>
        <span className={CLOCK_VALUE}>{text ?? VALUE_NONE}</span>
      </div>
    </motion.div>
  );
}

// Card

type ScheduledOperationsCardProps = Pick<
  UseSystemSettingsReturn,
  | "scheduledReboot"
  | "deviceClock"
  | "isLoading"
  | "error"
  | "saveScheduledReboot"
  | "refresh"
>;

const REBOOT_FALLBACK: ScheduleConfig = {
  enabled: false,
  time: "04:00",
  days: [],
};

const REBOOT_KEYS: ToastKeys = {
  enabled: `${K}.toast.enabled`,
  disabled: `${K}.toast.disabled`,
  saved: `${K}.toast.saved`,
  saveFailed: `${K}.toast.save_failed`,
  updateFailed: `${K}.toast.update_failed`,
  unsaved: `${K}.toast.unsaved`,
};

const ScheduledOperationsCard = ({
  scheduledReboot,
  deviceClock,
  isLoading,
  error,
  saveScheduledReboot,
  refresh,
}: ScheduledOperationsCardProps) => {
  const { t } = useTranslation("system-settings");

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
                <Skeleton className={SKELETON.REBOOT.PILL} />
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
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.REBOOT.LABEL, "w-28")} />
                <Skeleton className={cn(SKELETON.REBOOT.CONSEQUENCE, "w-3/4")} />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className={SKELETON.REBOOT.CLOCK} />
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

  // No schedule (failed read or none in the envelope): don't render the form, its
  // default fields would be armed by the switch.
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
            onRetry={() => void refresh()}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <ScheduledOperationsForm
      head={head}
      scheduledReboot={scheduledReboot}
      deviceClock={deviceClock}
      error={error}
      saveScheduledReboot={saveScheduledReboot}
    />
  );
};

// Form: mounted only once the schedule exists, so the draft starts from the device's values.

function ScheduledOperationsForm({
  head,
  scheduledReboot,
  deviceClock,
  error,
  saveScheduledReboot,
}: {
  head: React.ReactNode;
  scheduledReboot: ScheduleConfig;
  deviceClock: DeviceClockReading | null;
  error: string | null;
  saveScheduledReboot: (
    payload: SaveScheduledRebootPayload,
  ) => Promise<ScheduledRebootSaveResult>;
}) {
  const { t } = useTranslation("system-settings");

  const reboot = useAutosaveSchedule<ScheduleConfig>({
    server: scheduledReboot,
    fallback: REBOOT_FALLBACK,
    keys: REBOOT_KEYS,
    save: (draft) =>
      saveScheduledReboot({
        action: "save_scheduled_reboot",
        enabled: draft.enabled,
        time: draft.time,
        days: draft.days,
      }),
  });

  const isSaving = reboot.isSaving;

  return (
    <Card className={CARD_SHELL}>
      {head}
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-3.5")}>
        {/* A refresh failed but the schedules are still cached: non-blocking,
            so the card stays usable. */}
        {error ? (
          <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.states.stale`)}</span>
          </div>
        ) : null}

        {/* Nothing else tells AT that this card autosaves: there is no Save
            button, and the receipt strip that says so on screen is decorative. */}
        <span id={AUTOSAVE_HINT_ID} className="sr-only">
          {t(`${K}.states.autosave`)}
        </span>

        <motion.div
          variants={staggerRows}
          className={cn(ROW_GROUP, GROUP_FILL)}
        >
          <EnableRow
            id="scheduled-reboot"
            ns={K}
            checked={reboot.draft.enabled}
            hasDays={reboot.draft.days.length > 0}
            onChange={reboot.setEnabled}
          />
          <TimeRow
            id="scheduled-reboot-time"
            label={t(`${K}.rows.time.label`)}
            consequence={t(`${K}.rows.time.consequence`)}
            value={reboot.draft.time}
            onChange={(time) => reboot.edit({ time })}
          />
          <DayRail
            days={reboot.draft.days}
            onToggle={reboot.toggleDay}
            label={t(`${K}.rows.days.label`)}
            consequence={t(`${K}.rows.days.consequence`)}
            railLabel={t(`${K}.rows.days.rail`)}
          />
          <DeviceClockRow clock={deviceClock} />
        </motion.div>

        {/* The autosave receipt. Announcing the result is the toast's job, so
            the strip itself is decorative. */}
        <div className={RECEIPT_ROW} aria-hidden="true">
          <span className="grid">
            <span
              className={cn(
                SAVE_LAYER,
                isSaving ? "opacity-0" : "opacity-100",
              )}
            >
              <ClockIcon className="size-3.5" />
              {t(`${K}.states.autosave`)}
            </span>
            <span
              className={cn(SAVE_LAYER, isSaving ? "opacity-100" : "opacity-0")}
            >
              <Loader2Icon className="size-3.5 motion-safe:animate-spin" />
              {t(`${K}.states.saving`)}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default ScheduledOperationsCard;

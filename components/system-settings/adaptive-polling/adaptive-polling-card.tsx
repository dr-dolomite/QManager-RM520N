"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CircleAlertIcon,
  GaugeIcon,
  MoonIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HintIcon } from "@/components/ui/hint-icon";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { CardFoot } from "@/components/ui/card-foot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
import type { AdaptivePollingSettings, PollerTier } from "@/types/modem-status";

import { ConditionBlock } from "../condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  GROUP_FILL,
  LABEL_LINE,
  POLLING_GRID,
  ROW,
  ROW_GROUP,
  SECONDS_FIELD,
  SKELETON_POLLING,
} from "../shapes";

const K = "adaptive_polling";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// What the poller runs at now, apart from the draft. A fact, not health (Fact-Is-Info).
const TIER_META: Record<
  PollerTier,
  { icon: LucideIcon; variant: BadgeVariant }
> = {
  active: { icon: ZapIcon, variant: "info" },
  idle: { icon: GaugeIcon, variant: "info" },
  deep: { icon: MoonIcon, variant: "info" },
};

function TierBadge({ tier }: { tier: PollerTier }) {
  const { t } = useTranslation("system-settings");
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  const label = t(`${K}.tier.${tier}`);
  return (
    <Badge
      variant={meta.variant}
      aria-label={t(`${K}.tier_aria`, { tier: label })}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

type FieldKey =
  "active_grace" | "idle_interval" | "idle_threshold" | "deep_idle_interval";

const FIELD_KEYS: FieldKey[] = [
  "active_grace",
  "idle_interval",
  "idle_threshold",
  "deep_idle_interval",
];

// Mirrors the CGI and poller clamps (docs/reference/adaptive-polling.md); two minimums follow other fields.
function fieldBounds(
  key: FieldKey,
  s: AdaptivePollingSettings,
): { min: number; max: number } {
  switch (key) {
    case "active_grace":
      return { min: 20, max: 120 };
    case "idle_interval":
      return { min: 5, max: 300 };
    case "idle_threshold":
      return {
        min: Math.max(60, clamp(s.active_grace, 20, 120) + 1),
        max: 3600,
      };
    case "deep_idle_interval":
      return { min: clamp(s.idle_interval, 5, 300), max: 300 };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Clamps each field, then enforces threshold > grace and deep >= idle. */
function sanitize(s: AdaptivePollingSettings): AdaptivePollingSettings {
  const active_grace = clamp(s.active_grace, 20, 120);
  const idle_interval = clamp(s.idle_interval, 5, 300);
  const idle_threshold = Math.max(
    clamp(s.idle_threshold, 60, 3600),
    active_grace + 1,
  );
  const deep_idle_interval = clamp(s.deep_idle_interval, idle_interval, 300);
  return {
    enabled: s.enabled,
    active_grace,
    idle_interval,
    idle_threshold,
    deep_idle_interval,
  };
}

function settingsKey(s: AdaptivePollingSettings): string {
  return [
    s.enabled ? "1" : "0",
    s.active_grace,
    s.idle_interval,
    s.idle_threshold,
    s.deep_idle_interval,
  ].join(" ");
}

function PollingHeader({ tier }: { tier?: PollerTier }) {
  const { t } = useTranslation("system-settings");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.card_description`)}
      </CardDescription>
      {tier ? (
        <CardAction>
          <TierBadge tier={tier} />
        </CardAction>
      ) : null}
    </CardHeader>
  );
}

function PollingSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <PollingHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL, POLLING_GRID.GROUP)}>
          {Array.from({ length: 1 + FIELD_KEYS.length }, (_, i) => (
            <div key={i} className={cn(ROW.ROOT, i === 0 && POLLING_GRID.SPAN)}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON_POLLING.LABEL, "w-40")} />
                <Skeleton
                  className={cn(
                    SKELETON_POLLING.CONSEQUENCE,
                    "w-64 max-w-full",
                  )}
                />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton
                  className={
                    i === 0 ? SKELETON_POLLING.PILL : SKELETON_POLLING.FIELD
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <CardFoot
          className="mt-auto"
          liveStatus={false}
          actions={<Skeleton className={SKELETON_POLLING.ACTION} />}
        />
      </CardContent>
    </Card>
  );
}

export default function AdaptivePollingCard() {
  const {
    settings,
    isDefault,
    tier,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
    refresh,
  } = useAdaptivePolling();
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  const [draft, setDraft] = useState<AdaptivePollingSettings | undefined>(
    settings,
  );

  // Re-sync the draft when the saved settings change ("store previous value" pattern).
  const [prevSavedKey, setPrevSavedKey] = useState<string | null>(null);
  if (settings) {
    const savedKey = settingsKey(settings);
    if (prevSavedKey !== savedKey) {
      setPrevSavedKey(savedKey);
      setDraft(settings);
    }
  }

  const isDirty = useMemo(() => {
    if (!settings || !draft) return false;
    return settingsKey(settings) !== settingsKey(draft);
  }, [settings, draft]);

  const canSave = isDirty && !isSaving;

  const handleSave = async () => {
    if (!canSave || !draft) return;
    const clean = sanitize(draft);
    const result = await save(clean);
    if (result.success) {
      // Show the clamped values even when they match what was saved before.
      setDraft(clean);
      markSaved();
      toast.success(t(`${K}.toast_saved`));
    } else {
      toast.error(
        resolveErrorMessage(t, result.error, null, t(`${K}.toast_failed`)),
      );
    }
  };

  if (isLoading) return <PollingSkeleton />;

  if (error && !settings) {
    return (
      <Card className={CARD_SHELL}>
        <PollingHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error_title`)}
            description={t(`${K}.error_description`)}
            onRetry={() => refresh()}
            retryLabel={t("common:actions.retry")}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  if (!draft) return null;

  const fieldsDisabled = !draft.enabled || isSaving;

  const status = isDirty ? null : saveError ? (
    <span className="text-destructive-on-surface font-medium">
      {t(`${K}.save_failed_status`)}
    </span>
  ) : isDefault ? (
    <span>{t(`${K}.default_status`)}</span>
  ) : null;

  return (
    <Card className={CARD_SHELL}>
      <PollingHeader tier={tier} />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL, POLLING_GRID.GROUP)}>
          <div className={cn(ROW.ROOT, POLLING_GRID.SPAN)}>
            <div className={ROW.TEXT}>
              <span className={LABEL_LINE}>
                <span className={ROW.LABEL}>{t(`${K}.enabled.label`)}</span>
                <HintIcon label={t(`${K}.enabled.hint_label`)}>
                  {t(`${K}.enabled.hint`)}
                </HintIcon>
              </span>
              <span className={ROW.CONSEQUENCE}>
                {t(draft.enabled ? `${K}.enabled.on` : `${K}.enabled.off`)}
              </span>
            </div>
            <div className={ROW.CONTROL}>
              <SegmentedField
                value={draft.enabled ? "on" : "off"}
                onValueChange={(next) =>
                  setDraft({ ...draft, enabled: next === "on" })
                }
                options={[
                  { value: "off", label: t("common:state.off") },
                  { value: "on", label: t("common:state.on") },
                ]}
                ariaLabel={t(`${K}.enabled.label`)}
                disabled={isSaving}
                breakpoint="never"
                glyph={renderCheckGlyph}
              />
            </div>
          </div>

          {FIELD_KEYS.map((key) => {
            const field = { key, ...fieldBounds(key, draft) };
            return (
              <SecondsRow
                key={key}
                field={field}
                label={t(`${K}.fields.${key}.label`)}
                consequence={t(`${K}.fields.${key}.consequence`, {
                  min: field.min,
                  max: field.max,
                })}
                value={draft[key]}
                disabled={fieldsDisabled}
                onChange={(n) => setDraft((d) => (d ? { ...d, [key]: n } : d))}
              />
            );
          })}
        </div>

        <CardFoot
          className="mt-auto"
          status={status}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={() => setDraft(settings)}
                disabled={!isDirty || isSaving}
              >
                {t("common:actions.discard")}
              </Button>
              <SaveButton
                onClick={handleSave}
                isSaving={isSaving}
                saved={saved}
                disabled={!canSave}
                size="action"
              />
            </>
          }
        />
      </CardContent>
    </Card>
  );
}

// Local string state lets the user clear and retype; the draft only gets parsed numbers.
function SecondsRow({
  field,
  label,
  consequence,
  value,
  disabled,
  onChange,
}: {
  field: { key: FieldKey; min: number; max: number };
  label: string;
  consequence: string;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation("system-settings");
  const id = useId();
  const hintId = `${id}-hint`;

  const [localStr, setLocalStr] = useState<string>(
    Number.isFinite(value) ? String(value) : "",
  );
  const [prevValue, setPrevValue] = useState<number>(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (parseInt(localStr, 10) !== value) {
      setLocalStr(Number.isFinite(value) ? String(value) : "");
    }
  }

  return (
    <div className={ROW.ROOT}>
      <div className={ROW.TEXT}>
        <label
          htmlFor={id}
          className={cn(ROW.LABEL, disabled && "text-on-surface-variant")}
        >
          {label}
        </label>
        <span id={hintId} className={ROW.CONSEQUENCE}>
          {consequence}
        </span>
      </div>
      <div className={ROW.CONTROL}>
        <div className={SECONDS_FIELD.WRAP}>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            host="container"
            min={field.min}
            max={field.max}
            step={1}
            value={localStr}
            disabled={disabled}
            aria-describedby={hintId}
            onChange={(e) => {
              const raw = e.target.value;
              setLocalStr(raw);
              const n = parseInt(raw, 10);
              if (Number.isFinite(n)) onChange(n);
            }}
            onBlur={() => {
              const n = parseInt(localStr, 10);
              if (!Number.isFinite(n)) {
                setLocalStr(Number.isFinite(value) ? String(value) : "");
                return;
              }
              // Snap out-of-range input to the nearest bound so Save sends what the field shows.
              const snapped = clamp(n, field.min, field.max);
              if (snapped !== n) {
                setLocalStr(String(snapped));
                onChange(snapped);
              }
            }}
            className={SECONDS_FIELD.INPUT}
          />
          <span aria-hidden="true" className={SECONDS_FIELD.UNIT}>
            {t(`${K}.unit_seconds`)}
          </span>
        </div>
      </div>
    </div>
  );
}

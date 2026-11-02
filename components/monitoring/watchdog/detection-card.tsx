"use client";

import * as React from "react";
import Link from "next/link";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  SegmentedField,
  SEGMENTED,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import type { WatchdogQualityLimits } from "@/hooks/use-watchdog-settings";
import { cn } from "@/lib/utils";

import {
  TIERS,
  deriveTimeline,
  timelineDuration,
  type TimelineNote,
  type TimelineRow,
} from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DETECT,
  EYEBROW,
  NUM_FIELD,
  SKELETON,
  TIMELINE,
} from "./shapes";
import {
  FIELD_ID,
  PROBE_INTERVAL_OPTIONS,
  draftTiers,
  type WatchdogDraft,
  type WatchdogForm,
} from "./use-watchdog-form";
import { WatchdogFoot, WatchdogFootSkeleton } from "./watchdog-foot";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

const NOTE_KEY: Record<TimelineNote, string> = {
  off: "watchdog.detection.timeline.off",
  none: "watchdog.detection.timeline.none",
  invalid: "watchdog.detection.timeline.invalid",
  stopped: "watchdog.detection.timeline.stopped",
};

type NumKey = "failThreshold" | "cooldown";
type OnOff = "on" | "off";

/** Detection: receipt rows, the derived outage timeline, its own commit. */
export function DetectionCard({
  form,
  qualityLimits,
}: {
  form: WatchdogForm;
  qualityLimits: WatchdogQualityLimits | null;
}) {
  const { t } = useTranslation("common");
  const { draft } = form;

  const probeOptions: SegmentedOption<string>[] = PROBE_INTERVAL_OPTIONS.map(
    (secs) => ({
      value: String(secs),
      label: t("watchdog.detection.probe.short", { seconds: secs }),
      numeric: true,
    }),
  );
  const onOff: SegmentedOption<OnOff>[] = [
    { value: "on", label: t("state.on") },
    { value: "off", label: t("state.off") },
  ];

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.detection.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.detection.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, DETECT.BODY)}>
        <div className={DETECT.ROWS}>
          <div className={DETECT.ROW}>
            <span className={DETECT.KEY}>{t("watchdog.detection.probe.label")}</span>
            <div ref={form.registerField(FIELD_ID.probeInterval)} className="contents">
              <SegmentedField
                value={draft.probeInterval}
                onValueChange={(next) => form.setFields({ probeInterval: next })}
                options={probeOptions}
                ariaLabel={t("watchdog.detection.probe.label")}
                breakpoint="lg"
                glyph={renderCheckGlyph}
                className={cn("w-auto", DETECT.PROBE_PILL)}
                selectTriggerClassName={DETECT.PROBE_SELECT}
              />
            </div>
            {form.errors.probeInterval ? (
              <p id={`${FIELD_ID.probeInterval}-error`} role="alert" className={DETECT.ERROR}>
                {t(form.errors.probeInterval)}
              </p>
            ) : null}
          </div>

          <NumberRow
            form={form}
            field="failThreshold"
            id={FIELD_ID.failThreshold}
            labelKey="watchdog.detection.threshold.label"
            unitKey="watchdog.detection.threshold.unit"
          />
          <NumberRow
            form={form}
            field="cooldown"
            id={FIELD_ID.cooldown}
            labelKey="watchdog.detection.cooldown.label"
            unitKey="watchdog.detection.cooldown.unit"
          />
          <ToggleRow
            form={form}
            onOff={onOff}
            on={draft.quality}
            onChange={(on) => form.setFields({ quality: on })}
            field="qualityConsecutive"
            id={FIELD_ID.qualityConsecutive}
            labelKey="watchdog.detection.quality.label"
            unitKey="watchdog.detection.quality.unit"
            caption={
              <>
                {qualityLimits ? (
                  <span>
                    {t("watchdog.detection.quality.caption", {
                      ms: qualityLimits.latency_ms,
                      pct: qualityLimits.loss_pct,
                    })}
                  </span>
                ) : null}
                <Link href="/monitoring/connection-quality" className={DETECT.LINK}>
                  {t("watchdog.detection.quality.link")}
                  <ChevronRightIcon className="size-3.5" aria-hidden />
                </Link>
              </>
            }
          />
          <ToggleRow
            form={form}
            onOff={onOff}
            on={draft.ssrAware}
            onChange={(on) => form.setFields({ ssrAware: on })}
            field="ssrGrace"
            id={FIELD_ID.ssrGrace}
            labelKey="watchdog.detection.ssr.label"
            unitKey="watchdog.detection.ssr.unit"
            caption={t("watchdog.detection.ssr.caption")}
          />
        </div>

        <Timeline draft={draft} />
      </CardContent>
      <WatchdogFoot form={form} scope="detection" />
    </Card>
  );
}

function NumberRow({
  form,
  field,
  id,
  labelKey,
  unitKey,
}: {
  form: WatchdogForm;
  field: NumKey;
  id: string;
  labelKey: string;
  unitKey: string;
}) {
  const { t } = useTranslation("common");
  const error = form.errors[field];
  return (
    <div className={DETECT.ROW}>
      <label htmlFor={id} className={DETECT.KEY}>
        {t(labelKey)}
      </label>
      <InputGroup className={NUM_FIELD.GROUP}>
        <InputGroupInput
          id={id}
          ref={form.registerField(id)}
          type="text"
          inputMode="numeric"
          value={form.draft[field]}
          onChange={(e) => {
            const patch: Partial<WatchdogDraft> = {};
            patch[field] = e.target.value;
            form.setFields(patch);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={NUM_FIELD.INPUT}
        />
        <InputGroupAddon align="inline-end" className={NUM_FIELD.UNIT}>
          {t(unitKey)}
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <p id={`${id}-error`} className={DETECT.ERROR}>
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/** A switch row: key + caption, then the number it arms and its On/Off pill. */
function ToggleRow({
  form,
  onOff,
  on,
  onChange,
  field,
  id,
  labelKey,
  unitKey,
  caption,
}: {
  form: WatchdogForm;
  onOff: SegmentedOption<OnOff>[];
  on: boolean;
  onChange: (on: boolean) => void;
  field: "qualityConsecutive" | "ssrGrace";
  id: string;
  labelKey: string;
  unitKey: string;
  caption: React.ReactNode;
}) {
  const { t } = useTranslation("common");
  const error = form.errors[field];
  const label = t(labelKey);
  return (
    <div className={DETECT.ROW}>
      <div className={DETECT.KEY_STACK}>
        <span className={DETECT.KEY}>{label}</span>
        <span className={DETECT.CAPTION}>{caption}</span>
      </div>
      <div className={DETECT.CONTROLS}>
        <InputGroup data-disabled={!on} className={NUM_FIELD.GROUP}>
          <InputGroupInput
            id={id}
            ref={form.registerField(id)}
            type="text"
            inputMode="numeric"
            value={form.draft[field]}
            onChange={(e) => {
              const patch: Partial<WatchdogDraft> = {};
              patch[field] = e.target.value;
              form.setFields(patch);
            }}
            disabled={!on}
            aria-label={label}
            aria-invalid={error !== null}
            aria-describedby={error ? `${id}-error` : undefined}
            className={NUM_FIELD.INPUT}
          />
          <InputGroupAddon align="inline-end" className={NUM_FIELD.UNIT}>
            {t(unitKey)}
          </InputGroupAddon>
        </InputGroup>
        <SegmentedField
          value={on ? "on" : "off"}
          onValueChange={(next) => onChange(next === "on")}
          options={onOff}
          ariaLabel={label}
          breakpoint="never"
          glyph={renderCheckGlyph}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className={DETECT.ERROR}>
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/** When each armed step runs into an outage, from both cards' drafts. */
function Timeline({ draft }: { draft: WatchdogDraft }) {
  const { t } = useTranslation("common");
  const { rows, note } = deriveTimeline({
    enabled: draft.enabled,
    tiers: draftTiers(draft),
    backupSlot: draft.backupSlot,
    probeInterval: draft.probeInterval,
    failThreshold: draft.failThreshold,
    cooldown: draft.cooldown,
  });

  const label = (row: TimelineRow) =>
    row.declared
      ? row.tier === 4
        ? t("watchdog.detection.timeline.declaredReboot")
        : t("watchdog.detection.timeline.declaredStep", { tier: row.tier })
      : row.tier === 4
        ? t("watchdog.detection.timeline.reboot")
        : t("watchdog.detection.timeline.step", { tier: row.tier });

  return (
    <div className={TIMELINE.ROOT}>
      <span className={EYEBROW}>{t("watchdog.detection.timeline.eyebrow")}</span>
      {rows.length > 0 ? (
        <ul className={TIMELINE.ROWS}>
          {rows.map((row) => {
            const d = timelineDuration(row.seconds);
            return (
              <li key={row.tier} className={TIMELINE.ROW}>
                <span className={TIMELINE.KEY}>{label(row)}</span>
                <span className={TIMELINE.VALUE}>
                  {t("watchdog.detection.timeline.about", { time: t(d.key, d.params) })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {note ? <p className={TIMELINE.NOTE}>{t(NOTE_KEY[note])}</p> : null}
    </div>
  );
}

/** Mirrors the loaded card: five receipt rows, the timeline, the foot. */
export function DetectionCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden>
      <CardHeader className={CARD_PAD}>
        <Skeleton className={cn(SKELETON.CARD_TITLE, "w-32")} />
        <Skeleton className={cn(SKELETON.CARD_DESC, "w-56")} />
      </CardHeader>
      <CardContent className={cn(CARD_PAD, DETECT.BODY)}>
        <div className={DETECT.ROWS}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={DETECT.ROW}>
              <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-28")} />
              <Skeleton className={cn(SKELETON.FIELD, "w-36")} />
            </div>
          ))}
        </div>
        <div className={TIMELINE.ROOT}>
          <Skeleton className={cn(SKELETON.EYEBROW, "w-28")} />
          <div className={TIMELINE.ROWS}>
            {TIERS.map((tier) => (
              <Skeleton key={tier} className={cn(SKELETON.TIMELINE_ROW, "w-full")} />
            ))}
          </div>
        </div>
      </CardContent>
      <WatchdogFootSkeleton />
    </Card>
  );
}

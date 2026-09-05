"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { InfoIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  FIELD_STACK,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_NUM,
  NOTICE_TONE,
  SKELETON,
} from "./shapes";
import {
  FIELD_ID,
  PROBE_INTERVAL_OPTIONS,
  type RegisterField,
  type WatchdogForm,
} from "./use-watchdog-form";

export interface DetectionCardProps {
  form: WatchdogForm;
  registerField: RegisterField;
}

/**
 * Detection — the cadence half of the form. It is the HEIGHT DRIVER of the
 * `COLS` pair: three fixed-height fields plus a notice, with nothing that can
 * stretch, so it declares no fill region and Activity absorbs the slack.
 */
export function DetectionCard({ form, registerField }: DetectionCardProps) {
  const { t } = useTranslation("common");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("watchdog.detection.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.detection.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        <div className={FIELD_STACK}>
          <div className={FIELD.ROW}>
            <label className={FIELD.LABEL} htmlFor={FIELD_ID.probeInterval}>
              {t("watchdog.detection.probe.label")}
            </label>
            <Select
              value={form.probeInterval}
              onValueChange={form.setProbeInterval}
            >
              <SelectTrigger
                id={FIELD_ID.probeInterval}
                ref={registerField(FIELD_ID.probeInterval)}
                aria-invalid={form.errors.probeInterval !== null}
                className={cn(FIELD.SHELL, FIELD.INVALID)}
              >
                <SelectValue
                  placeholder={t("watchdog.detection.probe.placeholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {PROBE_INTERVAL_OPTIONS.map((secs) => (
                  <SelectItem key={secs} value={String(secs)}>
                    {t("watchdog.detection.probe.option", { count: secs })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className={FIELD.HINT}>{t("watchdog.detection.probe.hint")}</p>
            {form.errors.probeInterval ? (
              <p className={FIELD.ERROR}>{t(form.errors.probeInterval)}</p>
            ) : null}
          </div>

          <div className={FIELD.ROW}>
            <label className={FIELD.LABEL} htmlFor={FIELD_ID.failThreshold}>
              {t("watchdog.detection.threshold.label")}
            </label>
            <Input
              id={FIELD_ID.failThreshold}
              ref={registerField(FIELD_ID.failThreshold)}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={form.failThreshold}
              onChange={(e) => form.setFailThreshold(e.target.value)}
              aria-invalid={form.errors.failThreshold !== null}
              className={cn(FIELD.SHELL, FIELD.INVALID, FIELD.NUM)}
            />
            <p className={FIELD.HINT}>
              {t("watchdog.detection.threshold.hint")}
            </p>
            {form.errors.failThreshold ? (
              <p className={FIELD.ERROR}>{t(form.errors.failThreshold)}</p>
            ) : null}
          </div>

          <div className={FIELD.ROW}>
            <label className={FIELD.LABEL} htmlFor={FIELD_ID.cooldown}>
              {t("watchdog.detection.cooldown.label")}
            </label>
            <Input
              id={FIELD_ID.cooldown}
              ref={registerField(FIELD_ID.cooldown)}
              type="number"
              inputMode="numeric"
              min={10}
              max={300}
              value={form.cooldown}
              onChange={(e) => form.setCooldown(e.target.value)}
              aria-invalid={form.errors.cooldown !== null}
              className={cn(FIELD.SHELL, FIELD.INVALID, FIELD.NUM)}
            />
            <p className={FIELD.HINT}>{t("watchdog.detection.cooldown.hint")}</p>
            {form.errors.cooldown ? (
              <p className={FIELD.ERROR}>{t(form.errors.cooldown)}</p>
            ) : null}
          </div>
        </div>

        {/* The one derived reading on the form: probe cadence x threshold. */}
        <p className={cn(NOTICE, NOTICE_TONE.info)}>
          <InfoIcon className={NOTICE_GLYPH} aria-hidden />
          {/* The figure inside this sentence retargets on every keystroke. */}
          <span className={NOTICE_NUM}>
            {form.estimatedDownSecs === null
              ? t("watchdog.detection.derived.unavailable")
              : t("watchdog.detection.derived.ready", {
                  seconds: form.estimatedDownSecs,
                })}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/** Mirrors the loaded card: three fields and the notice, same constants. */
export function DetectionCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden>
      <CardHeader className={CARD_PAD}>
        <Skeleton className={cn(SKELETON.LINE, "h-5 w-32")} />
        <Skeleton className={cn(SKELETON.LINE, "h-4 w-56")} />
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        <div className={FIELD_STACK}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={FIELD.ROW}>
              <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-28")} />
              <Skeleton className={SKELETON.FIELD} />
              <Skeleton className={cn(SKELETON.LINE, "h-3 w-44")} />
            </div>
          ))}
        </div>
        <Skeleton className={cn(SKELETON.LINE, "h-8 w-full")} />
      </CardContent>
    </Card>
  );
}

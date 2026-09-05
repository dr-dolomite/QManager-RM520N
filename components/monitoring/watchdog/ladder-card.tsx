"use client";

import * as React from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import {
  RUNG_BADGE,
  RUNG_GLYPH,
  RUNG_STATUS_KEY,
  TIER_CONSEQUENCE_KEY,
  TIER_EFFECT_KEY,
  TIER_NAME_KEY,
  deriveRungs,
  type RungView,
  type TierIndex,
} from "./derive";
import {
  CARD_DESC,
  CARD_TITLE,
  FIELD,
  HERO_PAD,
  HERO_SHELL,
  RUNG,
  SKELETON,
  SWITCH_ROW,
  SWITCH_TARGET,
} from "./shapes";
import {
  FIELD_ID,
  type RegisterField,
  type WatchdogForm,
} from "./use-watchdog-form";

import { Skeleton } from "@/components/ui/skeleton";

export interface LadderCardProps {
  form: WatchdogForm;
  /** Live truth: the tier the daemon is executing now, 0 for none. */
  runningTier: number;
  registerField: RegisterField;
}

/**
 * The recovery ladder — the one anchor card on this surface. It replaces both
 * the read-only stepper and the settings card's Recovery tab, so a rung states
 * what it does, what it costs, whether it is armed, and lets you arm it.
 */
export function LadderCard({
  form,
  runningTier,
  registerField,
}: LadderCardProps) {
  const { t } = useTranslation("common");

  const setters: Record<TierIndex, (v: boolean) => void> = {
    1: form.setTier1Enabled,
    2: form.setTier2Enabled,
    3: form.setTier3Enabled,
    4: form.setTier4Enabled,
  };

  const rungs = deriveRungs({
    tiers: {
      1: form.tier1Enabled,
      2: form.tier2Enabled,
      3: form.tier3Enabled,
      4: form.tier4Enabled,
    },
    backupSlot: form.backupSimSlot,
    runningTier,
  });

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={HERO_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.ladder.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.ladder.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(HERO_PAD, "flex flex-col gap-4")}>
        <div
          className={cn(
            SWITCH_ROW.ROOT,
            SWITCH_ROW.TRANSITION,
            form.isEnabled ? SWITCH_ROW.ON : SWITCH_ROW.REST,
          )}
        >
          <div className={SWITCH_ROW.TEXT}>
            <p className={SWITCH_ROW.TITLE}>{t("watchdog.master.title")}</p>
            <p className={SWITCH_ROW.DESC}>{t("watchdog.master.description")}</p>
          </div>
          <Switch
            checked={form.isEnabled}
            onCheckedChange={form.setIsEnabled}
            aria-label={t("watchdog.master.aria")}
            className={SWITCH_TARGET}
          />
        </div>

        <ul className={RUNG.STACK} aria-label={t("watchdog.ladder.aria")}>
          {rungs.map((rung) => (
            <Rung
              key={rung.tier}
              rung={rung}
              masterOff={!form.isEnabled}
              onToggle={setters[rung.tier]}
              form={form}
              registerField={registerField}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Rung({
  rung,
  masterOff,
  onToggle,
  form,
  registerField,
}: {
  rung: RungView;
  masterOff: boolean;
  onToggle: (v: boolean) => void;
  form: WatchdogForm;
  registerField: RegisterField;
}) {
  const { t } = useTranslation("common");
  const running = rung.state === "running";
  const name = t(TIER_NAME_KEY[rung.tier]);

  return (
    <li
      className={cn(
        RUNG.ROOT,
        RUNG.TRANSITION,
        running ? RUNG.RUNNING : RUNG.REST,
      )}
    >
      <span
        aria-hidden
        className={cn(
          RUNG.DISC,
          RUNG.TRANSITION,
          running ? RUNG.DISC_RUNNING : RUNG.DISC_REST,
        )}
      >
        {rung.tier}
      </span>

      <div className={RUNG.BODY}>
        <div className={RUNG.HEAD}>
          <span className={RUNG.NAME}>{name}</span>
        </div>
        <p className={RUNG.EFFECT}>{t(TIER_EFFECT_KEY[rung.tier])}</p>
        {/* The cost of the rung sits in the rung, never behind a tooltip. */}
        <p className={RUNG.CONSEQUENCE}>{t(TIER_CONSEQUENCE_KEY[rung.tier])}</p>
        <div className={RUNG.META}>
          <Tag
            variant="neutral"
            className={cn(RUNG.META_CHIP, running && RUNG.META_CHIP_ON_TONAL)}
          >
            {rung.command}
          </Tag>
        </div>

        {rung.tier === 3 && rung.enabled ? (
          <div className={RUNG.FIELD_SLOT}>
            <Select
              value={form.backupSimSlot}
              onValueChange={form.setBackupSimSlot}
            >
              <SelectTrigger
                id={FIELD_ID.backupSim}
                ref={registerField(FIELD_ID.backupSim)}
                aria-label={t("watchdog.ladder.tier3.slotLabel")}
                aria-invalid={form.errors.backupSim !== null}
                className={cn(
                  FIELD.SHELL_ON_CONTAINER,
                  FIELD.INVALID,
                  FIELD.NARROW,
                )}
              >
                <SelectValue
                  placeholder={t("watchdog.ladder.tier3.slotPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">
                  {t("watchdog.ladder.tier3.slot", { slot: 1 })}
                </SelectItem>
                <SelectItem value="2">
                  {t("watchdog.ladder.tier3.slot", { slot: 2 })}
                </SelectItem>
              </SelectContent>
            </Select>
            {form.errors.backupSim ? (
              <p className={cn(FIELD.ERROR, "pt-1.5")}>
                {t(form.errors.backupSim)}
              </p>
            ) : null}
          </div>
        ) : null}

        {rung.tier === 4 && rung.enabled ? (
          <div className={RUNG.FIELD_SLOT}>
            <Input
              id={FIELD_ID.maxReboots}
              ref={registerField(FIELD_ID.maxReboots)}
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={form.maxRebootsPerHour}
              onChange={(e) => form.setMaxRebootsPerHour(e.target.value)}
              aria-label={t("watchdog.ladder.tier4.capLabel")}
              aria-invalid={form.errors.maxReboots !== null}
              className={cn(
                FIELD.SHELL_ON_CONTAINER,
                FIELD.INVALID,
                FIELD.NUM,
                FIELD.NARROW,
              )}
            />
            {form.errors.maxReboots ? (
              <p className={cn(FIELD.ERROR, "pt-1.5")}>
                {t(form.errors.maxReboots)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={RUNG.ACTIONS}>
        {rung.state === "running" ? (
          // The promoted container already reports the state and the disc
          // already carries it, so this is a marker rather than a second fill.
          <span className={RUNG.MARKER}>
            <span aria-hidden className={RUNG.MARKER_DOT} />
            {t("watchdog.ladder.status.running")}
          </span>
        ) : (
          <RungChip state={rung.state} />
        )}
        <Switch
          checked={rung.enabled}
          onCheckedChange={onToggle}
          disabled={masterOff}
          aria-label={name}
          className={SWITCH_TARGET}
        />
      </div>
    </li>
  );
}

function RungChip({ state }: { state: Exclude<RungView["state"], "running"> }) {
  const { t } = useTranslation("common");
  const Glyph = RUNG_GLYPH[state];
  return (
    <Badge variant={RUNG_BADGE[state]}>
      <Glyph className="size-3" />
      {t(RUNG_STATUS_KEY[state])}
    </Badge>
  );
}

/** Mirrors the loaded card: one switch row over four rungs, same constants. */
export function LadderCardSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden>
      <CardHeader className={HERO_PAD}>
        <Skeleton className={cn(SKELETON.LINE, "h-5 w-40")} />
        <Skeleton className={cn(SKELETON.LINE, "h-4 w-64")} />
      </CardHeader>
      <CardContent className={cn(HERO_PAD, "flex flex-col gap-4")}>
        <Skeleton className={SKELETON.SWITCH} />
        <div className={RUNG.STACK}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className={SKELETON.RUNG} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

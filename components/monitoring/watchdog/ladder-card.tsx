"use client";

import * as React from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
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
import { cn } from "@/lib/utils";

import {
  TIERS,
  TIER_CONSEQUENCE_KEY,
  TIER_NAME_KEY,
  type TierIndex,
} from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HEAD_ACTION,
  HEAD_DESC_SPAN,
  NUM_FIELD,
  RUNG,
  SKELETON,
} from "./shapes";
import {
  FIELD_ID,
  draftTiers,
  type WatchdogDraft,
  type WatchdogForm,
} from "./use-watchdog-form";
import { WatchdogFoot, WatchdogFootSkeleton } from "./watchdog-foot";

export interface LadderCardProps {
  form: WatchdogForm;
  /** Live truth: the tier the daemon is executing now, 0 for none. */
  runningTier: number;
}

type OnOff = "on" | "off";
/** "none" matches no segment: tier 3 armed with no slot selects nothing. */
type SlotChoice = "1" | "2" | "off" | "none";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

const TIER_FLAG = { 1: "tier1", 2: "tier2", 3: "tier3", 4: "tier4" } as const;

/** The recovery ladder: master enable on the header, four compact rungs, its own commit. */
export function LadderCard({ form, runningTier }: LadderCardProps) {
  const { t } = useTranslation("common");
  const onOff: SegmentedOption<OnOff>[] = [
    { value: "on", label: t("state.on") },
    { value: "off", label: t("state.off") },
  ];

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("watchdog.ladder.title")}</CardTitle>
        <CardDescription className={cn(CARD_DESC, HEAD_DESC_SPAN)}>
          {t("watchdog.ladder.description")}
        </CardDescription>
        <CardAction className={HEAD_ACTION}>
          <SegmentedField
            value={form.draft.enabled ? "on" : "off"}
            onValueChange={(next) => form.setFields({ enabled: next === "on" })}
            options={onOff}
            ariaLabel={t("watchdog.master.aria")}
            breakpoint="never"
            glyph={renderCheckGlyph}
          />
        </CardAction>
      </CardHeader>
      <CardContent className={CARD_PAD}>
        <ol className={RUNG.STACK} aria-label={t("watchdog.ladder.aria")}>
          {TIERS.map((tier) => (
            <React.Fragment key={tier}>
              <Rung
                tier={tier}
                form={form}
                onOff={onOff}
                // Live truth first: a rung the daemon is executing IS running.
                running={runningTier === tier}
                // The ladder has climbed past this rung in the current outage.
                passed={runningTier > tier}
              />
              {tier === 3 ? <FailbackRow form={form} onOff={onOff} /> : null}
            </React.Fragment>
          ))}
        </ol>
      </CardContent>
      <WatchdogFoot form={form} scope="ladder" />
    </Card>
  );
}

function Rung({
  tier,
  form,
  onOff,
  running,
  passed,
}: {
  tier: TierIndex;
  form: WatchdogForm;
  onOff: SegmentedOption<OnOff>[];
  running: boolean;
  passed: boolean;
}) {
  const { t } = useTranslation("common");
  const { draft } = form;
  const masterOff = !draft.enabled;
  const armed = draftTiers(draft)[tier];
  const needsSlot = tier === 3 && armed && !draft.backupSlot;
  // A disarmed rung was skipped, not tried. The glyph, not the green alone, says "done".
  const done = passed && armed && !running;
  const name = t(TIER_NAME_KEY[tier]);
  const ariaLabel = t("watchdog.ladder.tierAria", { name });

  let control: React.ReactNode;
  if (tier === 3) {
    const slots: SegmentedOption<SlotChoice>[] = [
      { value: "1", label: t("watchdog.ladder.tier3.slot", { slot: 1 }) },
      { value: "2", label: t("watchdog.ladder.tier3.slot", { slot: 2 }) },
      { value: "off", label: t("state.off") },
    ];
    const value: SlotChoice = !armed
      ? "off"
      : draft.backupSlot === "1" || draft.backupSlot === "2"
        ? draft.backupSlot
        : "none";
    control = (
      <div ref={form.registerField(FIELD_ID.backupSim)} className="contents">
        <SegmentedField
          value={value}
          onValueChange={(next) =>
            // Off keeps the slot, so turning the step back on restores it.
            form.setFields(
              next === "1" || next === "2"
                ? { tier3: true, backupSlot: next }
                : { tier3: false },
            )
          }
          options={slots}
          ariaLabel={ariaLabel}
          disabled={masterOff}
          breakpoint="never"
          glyph={renderCheckGlyph}
        />
      </div>
    );
  } else {
    control = (
      <SegmentedField
        value={armed ? "on" : "off"}
        onValueChange={(next) => {
          const patch: Partial<WatchdogDraft> = {};
          patch[TIER_FLAG[tier]] = next === "on";
          form.setFields(patch);
        }}
        options={onOff}
        ariaLabel={ariaLabel}
        disabled={masterOff}
        breakpoint="never"
        glyph={renderCheckGlyph}
      />
    );
  }

  const capOff = !armed || masterOff;
  const capError = tier === 4 ? form.errors.maxReboots : null;

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
          running ? RUNG.DISC_RUNNING : done ? RUNG.DISC_DONE : RUNG.DISC_REST,
        )}
      >
        {done ? <CheckIcon className={RUNG.DONE_GLYPH} /> : tier}
      </span>

      <div className={RUNG.TEXT}>
        <span className={cn(RUNG.NAME, masterOff && !running && RUNG.NAME_INACTIVE)}>
          <span className="min-w-0">{name}</span>
          {running ? (
            <span className={RUNG.MARKER}>
              <span aria-hidden className={RUNG.MARKER_DOT} />
              {t("watchdog.ladder.status.running")}
            </span>
          ) : done ? (
            <span className="sr-only">{t("watchdog.ladder.status.done")}</span>
          ) : needsSlot ? (
            <Badge variant="warning">
              <TriangleAlertIcon className="size-3" />
              {t("watchdog.ladder.status.blocked")}
            </Badge>
          ) : null}
        </span>
        <span className={cn(RUNG.COST, running && RUNG.COST_RUNNING)}>
          {t(TIER_CONSEQUENCE_KEY[tier])}
        </span>
      </div>

      <div className={tier === 4 ? RUNG.CONTROLS_WIDE : RUNG.CONTROLS}>
        {tier === 4 ? (
          // Never unmounted: disabling it keeps the rung's height fixed.
          <label className={RUNG.CAP}>
            <span className={RUNG.CAP_LEAD}>{t("watchdog.ladder.tier4.capLead")}</span>
            <InputGroup
              data-disabled={capOff}
              className={NUM_FIELD.GROUP}
            >
              <InputGroupInput
                id={FIELD_ID.maxReboots}
                ref={form.registerField(FIELD_ID.maxReboots)}
                type="text"
                inputMode="numeric"
                value={draft.maxReboots}
                onChange={(e) => form.setFields({ maxReboots: e.target.value })}
                disabled={capOff}
                aria-label={t("watchdog.ladder.tier4.capLabel")}
                aria-invalid={capError !== null}
                aria-describedby={capError ? `${FIELD_ID.maxReboots}-error` : undefined}
                className={NUM_FIELD.INPUT}
              />
              <InputGroupAddon align="inline-end" className={NUM_FIELD.UNIT}>
                {t("watchdog.ladder.tier4.capUnit")}
              </InputGroupAddon>
            </InputGroup>
          </label>
        ) : null}
        {control}
      </div>

      {capError ? (
        <p id={`${FIELD_ID.maxReboots}-error`} className={RUNG.ERROR}>
          {t(capError)}
        </p>
      ) : null}
    </li>
  );
}

/** Step 3's companion: a periodic swap back to the primary SIM, so no disc of its own. */
function FailbackRow({
  form,
  onOff,
}: {
  form: WatchdogForm;
  onOff: SegmentedOption<OnOff>[];
}) {
  const { t } = useTranslation("common");
  const { draft } = form;
  const inactive = !draft.enabled || !draft.tier3;
  const fieldOff = inactive || !draft.recheck;
  const error = form.errors.recheckInterval;
  const name = t("watchdog.ladder.failback.name");

  return (
    <li className={cn(RUNG.ROOT, RUNG.REST)}>
      <span aria-hidden className={RUNG.SUB_DISC} />
      <div className={RUNG.TEXT}>
        <span className={cn(RUNG.NAME, inactive && RUNG.NAME_INACTIVE)}>
          <span className="min-w-0">{name}</span>
        </span>
        <span className={RUNG.COST}>{t("watchdog.ladder.failback.consequence")}</span>
      </div>
      <div className={RUNG.CONTROLS_WIDE}>
        <label className={RUNG.CAP}>
          <span className={RUNG.CAP_LEAD}>{t("watchdog.ladder.failback.lead")}</span>
          <InputGroup data-disabled={fieldOff} className={NUM_FIELD.GROUP}>
            <InputGroupInput
              id={FIELD_ID.recheckInterval}
              ref={form.registerField(FIELD_ID.recheckInterval)}
              type="text"
              inputMode="numeric"
              value={draft.recheckInterval}
              onChange={(e) => form.setFields({ recheckInterval: e.target.value })}
              disabled={fieldOff}
              aria-label={t("watchdog.ladder.failback.intervalLabel")}
              aria-invalid={error !== null}
              aria-describedby={error ? `${FIELD_ID.recheckInterval}-error` : undefined}
              className={NUM_FIELD.INPUT}
            />
            <InputGroupAddon align="inline-end" className={NUM_FIELD.UNIT}>
              {t("watchdog.ladder.failback.unit")}
            </InputGroupAddon>
          </InputGroup>
        </label>
        <SegmentedField
          value={draft.recheck ? "on" : "off"}
          onValueChange={(next) => form.setFields({ recheck: next === "on" })}
          options={onOff}
          ariaLabel={t("watchdog.ladder.tierAria", { name })}
          disabled={inactive}
          breakpoint="never"
          glyph={renderCheckGlyph}
        />
      </div>
      {error ? (
        <p id={`${FIELD_ID.recheckInterval}-error`} className={RUNG.ERROR}>
          {t(error)}
        </p>
      ) : null}
    </li>
  );
}

/** Mirrors the loaded card: header with its pill, four rungs plus step 3's companion, then the foot. */
export function LadderCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden>
      <CardHeader className={CARD_PAD}>
        <Skeleton className={cn(SKELETON.CARD_TITLE, "w-40")} />
        <Skeleton className={cn(SKELETON.CARD_DESC, HEAD_DESC_SPAN, "w-56")} />
        <CardAction className={HEAD_ACTION}>
          <Skeleton className={cn(SKELETON.PILL, "w-36")} />
        </CardAction>
      </CardHeader>
      <CardContent className={CARD_PAD}>
        <div className={RUNG.STACK}>
          {/* The loaded rung's grid, so the phone's second control row is mirrored too. */}
          {/* 0 is step 3's companion row. */}
          {([1, 2, 3, 0, 4] as const).map((tier) => (
            <div key={tier} className={RUNG.ROOT}>
              {tier === 0 ? (
                <span className={RUNG.SUB_DISC} />
              ) : (
                <Skeleton className={RUNG.DISC} />
              )}
              <div className={RUNG.TEXT}>
                <Skeleton className={SKELETON.RUNG_NAME} />
                <Skeleton className={SKELETON.RUNG_COST} />
              </div>
              <div
                className={tier === 4 || tier === 0 ? RUNG.CONTROLS_WIDE : RUNG.CONTROLS}
              >
                {tier === 4 || tier === 0 ? (
                  <Skeleton className={cn(SKELETON.FIELD, "w-20")} />
                ) : null}
                <Skeleton className={cn(SKELETON.PILL, tier === 3 ? "w-44" : "w-28")} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <WatchdogFootSkeleton />
    </Card>
  );
}

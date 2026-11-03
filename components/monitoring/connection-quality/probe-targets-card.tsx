"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RouteOffIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  PING_PROFILES,
  type PingProfile,
  type PingProfileTargets,
  type UsePingProfileReturn,
} from "@/hooks/use-ping-profile";
import { cn } from "@/lib/utils";
import type { ConnectivityStatus } from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  DELTA,
  EYEBROW,
  FAILED,
  FIELD_ERROR,
  FIELD_MONO,
  FOCUS_RING,
  GROUP,
  GROUP_HEAD,
  HOSTNAME_LEGS,
  LEG,
  METRIC_HEAD,
  PILL_GLYPH,
  PROFILE_INTERVAL_SEC,
  ROW,
  ROW_STACK,
  SKELETON_LOCAL,
  SLOT_ORDER,
  type SlotKey,
} from "./shapes";

// Probe Targets: the sensitivity profile and the four endpoints the modem pings, in
// probe order. A cadence set on the Watchdog page overrides the profile's own.

const K = "connection_quality.targets";
const WATCHDOG_HREF = "/monitoring/watchdog/";

/** The seeded chain, so a restore lands where a fresh install would. */
const DEFAULT_TARGETS: PingProfileTargets = {
  profile: "relaxed",
  target_host_1: "cloudflare.com",
  target_host_2: "google.com",
  target_ip_1: "1.1.1.1",
  target_ip_2: "8.8.8.8",
};

const PLACEHOLDER: Record<SlotKey, string> = DEFAULT_TARGETS;

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** Label leaf per slot; the key says which leg, never the config key name. */
const LABEL_LEAF: Record<SlotKey, string> = {
  target_host_1: "host_1",
  target_host_2: "host_2",
  target_ip_1: "ip_1",
  target_ip_2: "ip_2",
};

// ─── Validation: mirrors validate_target() in the CGI ───────────────────────

type ValidationCode =
  | "empty"
  | "too_long"
  | "spaces"
  | "disallowed"
  | "host_invalid"
  | "ipv4_required"
  | "ipv4_invalid";

type SlotErrors = Partial<Record<SlotKey, ValidationCode | null>>;

const MAX_TARGET_LENGTH = 128;

// Shared by both families: trimmed, non-empty, length-bounded, no interior
// whitespace, no shell/HTML metacharacters.
function checkCommonRules(trimmed: string): ValidationCode | null {
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_TARGET_LENGTH) return "too_long";
  if (/\s/.test(trimmed)) return "spaces";
  if (/[`$();|<>"\\]/.test(trimmed)) return "disallowed";
  return null;
}

// family `host`: letters, digits, dot and hyphen, plus label sanity.
function validateHost(value: string): ValidationCode | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed)) return "host_invalid";
  if (/^[-.]|[-.]$|\.\.|-\.|\.-/.test(trimmed)) return "host_invalid";
  return null;
}

// family `ipv4_literal`: a dotted quad, each octet 1-3 digits and at most 255.
function validateIpv4Literal(value: string): ValidationCode | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9.]/.test(trimmed)) return "ipv4_required";
  const octets = trimmed.split(".");
  if (octets.length !== 4) return "ipv4_invalid";
  for (const oct of octets) {
    if (!/^[0-9]{1,3}$/.test(oct)) return "ipv4_invalid";
    if (Number(oct) > 255) return "ipv4_invalid";
  }
  return null;
}

function validateSlot(slot: SlotKey, value: string): ValidationCode | null {
  return slot === "target_host_1" || slot === "target_host_2"
    ? validateHost(value)
    : validateIpv4Literal(value);
}

// ─── The chain's verdict ────────────────────────────────────────────────────

type LegState = "hostname" | "fallback" | "none" | "unknown";

interface LegVerdict {
  state: LegState;
  index: number;
}

/**
 * Which leg carried the connection, from the SAVED chain. `ping_target` falls
 * back to the first slot when nothing answered, so the daemon's verdict must agree.
 */
function legState(
  conn: ConnectivityStatus | undefined,
  targets: PingProfileTargets,
): LegVerdict {
  if (!conn || conn.status === "unknown") return { state: "unknown", index: -1 };
  if (conn.internet_available !== true || conn.last_family === "none") {
    return { state: "none", index: -1 };
  }
  const index = SLOT_ORDER.findIndex(
    (slot) => targets[slot] !== "" && targets[slot] === conn.ping_target,
  );
  // Reachable but no saved slot matches: the daemon is still probing the previous chain.
  if (index < 0) return { state: "unknown", index: -1 };
  return { state: index < HOSTNAME_LEGS ? "hostname" : "fallback", index };
}

const VERDICT: Record<LegState, { variant: BadgeVariant; glyph: LucideIcon; key: string }> = {
  hostname: { variant: "success", glyph: CircleCheckIcon, key: "verdict.answering" },
  fallback: { variant: "warning", glyph: TriangleAlertIcon, key: "verdict.fallback" },
  none: { variant: "destructive", glyph: CircleSlashIcon, key: "verdict.none" },
  unknown: { variant: "muted", glyph: CircleDashedIcon, key: "verdict.unknown" },
};

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ProbeTargetsCardProps {
  profile: UsePingProfileReturn;
}

export default function ProbeTargetsCard({
  profile,
}: ProbeTargetsCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { targets, isLoading, refresh } = profile;
  const { data: modemStatus, isLoading: statusLoading } = useModemStatus();
  const connectivity = modemStatus?.connectivity;

  const verdict = targets && !statusLoading ? legState(connectivity, targets) : null;
  const spec = verdict ? VERDICT[verdict.state] : null;
  const VerdictGlyph = spec?.glyph;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle as="h2" className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.description`)}
        </CardDescription>
        {isLoading || (targets && !spec) ? (
          <CardAction>
            <Skeleton className={SKELETON_LOCAL.VERDICT} />
          </CardAction>
        ) : spec && verdict && VerdictGlyph ? (
          <CardAction>
            <Badge variant={spec.variant}>
              <VerdictGlyph className="size-3" aria-hidden="true" />
              {t(`${K}.${spec.key}`, { n: verdict.index + 1 })}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {isLoading ? (
          <ProbeTargetsSkeleton />
        ) : !targets ? (
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error.title`)}
            description={t(`${K}.error.body`)}
            onAction={() => void refresh()}
            actionLabel={t(`${K}.error.retry`)}
            actionGlyph={RefreshCwIcon}
            className={CONDITION.SCREEN}
          />
        ) : (
          <ProbeChain
            profile={profile}
            targets={targets}
            answered={verdict?.index ?? -1}
            liveInterval={connectivity?.history_interval_sec}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

function ProbeTargetsSkeleton(): React.JSX.Element {
  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          <span className={cn(EYEBROW, "mr-auto")}>
            <Skeleton className={cn(SKELETON_LOCAL.EYEBROW, "inline-block w-20 align-middle")} />
          </span>
          <Skeleton className={SKELETON_LOCAL.SEGMENT} />
        </div>
        <IntervalRowSkeleton />
      </div>
      {[0, 1].map((group) => (
        <div key={group} className={GROUP}>
          <div className={GROUP_HEAD}>
            <Skeleton className={SKELETON_LOCAL.EYEBROW} />
          </div>
          <div className={ROW_STACK}>
            {[0, 1].map((leg) => (
              <div key={leg} className={LEG.ROW}>
                <Skeleton className={SKELETON_LOCAL.DISC} />
                <Skeleton className={SKELETON_LOCAL.FIELD} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <CardFoot
        liveStatus={false}
        actions={
          <>
            <Skeleton className={SKELETON_LOCAL.ACTION} />
            <Skeleton className={SKELETON_LOCAL.ACTION} />
          </>
        }
      />
    </>
  );
}

function IntervalRowSkeleton(): React.JSX.Element {
  return (
    <div className={ROW.ROOT} aria-hidden="true">
      <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-24")} />
      <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-20")} />
    </div>
  );
}

// ─── The chain ──────────────────────────────────────────────────────────────

interface ProbeChainProps {
  profile: UsePingProfileReturn;
  /** Narrowed: this subtree only renders once the GET has landed. */
  targets: PingProfileTargets;
  /** The answering leg's index in the SAVED chain, or -1. */
  answered: number;
  /** The poller's live probe interval; absent until the status reports one. */
  liveInterval: number | undefined;
}

function ProbeChain({
  profile,
  targets,
  answered,
  liveInterval,
}: ProbeChainProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { isSaving, save, intervalOverride, isClearing, clearInterval } = profile;
  const { saved, markSaved } = useSaveFlash();

  // Edits are HELD and overlaid on the server values, never synced by an effect.
  const [edits, setEdits] = React.useState<Partial<PingProfileTargets>>({});
  const [errors, setErrors] = React.useState<SlotErrors>({});
  const [failed, setFailed] = React.useState(false);

  const values = React.useMemo(() => {
    const out = {} as PingProfileTargets;
    out.profile = edits.profile ?? targets.profile;
    for (const slot of SLOT_ORDER) out[slot] = edits[slot] ?? targets[slot];
    return out;
  }, [edits, targets]);

  const isDirty =
    values.profile !== targets.profile ||
    SLOT_ORDER.some((slot) => values[slot] !== targets[slot]);
  const hasEdits = SLOT_ORDER.some((slot) => edits[slot] !== undefined);
  const hasValidationErrors = SLOT_ORDER.some((slot) => errors[slot]);
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  const setSlot = (slot: SlotKey, value: string) => {
    setEdits((prev) => ({ ...prev, [slot]: value }));
    setErrors((prev) => ({ ...prev, [slot]: validateSlot(slot, value) }));
    setFailed(false);
  };

  const handleClearInterval = async () => {
    try {
      await clearInterval();
      toast.success(t(`${K}.toast.cadence_cleared`));
    } catch {
      toast.error(t(`${K}.cadence_clear_failed`));
    }
  };

  const setProfile = (next: PingProfile) => {
    setEdits((prev) => ({ ...prev, profile: next }));
    setFailed(false);
  };

  const restoreDefaults = () => {
    setEdits({ ...DEFAULT_TARGETS });
    setErrors({});
    setFailed(false);
  };

  const handleSave = async () => {
    if (!canSave) return;

    // Re-validate every slot at submit: one never touched has no error yet.
    const submitErrors: SlotErrors = {};
    for (const slot of SLOT_ORDER) {
      submitErrors[slot] = validateSlot(slot, values[slot]);
    }
    setErrors(submitErrors);
    if (SLOT_ORDER.some((slot) => submitErrors[slot])) return;

    const payload: PingProfileTargets = {
      profile: values.profile,
      target_host_1: values.target_host_1.trim(),
      target_host_2: values.target_host_2.trim(),
      target_ip_1: values.target_ip_1.trim(),
      target_ip_2: values.target_ip_2.trim(),
    };

    try {
      await save(payload);
      // Hold the trimmed values so a normalised save does not read dirty.
      setEdits(payload);
      setFailed(false);
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } catch {
      setFailed(true);
      toast.error(t(`${K}.save_failed`));
    }
  };

  // A config the CGI could not read at all comes back as four blanks.
  const isEmpty = SLOT_ORDER.every((slot) => !targets[slot]);

  if (isEmpty && !hasEdits) {
    return (
      <ConditionBlock
        tone="warning"
        glyph={RouteOffIcon}
        ariaRole="status"
        title={t(`${K}.empty.title`)}
        description={t(`${K}.empty.body`)}
        onAction={restoreDefaults}
        actionLabel={t(`${K}.empty.action`)}
        actionGlyph={RotateCcwIcon}
        className={CONDITION.SCREEN}
      />
    );
  }

  const renderLeg = (slot: SlotKey, index: number) => {
    const fieldId = `probe-target-${slot}`;
    const errorId = `${fieldId}-error`;
    const code = errors[slot] ?? null;
    const isHostLeg = index < HOSTNAME_LEGS;

    return (
      <div key={slot} className={LEG.ROOT}>
        <div className={LEG.ROW}>
          <span
            aria-hidden="true"
            className={cn(LEG.DISC, index === answered ? LEG.DISC_ANSWERED : LEG.DISC_REST)}
          >
            {index + 1}
          </span>
          <label htmlFor={fieldId} className="sr-only">
            {t(`${K}.leg.${LABEL_LEAF[slot]}`)}
          </label>
          <Input
            id={fieldId}
            className={FIELD_MONO}
            value={values[slot]}
            onChange={(event) => setSlot(slot, event.target.value)}
            placeholder={PLACEHOLDER[slot]}
            inputMode={isHostLeg ? undefined : "numeric"}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={code !== null}
            aria-describedby={code ? errorId : undefined}
          />
        </div>
        {code ? (
          <span id={errorId} role="alert" className={FIELD_ERROR}>
            {t(`${K}.validation.${code}`, { max: MAX_TARGET_LENGTH })}
          </span>
        ) : null}
      </div>
    );
  };

  const profileOptions: SegmentedOption<PingProfile>[] = PING_PROFILES.map((p) => ({
    value: p,
    label: t(`${K}.profile.${p}`),
  }));

  // A Watchdog cadence wins over any profile; otherwise an edited profile previews its own.
  const intervalSec =
    intervalOverride ??
    (values.profile === targets.profile
      ? (liveInterval ?? PROFILE_INTERVAL_SEC[values.profile])
      : PROFILE_INTERVAL_SEC[values.profile]);

  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          <span className={cn(EYEBROW, "mr-auto")}>{t(`${K}.group.sensitivity`)}</span>
          <SegmentedField
            value={values.profile}
            onValueChange={setProfile}
            options={profileOptions}
            ariaLabel={t(`${K}.group.sensitivity`)}
            breakpoint="lg"
            glyph={renderCheckGlyph}
          />
        </div>
        <div className={cn(ROW.ROOT, "gap-x-3")}>
          <span className={ROW.KEY}>{t(`${K}.interval.label`)}</span>
          <span className={ROW.VALUE}>
            <Link href={WATCHDOG_HREF} className={cn(ROW.LINK, FOCUS_RING)}>
              {t(intervalOverride === null ? `${K}.interval.value` : `${K}.interval.override`, {
                seconds: intervalSec,
              })}
              <ArrowUpRightIcon aria-hidden="true" className={ROW.LINK_GLYPH} />
            </Link>
          </span>
        </div>
        {intervalOverride !== null ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              disabled={isClearing || isSaving}
              onClick={() => void handleClearInterval()}
            >
              <RotateCcwIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.interval.use_profile`)}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.hostnames`)}</span>
        </div>
        <div className={ROW_STACK}>
          {SLOT_ORDER.slice(0, HOSTNAME_LEGS).map((slot, i) => renderLeg(slot, i))}
        </div>
      </div>

      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.fallback`)}</span>
          <HintIcon label={t(`${K}.fallback_hint_label`)}>
            {t(`${K}.fallback_hint`)}
          </HintIcon>
        </div>
        <div className={ROW_STACK}>
          {SLOT_ORDER.slice(HOSTNAME_LEGS).map((slot, i) =>
            renderLeg(slot, i + HOSTNAME_LEGS),
          )}
        </div>
      </div>

      <CardFoot
        status={
          failed ? (
            <span className={FAILED.ROOT}>
              <TriangleAlertIcon className={FAILED.GLYPH} aria-hidden="true" />
              {t(`${K}.failed`)}
            </span>
          ) : isDirty ? (
            <span className={DELTA}>{t(`${K}.unsaved`)}</span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={restoreDefaults}
            >
              <RotateCcwIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.restore`)}
            </Button>
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.save`)}
              disabled={!canSave}
              size="action"
            />
          </>
        }
      />
    </>
  );
}

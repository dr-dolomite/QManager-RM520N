"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RouteOffIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import type {
  PingProfileTargets,
  UsePingProfileReturn,
} from "@/hooks/use-ping-profile";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ConnectivityStatus } from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_ON_TONAL,
  CONDITION_PANEL,
  DELTA,
  EYEBROW,
  FIELD_ERROR,
  FIELD_MONO,
  GROUP_FILL,
  HOSTNAME_LEGS,
  LABEL_LINE,
  LEG,
  NOTE,
  NOTICE,
  PILL_ACTION,
  PILL_GLYPH,
  RECEIPT_ROW,
  ROW_GROUP,
  SKELETON,
  SKELETON_LOCAL,
  SLOT_ORDER,
  type SlotKey,
} from "./shapes";

// =============================================================================
// Probe Targets — the four endpoints the modem pings, in probe order
// =============================================================================
// The daemon short-circuits on the first leg that answers, so the list IS the
// design: numbered, ordered, with the leg that actually carried the connection
// promoted. Probe cadence and the failure threshold belong to the Watchdog.
// =============================================================================

const K = "connection_quality.targets";

/** The seeded chain, mirroring `scripts/etc/qmanager/ping_profile.json` and the
 *  CGI's own fallbacks, so a restore lands where a fresh install would. */
const DEFAULT_TARGETS: PingProfileTargets = {
  target_host_1: "cloudflare.com",
  target_host_2: "google.com",
  target_ip_1: "1.1.1.1",
  target_ip_2: "8.8.8.8",
};

const PLACEHOLDER: Record<SlotKey, string> = DEFAULT_TARGETS;

/** The group's header strip: eyebrow left, the restore pill pushed right. */
const GROUP_HEAD = "flex items-center gap-3 px-1";

/** Label leaf per slot; the key says which leg, never the config key name. */
const LABEL_LEAF: Record<SlotKey, string> = {
  target_host_1: "host_1",
  target_host_2: "host_2",
  target_ip_1: "ip_1",
  target_ip_2: "ip_2",
};

// ─── Validation — mirrors validate_target() in the CGI ──────────────────────
//
// The backend re-validates every save regardless; this exists so the user sees
// the same verdict inline that the CGI would have returned. A client laxer than
// the server produces a rejection naming a slot the user cannot see, so the two
// charsets below are kept deliberately identical to the shell's.

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

// family `host` — letters, digits, dot and hyphen, plus label sanity: no
// leading or trailing dot or hyphen, no doubled dot, no hyphen beside a dot.
function validateHost(value: string): ValidationCode | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed)) return "host_invalid";
  if (/^[-.]|[-.]$|\.\.|-\.|\.-/.test(trimmed)) return "host_invalid";
  return null;
}

// family `ipv4_literal` — digits and dot only, and a dotted quad of four
// octets, each 1-3 digits and no greater than 255.
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

// ─── The answering leg ──────────────────────────────────────────────────────

/**
 * Mirrors `legState()` in `status-band.tsx` rule for rule — the card and the
 * band must never disagree about which leg carried the connection.
 *
 * `ping_target` falls back to the first configured slot when nothing has
 * answered, so a match alone is not proof: the daemon's own reachability
 * verdict has to agree, and an empty slot never matches.
 */
function answeredIndex(
  conn: ConnectivityStatus | undefined,
  targets: PingProfileTargets,
): number {
  if (!conn || conn.internet_available !== true) return -1;
  if (conn.last_family === "none") return -1;
  return SLOT_ORDER.findIndex(
    (slot) => targets[slot] !== "" && targets[slot] === conn.ping_target,
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ProbeTargetsCardProps {
  profile: UsePingProfileReturn;
}

export default function ProbeTargetsCard({
  profile,
}: ProbeTargetsCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { targets, isLoading, error, refresh } = profile;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle as="h2" className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        {isLoading ? (
          <ProbeTargetsSkeleton />
        ) : !targets ? (
          // A failed read, or an envelope carrying no settings at all. The form
          // would otherwise fill itself with its own defaults and look saved.
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error.title`)}
            description={
              error
                ? t(`${K}.error.body_detail`, { detail: error })
                : t(`${K}.error.body`)
            }
            onAction={() => void refresh()}
            actionLabel={t(`${K}.error.retry`)}
            actionGlyph={RefreshCwIcon}
            className={CONDITION_PANEL.SCREEN}
          />
        ) : (
          <ProbeChain profile={profile} targets={targets} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

/**
 * Real `ROW_GROUP` / `LEG.ROOT` / `NOTE.ROOT` boxes wearing slivers, so every
 * height RESOLVES to the loaded view's rather than being asserted against it.
 */
function ProbeTargetsSkeleton(): React.JSX.Element {
  return (
    <>
      <div className={GROUP_HEAD}>
        <Skeleton className={cn(SKELETON.TILE.EYEBROW, "w-28")} />
        <Skeleton className={cn(SKELETON.TIME.ACTION, "ml-auto")} />
      </div>

      <div className={cn(ROW_GROUP, GROUP_FILL)}>
        {SLOT_ORDER.map((slot) => (
          <div key={slot} className={LEG.ROOT}>
            <div className={LEG.MAIN}>
              <Skeleton className={SKELETON_LOCAL.LEG.DISC} />
              <div className={LEG.TEXT}>
                <Skeleton className={cn(SKELETON_LOCAL.LEG.LABEL, "w-36")} />
                <Skeleton className={cn(SKELETON_LOCAL.LEG.KIND, "w-full")} />
              </div>
            </div>
            <div className={LEG.CONTROL}>
              <Skeleton className={SKELETON_LOCAL.LEG.FIELD} />
            </div>
          </div>
        ))}
      </div>

      {/* Both notes. Absent, the card understates itself by two tonal blocks. */}
      {[0, 1].map((note) => (
        <div key={note} className={NOTE.ROOT}>
          <Skeleton className={cn(SKELETON_LOCAL.LEG.KIND, "w-full")} />
          <Skeleton className={cn(SKELETON_LOCAL.LEG.KIND, "mt-1 w-2/3")} />
        </div>
      ))}

      {/* The receipt row. Absent, the card jumps by a control height plus gap. */}
      <div className={cn(RECEIPT_ROW, "items-center gap-3")}>
        <Skeleton className={cn(SKELETON.TILE.EYEBROW, "w-16")} />
        <Skeleton className={SKELETON.TIME.ACTION} />
      </div>
    </>
  );
}

// ─── The chain ──────────────────────────────────────────────────────────────

interface ProbeChainProps {
  profile: UsePingProfileReturn;
  /** Narrowed: this subtree only renders once the GET has landed. */
  targets: PingProfileTargets;
}

function ProbeChain({ profile, targets }: ProbeChainProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { isSaving, saveError, save } = profile;
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  // Edits are HELD and overlaid on the server values, never synced into local
  // state by an effect — a re-read landing mid-typing would eat the edit.
  const [edits, setEdits] = React.useState<Partial<PingProfileTargets>>({});
  const [errors, setErrors] = React.useState<SlotErrors>({});

  const values = React.useMemo(() => {
    const out = {} as PingProfileTargets;
    for (const slot of SLOT_ORDER) out[slot] = edits[slot] ?? targets[slot];
    return out;
  }, [edits, targets]);

  const isDirty = SLOT_ORDER.some((slot) => values[slot] !== targets[slot]);
  const hasEdits = SLOT_ORDER.some((slot) => edits[slot] !== undefined);
  const hasValidationErrors = SLOT_ORDER.some((slot) => errors[slot]);
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  // Promotion reports the SAVED chain, not the draft: a half-typed field is not
  // what the daemon is probing (The State-Honesty Rule).
  const answered = answeredIndex(modemStatus?.connectivity, targets);

  const setSlot = (slot: SlotKey, value: string) => {
    setEdits((prev) => ({ ...prev, [slot]: value }));
    setErrors((prev) => ({ ...prev, [slot]: validateSlot(slot, value) }));
  };

  const restoreDefaults = () => {
    setEdits({ ...DEFAULT_TARGETS });
    setErrors({});
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
      target_host_1: values.target_host_1.trim(),
      target_host_2: values.target_host_2.trim(),
      target_ip_1: values.target_ip_1.trim(),
      target_ip_2: values.target_ip_2.trim(),
    };

    try {
      await save(payload);
      // Hold the trimmed values, so a save that normalised whitespace does not
      // leave the row reading dirty against what the server now has.
      setEdits(payload);
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } catch {
      // `saveError` carries it as a standing notice above the rows; a toast
      // here would announce the same failure twice.
    }
  };

  // The CGI defaults each slot independently, so this should not happen — but a
  // config it could not read at all comes back as four blanks, and four empty
  // boxes with no explanation is the worst possible reading of that.
  const isEmpty = SLOT_ORDER.every((slot) => !targets[slot]);
  const restoreLabel = t(`${K}.restore`);

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
        className={CONDITION_PANEL.SCREEN}
      />
    );
  }

  const unsaved = t(`${K}.unsaved`);

  return (
    <>
      {/* A failed write says so and steps aside. It never replaces the form the
          user has just filled in. */}
      {saveError ? (
        <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
          <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
          <span className={NOTICE.STACK}>
            <span className={NOTICE.TEXT}>{t(`${K}.save_failed`)}</span>
            <span className={NOTICE.DETAIL}>{saveError}</span>
          </span>
        </div>
      ) : null}

      <div className={GROUP_HEAD}>
        <span className={cn(EYEBROW, "mr-auto min-w-0")}>
          {t(`${K}.group_head`)}
        </span>
        <Button
          type="button"
          variant="tonal-neutral"
          className={PILL_ACTION}
          onClick={restoreDefaults}
        >
          <RotateCcwIcon className={PILL_GLYPH} aria-hidden="true" />
          {restoreLabel}
        </Button>
      </div>

      {/* No `initial`/`animate`: this container is a child of the page cascade
          and must stay on the parent's clock. */}
      <motion.div className={cn(ROW_GROUP, GROUP_FILL)} variants={staggerRows}>
        {SLOT_ORDER.map((slot, index) => {
          const fieldId = `probe-target-${slot}`;
          const kindId = `${fieldId}-kind`;
          const errorId = `${fieldId}-error`;
          const code = errors[slot] ?? null;
          const isAnswered = index === answered;
          const isHostLeg = index < HOSTNAME_LEGS;

          return (
            <motion.div
              key={slot}
              variants={staggerRowItem}
              className={cn(
                LEG.ROOT,
                LEG.TRANSITION,
                isAnswered ? LEG.ANSWERED : LEG.REST,
              )}
            >
              <div className={LEG.MAIN}>
                <span
                  className={cn(
                    LEG.DISC,
                    LEG.TRANSITION,
                    isAnswered ? LEG.DISC_ANSWERED : LEG.DISC_REST,
                  )}
                >
                  <span className={LEG.NUMBER}>{index + 1}</span>
                </span>
                <div className={LEG.TEXT}>
                  <span className={LABEL_LINE}>
                    <label htmlFor={fieldId} className={LEG.LABEL}>
                      {t(`${K}.leg.${LABEL_LEAF[slot]}`)}
                    </label>
                    {isAnswered ? (
                      // A stock `info` chip is `primary-container`, byte-identical
                      // to the promoted row, so it is re-grounded on the row's ink.
                      <Badge variant="info" className={CHIP_ON_TONAL}>
                        <CheckCircle2Icon className="size-3" aria-hidden="true" />
                        {t(`${K}.answered`)}
                      </Badge>
                    ) : null}
                  </span>
                  <span
                    id={kindId}
                    className={cn(LEG.KIND, isAnswered && LEG.KIND_ANSWERED)}
                  >
                    {isHostLeg ? t(`${K}.kind.host`) : t(`${K}.kind.ip`)}
                  </span>
                  {code ? (
                    <span id={errorId} role="alert" className={FIELD_ERROR}>
                      {t(`${K}.validation.${code}`, { max: MAX_TARGET_LENGTH })}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={LEG.CONTROL}>
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
                  aria-describedby={code ? `${kindId} ${errorId}` : kindId}
                />
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <div className={NOTE.ROOT}>
        <p className={NOTE.TEXT}>{t(`${K}.note_fallback`)}</p>
      </div>

      <div className={NOTE.ROOT}>
        <p className={NOTE.TEXT}>
          {t(`${K}.note_watchdog`)}{" "}
          <Link href="/monitoring/watchdog" className={NOTE.LINK}>
            {t(`${K}.note_watchdog_link`)}
          </Link>
        </p>
      </div>

      {/* The marker RESERVES its box, so promoting the card from clean to dirty
          moves nothing: `invisible` also drops it from the a11y tree. */}
      <div className={cn(RECEIPT_ROW, "items-center gap-3")}>
        <span className={cn(DELTA.ROOT, !isDirty && DELTA.CLEAN)}>
          {unsaved}
        </span>
        <SaveButton
          onClick={handleSave}
          isSaving={isSaving}
          saved={saved}
          label={t(`${K}.save`)}
          disabled={!canSave}
          className={PILL_ACTION}
        />
      </div>
    </>
  );
}

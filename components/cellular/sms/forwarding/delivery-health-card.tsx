"use client";

import React from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import {
  CARD_SHELL,
  ForwardingCardHeader,
  ForwardingCardHeaderSkeleton,
  PILL_ACTION,
} from "./sms-forwarding-card";

// =============================================================================
// DeliveryHealthCard — the status companion to SmsForwardingCard.
//
// Reports the live relay state, a preview of what the recipient receives, the
// test action (which verifies the SAVED path — the CGI reads the target from
// server config, never from the request body), and the daemon's
// delivery-failure history. Shares the lifted useSmsForwarding hook.
//
// Everything on this card reports SAVED state. Nothing here reads the control
// card's in-progress form, which is the State-Honesty Rule: a status surface
// that mirrored a half-typed number would report a relay path that does not
// exist yet, and the Send test button would then verify a different path from
// the one it appears to be pointing at.
// =============================================================================

// The preview teaches the relay FORMAT, so the "From" sender is a sample
// inbound number — not the saved target, who is the one RECEIVING this bubble.
const SAMPLE_SENDER = "+15550142";

type Health = "active" | "issue" | "unconfigured" | "off";

type HealthSpec = {
  /** The tonal block: a role container plus that container's own `on-` ink. */
  container: string;
  /** The Glyph-Disc Rule: a filled circle on the role's STRONG fill. */
  disc: string;
  glyph: MaterialSymbolName;
};

/**
 * Four states, four tones, four glyphs — and no two share either channel.
 *
 * The glyph is the load-bearing half. `success-container` and
 * `warning-container` measure 1.03:1 apart and are the same surface under
 * deuteranopia, so an operator distinguishing "relaying" from "failing to
 * relay" is reading the mark, not the fill (DESIGN.md > The
 * Every-Chip-Has-A-Glyph Rule, whose "two states in the same slot must never
 * share a glyph either" clause the outgoing card broke twice: `unconfigured`
 * and `issue` both drew `warning`, and `unconfigured` and `off` both read as a
 * neutral wash).
 *
 * `unconfigured` takes the BRAND container rather than a fourth functional
 * tone. It is not a fault and not a failure — the daemon is enabled and idle,
 * waiting on one field the user is one click away from filling in — which is
 * exactly the "in progress, reports rather than alarms" role, and the
 * Info-Is-Brand Rule says that role renders as `primary-container`. `edit`
 * names the remaining work.
 *
 * `off` is the deliberately-inactive state, so it takes the neutral pair from
 * `condition-screen.tsx`'s own `neutral` tone rather than inventing one. Failure
 * would be `destructive`; a disabled relay is not a failure.
 *
 * Every fill here is an EXPLICIT container token. The outgoing card drew these
 * as a low-alpha wash over the role's strong fill (plus a bare `bg-muted`) — an
 * alpha on a fill is a request to the CANVAS rather than to the token, so the
 * same block rendered a different colour in a card than it would in a dialog,
 * and in dark mode, where these role fills are LIGHT, the wash all but vanished
 * (DESIGN.md > The Explicit-Tone Rule, The Paired-Theme Rule).
 */
const HEALTH_SPEC: Record<Health, HealthSpec> = {
  active: {
    container: "bg-success-container text-on-success-container",
    disc: "bg-success text-success-foreground",
    glyph: "check_circle",
  },
  issue: {
    container: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "warning",
  },
  unconfigured: {
    container: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    glyph: "edit",
  },
  off: {
    container: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "do_not_disturb_on",
  },
};

/** States whose detail line names the destination rather than describing itself. */
const SHOWS_DESTINATION: Record<Health, boolean> = {
  active: true,
  issue: true,
  unconfigured: false,
  off: false,
};

// -----------------------------------------------------------------------------
// Shared geometry — consumed by the skeleton below, so the two cannot drift.
// -----------------------------------------------------------------------------

const HEALTH_SHAPE = {
  BLOCK: "flex items-center gap-3.5 rounded-tile px-5 py-4",
  NOTICE: "flex items-start gap-3 rounded-tile px-4 py-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  SMALL_DISC: "grid size-8 flex-none place-items-center rounded-pill",
  EYEBROW: "text-xs font-semibold text-on-surface-variant",
  BUBBLE: "rounded-tile bg-surface-container px-4 py-3",
  HINT: "text-xs leading-relaxed text-on-surface-variant text-pretty",
} as const;

/**
 * Pinned block heights, in px, spent as inline styles at both ends.
 *
 * STATE: py-4 (32) + the taller of the 44px disc and the two-line text column
 * (20px label + 19px detail) = 76 natural, floored at 80 so a wrapped detail
 * line still matches. BUBBLE: py-3 (24) + a 19px line box = 43, floored at 44.
 * NOTICE: py-3.5 (28) + the taller of the 32px disc and 39px of text = 67,
 * floored at 68.
 */
const HEALTH_HEIGHT = {
  STATE: 80,
  BUBBLE: 44,
  NOTICE: 68,
} as const;

// =============================================================================
// Card
// =============================================================================

const DeliveryHealthCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSendingTest,
    isClearing,
    error,
    sendTest,
    clearFailures,
    refresh,
  } = fwd;

  const handleSendTest = async () => {
    const success = await sendTest();
    if (success) {
      toast.success(t("sms.forwarding.toast.test_success"));
    } else {
      toast.error(error || t("sms.forwarding.toast.test_error"));
    }
  };

  const handleClear = async () => {
    const success = await clearFailures();
    if (success) {
      toast.success(t("sms.forwarding.toast.clear_success"));
    } else {
      toast.error(error || t("sms.forwarding.toast.clear_error"));
    }
  };

  // --- Loading ---------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        <ForwardingCardHeaderSkeleton />
        <CardContent className="px-0">
          <span className="sr-only">
            {t("sms.forwarding.states.loading_sr")}
          </span>
          <div className="flex flex-col gap-5">
            <Skeleton
              className="w-full rounded-tile"
              style={{ height: HEALTH_HEIGHT.STATE }}
            />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28 rounded-inline" />
              <Skeleton
                className="w-full rounded-tile"
                style={{ height: HEALTH_HEIGHT.BUBBLE }}
              />
              <Skeleton className="h-4 w-52 rounded-inline" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[2.625rem] w-32 rounded-pill" />
              <Skeleton className="h-4 w-60 rounded-inline" />
            </div>
            <Skeleton
              className="w-full rounded-tile"
              style={{ height: HEALTH_HEIGHT.NOTICE }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error -----------------------------------------------------------------
  // The card previously fell back to its own skeleton whenever `data` was null,
  // so a first fetch that never landed left a permanently loading card — an
  // instrument that reports "still working on it" about a request that already
  // failed. `destructive` because the path to the device is genuinely down.
  //
  // The glyph is `error`, distinct from all four health glyphs above: a state
  // screen and a health block occupy the same slot in the user's attention.
  if (!data) {
    return (
      <Card className={CARD_SHELL}>
        <ForwardingCardHeader
          title={t("sms.forwarding.card.health.title")}
          description={t("sms.forwarding.card.health.description")}
        />
        <CardContent className="px-0">
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t("sms.forwarding.states.error.title")}
            description={error ?? t("sms.forwarding.states.error.description")}
            onRetry={() => refresh()}
            retryLabel={t("sms.forwarding.states.retry")}
            className="rounded-tile px-6 py-10"
          />
        </CardContent>
      </Card>
    );
  }

  const { enabled, target_phone } = data.settings;
  const failures = data.failures ?? [];
  const failureCount = data.failure_count ?? failures.length;

  // One state machine drives the focal block, its detail line, and the test
  // affordance — so the card cannot contradict itself.
  const health: Health = !enabled
    ? "off"
    : !target_phone
      ? "unconfigured"
      : failureCount > 0
        ? "issue"
        : "active";

  const spec = HEALTH_SPEC[health];
  const canSendTest = enabled && !!target_phone && !isSendingTest;

  return (
    <Card className={CARD_SHELL}>
      <ForwardingCardHeader
        title={t("sms.forwarding.card.health.title")}
        description={t("sms.forwarding.card.health.description")}
      />
      <CardContent className="px-0">
        {/* Variants only, so this stack inherits the card's slot in the page
            cascade rather than starting its own clock. */}
        <motion.div className="flex flex-col gap-5" variants={staggerRows}>
          {/* --- Focal state ------------------------------------------------ */}
          {/* The single status surface for this feature. There is deliberately
              no duplicate header chip: two indicators for one fact is two things
              that can disagree during a poll. */}
          <motion.div
            variants={staggerRowItem}
            className={cn(HEALTH_SHAPE.BLOCK, spec.container)}
            style={{ minHeight: HEALTH_HEIGHT.STATE }}
          >
            <span className={cn(HEALTH_SHAPE.DISC, spec.disc)}>
              <MaterialSymbol name={spec.glyph} filled size={24} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-base leading-tight font-semibold">
                {t(`sms.forwarding.health.${health}.label`)}
              </p>
              {SHOWS_DESTINATION[health] ? (
                <p className="min-w-0 truncate text-[13px] leading-[1.45] opacity-90">
                  {t("sms.forwarding.health.forwarding_to")}{" "}
                  {/* A phone number is machine truth, and it changes while the
                      card is on screen — mono, tabular. */}
                  <span className="font-mono font-semibold tabular-nums">
                    {target_phone}
                  </span>
                </p>
              ) : (
                <p className="min-w-0 text-[13px] leading-[1.45] text-pretty opacity-90">
                  {t(`sms.forwarding.health.${health}.description`)}
                </p>
              )}
            </div>
          </motion.div>

          {/* --- Recipient preview ------------------------------------------ */}
          <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
            <p className={HEALTH_SHAPE.EYEBROW}>
              {t("sms.forwarding.preview.eyebrow")}
            </p>
            <div
              className={HEALTH_SHAPE.BUBBLE}
              style={{ minHeight: HEALTH_HEIGHT.BUBBLE }}
            >
              <p className="text-[13px] leading-[1.45]">
                <span className="font-mono text-on-surface-variant">
                  {t("sms.forwarding.preview.from", { sender: SAMPLE_SENDER })}
                </span>{" "}
                <span className="text-on-surface">
                  {t("sms.forwarding.preview.sample_body")}
                </span>
              </p>
            </div>
            {/* Says out loud what the bubble could otherwise imply: the number
                in the "From" line is a sample INBOUND sender, and the saved
                number is the recipient of this message, not its author. */}
            <p className={HEALTH_SHAPE.HINT}>
              {t("sms.forwarding.preview.note")}
            </p>
          </motion.div>

          {/* --- Test the SAVED relay path ---------------------------------- */}
          <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
            <Button
              type="button"
              variant="tonal"
              className={cn(PILL_ACTION, "w-fit")}
              disabled={!canSendTest}
              onClick={handleSendTest}
            >
              {isSendingTest ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={16}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t("sms.forwarding.buttons.sending")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="send" size={16} />
                  {t("sms.forwarding.buttons.send_test")}
                </>
              )}
            </Button>
            {/* A control that cannot currently work explains why rather than
                sitting there dead. */}
            <p className={HEALTH_SHAPE.HINT}>
              {canSendTest
                ? t("sms.forwarding.test.hint_ready")
                : t("sms.forwarding.test.hint_blocked")}
            </p>
          </motion.div>

          {/* --- Delivery failures ------------------------------------------ */}
          {/* Rendered conditionally rather than through `AnimatePresence`. The
              outgoing card animated `height` on exit, which breaks both the
              Transform-Only Rule and the Enter-Only Rule: failures clearing
              means the condition is gone, and that should feel immediate. */}
          <motion.div variants={staggerRowItem}>
            {failures.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div
                  role="alert"
                  className={cn(
                    HEALTH_SHAPE.NOTICE,
                    "bg-destructive-container text-on-destructive-container",
                  )}
                >
                  <span
                    className={cn(
                      HEALTH_SHAPE.SMALL_DISC,
                      "bg-destructive text-destructive-foreground",
                    )}
                  >
                    <MaterialSymbol name="error" filled size={18} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-sm leading-[1.35] font-semibold">
                      {t("sms.forwarding.failures.title", {
                        count: failures.length,
                      })}
                    </p>
                    <p className="text-[13px] leading-[1.45] text-pretty opacity-90">
                      {t("sms.forwarding.failures.description")}
                    </p>
                    <ul className="flex flex-col gap-1 text-xs">
                      {failures.slice(0, 5).map((f, i) => (
                        <li
                          key={`${f.sender}-${f.timestamp}-${i}`}
                          className="flex flex-wrap items-baseline gap-x-2"
                        >
                          <span className="font-mono font-semibold">
                            {f.sender ||
                              t("sms.forwarding.failures.unknown_sender")}
                          </span>
                          <span className="font-mono tabular-nums opacity-90">
                            {f.timestamp}
                          </span>
                          {f.last_error && (
                            <span className="min-w-0 opacity-90">
                              — {f.last_error}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {/* The action sits on the CARD, outside the tonal block. Drawing
                    it inside would need the container's own ink at a low alpha,
                    which is the layered-translucency this rebuild is removing. */}
                <Button
                  type="button"
                  variant="tonal-neutral"
                  className={cn(PILL_ACTION, "w-fit")}
                  disabled={isClearing}
                  onClick={handleClear}
                >
                  {isClearing ? (
                    <>
                      <MaterialSymbol
                        name="progress_activity"
                        size={16}
                        className="animate-spin motion-reduce:animate-none"
                      />
                      {t("sms.forwarding.buttons.clearing")}
                    </>
                  ) : (
                    <>
                      <MaterialSymbol name="close" size={16} />
                      {t("sms.forwarding.buttons.clear_failures")}
                    </>
                  )}
                </Button>
              </div>
            ) : (
              // The empty state for the failure log. `done_all` rather than
              // `check_circle`, which the `active` health block above already
              // owns — the two sit in one column and must not share a mark.
              <div
                className={cn(
                  HEALTH_SHAPE.NOTICE,
                  "items-center bg-surface-container",
                )}
                style={{ minHeight: HEALTH_HEIGHT.NOTICE }}
              >
                <span
                  className={cn(
                    HEALTH_SHAPE.SMALL_DISC,
                    "bg-surface-container-high text-on-surface-variant",
                  )}
                >
                  <MaterialSymbol name="done_all" filled size={18} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm leading-tight font-semibold">
                    {t("sms.forwarding.empty.failures.title")}
                  </p>
                  <p className="text-[13px] leading-[1.45] text-on-surface-variant text-pretty">
                    {t("sms.forwarding.empty.failures.description")}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default DeliveryHealthCard;

"use client";

import React from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  CONDITION_TONE,
  ConditionScreen,
} from "@/components/cellular/condition-screen";
import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import {
  CARD_SHELL,
  HEALTH_HEIGHT,
  HEALTH_SHAPE,
  HEALTH_SKELETON,
  HEALTH_TONE,
  PILL_ACTION,
} from "../shapes";
import {
  ForwardingCardHeader,
  ForwardingCardHeaderSkeleton,
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
//
// A note on the two `tonal` buttons below: a secondary-standing action is the
// `Button` `tonal` variant (never `variant="secondary"` — shadcn's
// `--secondary` is a NEUTRAL in this codebase and byte-identical to
// `surface-container`, so a "secondary" button inside a card is a surface
// pretending to be a control); a neutral action on a plain card surface is
// `tonal-neutral`. Never `variant="ghost"` plus a hand-rolled `bg-*` override —
// `ghost`'s own `dark:hover:bg-accent/50` outranks a plain `hover:` override on
// CSS specificity, so the override silently loses in dark mode.
// =============================================================================

// The preview teaches the relay FORMAT, so the "From" sender is a sample
// inbound number — not the saved target, who is the one RECEIVING this bubble.
const SAMPLE_SENDER = "+15550142";

type Health = "active" | "issue" | "unconfigured" | "off";

/**
 * WHAT IS GENUINELY PER-HEALTH: THE GLYPH. NOTHING ELSE.
 *
 * This map used to carry a `container` and a `disc` class string per state —
 * four pairs that were byte-identical to `condition-screen.tsx`'s `success`,
 * `warning`, `primary` and `neutral` tones, plus two more pairs written inline
 * further down this file. Seven verbatim copies of one table. DESIGN.md is
 * explicit: "Tone maps key onto the exported types, never onto a class string",
 * because that is the exact shape that let four rival signal-quality maps drift
 * until one of them painted an unread antenna green.
 *
 * So tone now keys onto `ConditionTone` via `HEALTH_TONE` in `../shapes` (which
 * `satisfies Record<string, ConditionTone>`, so a tone with no matching role is
 * a BUILD failure) and resolves its classes through `CONDITION_TONE`. What
 * cannot be derived is the mark:
 *
 * The glyph is the load-bearing half. `success-container` and
 * `warning-container` measure 1.03:1 apart and are the same surface under
 * deuteranopia, so an operator distinguishing "relaying" from "failing to
 * relay" is reading the mark, not the fill (DESIGN.md > The
 * Every-Chip-Has-A-Glyph Rule, whose "two states in the same slot must never
 * share a glyph either" clause forbids reusing any of these four on the failure
 * notice or its empty state — hence `error` and `done_all` down there).
 *
 * On the tone choices themselves: `unconfigured` takes the BRAND container
 * rather than a fourth functional tone. It is not a fault and not a failure —
 * the daemon is enabled and idle, waiting on one field the user is one click
 * away from filling in — which is the "in progress, reports rather than alarms"
 * role, and the Info-Is-Brand Rule renders that as `primary-container`. `edit`
 * names the remaining work. `off` is the deliberately-inactive state and takes
 * `neutral`; failure would be `destructive`, and a disabled relay is not a
 * failure.
 */
const HEALTH_GLYPH: Record<Health, MaterialSymbolName> = {
  active: "check_circle",
  issue: "warning",
  unconfigured: "edit",
  off: "do_not_disturb_on",
};

/** States whose detail line names the destination rather than describing itself.
 *  The asymmetry is intentional, and it is why `health.active` and `health.issue`
 *  carry a `.label` but deliberately no `.description` key. */
const SHOWS_DESTINATION: Record<Health, boolean> = {
  active: true,
  issue: true,
  unconfigured: false,
  off: false,
};

/**
 * The empty twin of the failure banner.
 *
 * The populated branch is a `TonalBanner`, which carries three tones —
 * warning, destructive, info — and no neutral. A cleared failure log is not a
 * status in any of those roles, so this branch mirrors the banner's BOX
 * (`rounded-field`, `px-4`, `py-[14px]`, `items-start`, a 32px disc) on
 * `surface-container` rather than borrowing a functional role it has not
 * earned. It lives here rather than in `shapes.ts` because it is the negative
 * of a shared primitive, not family geometry.
 */
const EMPTY_NOTICE =
  "flex w-full items-start gap-3 rounded-field bg-surface-container px-4 py-[14px]";

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
  // Every sliver below is a line box from `HEALTH_SKELETON` / `HEALTH_HEIGHT`,
  // never a number restated here. The two the old skeleton guessed were both
  // wrong: `h-4` (16px) against a hint whose real line box is 19.5px, and a
  // hardcoded `w-32` for a button whose width is locale-dependent.
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
              <Skeleton className={HEALTH_SKELETON.EYEBROW} />
              <Skeleton
                className="w-full rounded-tile"
                style={{ height: HEALTH_HEIGHT.BUBBLE }}
              />
              <Skeleton className={HEALTH_SKELETON.HINT} />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className={HEALTH_SKELETON.ACTION} />
              <Skeleton className={HEALTH_SKELETON.HINT} />
            </div>
            <Skeleton
              className="w-full rounded-field"
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

  // Tone -> role -> classes. Three lookups, one table, zero class strings here.
  const tone = CONDITION_TONE[HEALTH_TONE[health]];
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
              that can disagree during a poll.

              `role="status"` is scoped to THIS block. It used to live on the
              page root, where a 20s poll that rebuilds the data object
              re-rendered both card subtrees and gave a screen reader an
              indefinite announcement loop — and contradicted the product's
              stated channel for save results (the sonner toast every caller
              already fires). Here it announces exactly one thing: the relay
              changing state. */}
          <motion.div
            role="status"
            variants={staggerRowItem}
            className={cn(HEALTH_SHAPE.BLOCK, tone.container)}
            style={{ minHeight: HEALTH_HEIGHT.STATE }}
          >
            <span className={cn(HEALTH_SHAPE.DISC, tone.disc)}>
              <MaterialSymbol name={HEALTH_GLYPH[health]} filled size={24} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className={HEALTH_SHAPE.STATE_LABEL}>
                {t(`sms.forwarding.health.${health}.label`)}
              </p>
              {SHOWS_DESTINATION[health] ? (
                <p className={cn(HEALTH_SHAPE.STATE_DETAIL, "min-w-0 truncate")}>
                  {t("sms.forwarding.health.forwarding_to")}{" "}
                  {/* A phone number is a machine identifier, so it stays mono
                      and tabular (The Machine-Voice Rule). */}
                  <span className="font-mono font-semibold tabular-nums">
                    {target_phone}
                  </span>
                </p>
              ) : (
                <p
                  className={cn(
                    HEALTH_SHAPE.STATE_DETAIL,
                    "min-w-0 text-pretty",
                  )}
                >
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
              {/* Body step. Bare `text-sm` deliberately keeps Tailwind's own
                  20px line box, which is the figure `HEALTH_HEIGHT.BUBBLE`
                  (py-3 + 20) is derived from — `leading-relaxed` here would
                  push the bubble 3px past its own constant. */}
              <p className="text-sm">
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
              means the condition is gone, and that should feel immediate.

              BOTH branches of this slot carry `HEALTH_HEIGHT.NOTICE`. Only the
              empty one used to, so a single slot was governed by two rules and
              the paired cards' baselines moved the moment a failure landed. */}
          <motion.div variants={staggerRowItem}>
            {failures.length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* `TonalBanner`, not a re-implementation of it.
                    This notice previously matched the primitive on layout,
                    padding, disc, glyph size, title step and body step, and
                    differed in three ways that were all regressions: it took
                    `rounded-tile` (28px), so a banner out-rounded the surface it
                    sits on; it had no `animate-banner-in` entrance; and it had
                    no `break-words`, which the primitive documents as
                    load-bearing precisely because banners carry raw device
                    strings — and `f.last_error` is a daemon error string with no
                    break opportunities, rendered inside a card with `overflow`
                    ancestors. The primitive is Material end to end, so there is
                    no icon-boundary cost on a `/cellular/` route.

                    The wrapper exists only to pin the slot height: `TonalBanner`
                    takes a `className`, not a `style`, and the floor is a shared
                    constant rather than a number retyped as an arbitrary class. */}
                <div className="flex" style={{ minHeight: HEALTH_HEIGHT.NOTICE }}>
                  <TonalBanner
                    tone="destructive"
                    icon="error"
                    role="alert"
                    title={
                      // The count changes under the reader on a 20s poll, so it
                      // is the interface speaking a live figure: sans +
                      // `tabular-nums`, never mono (The Machine-Voice Rule).
                      // `withSlot` keeps it ONE plural key with the translator
                      // in control of word order — see
                      // `components/auth/interpolation-slot.tsx` for why this
                      // beats both a split key and a `<Trans>` with markup.
                      withSlot(
                        t("sms.forwarding.failures.title", {
                          count: failures.length,
                          value: SLOT,
                        }),
                        <span className="tabular-nums">{failures.length}</span>,
                      )
                    }
                  >
                    {t("sms.forwarding.failures.description")}
                    <ul className="mt-2 flex flex-col gap-1 text-xs">
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
                            <span className="min-w-0 break-words opacity-90">
                              — {f.last_error}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </TonalBanner>
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
                className={EMPTY_NOTICE}
                style={{ minHeight: HEALTH_HEIGHT.NOTICE }}
              >
                <span
                  className={cn(
                    HEALTH_SHAPE.SMALL_DISC,
                    CONDITION_TONE.neutral.disc,
                  )}
                >
                  <MaterialSymbol name="done_all" filled size={18} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className={HEALTH_SHAPE.SECTION_TITLE}>
                    {t("sms.forwarding.empty.failures.title")}
                  </p>
                  <p className={HEALTH_SHAPE.HINT}>
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

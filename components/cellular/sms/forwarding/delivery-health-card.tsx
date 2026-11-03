"use client";

import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

import { CONDITION_TONE } from "@/components/cellular/condition-screen";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
// Material Symbols, not lucide: `/cellular/**` is inside the Material boundary.
// `size` is explicit at every call site because MaterialSymbol sets `fontSize`
// inline, which no utility class (including `Button`'s svg mirror) reaches.
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import {
  CARD_FOOT_GUTTER,
  CARD_SHELL,
  HEALTH_HEIGHT,
  HEALTH_SHAPE,
  HEALTH_SKELETON,
  HEALTH_TONE,
} from "./shapes";

// =============================================================================
// DeliveryHealthCard — the status companion to SmsForwardingCard.
//
// Reports the live relay state, a preview of what the recipient receives, the
// test action (which verifies the SAVED path: the CGI reads the target from the
// stored settings, never from the request body) and the daemon's
// delivery-failure history. Shares the lifted useSmsForwarding hook.
//
// Everything on this card reports SAVED state. Nothing here reads the control
// card's in-progress form — a status surface that mirrored a half-typed number
// would report a relay path that does not exist yet, and Send test would then
// verify a different path from the one it appears to point at.
// =============================================================================

// The preview teaches the relay FORMAT, so the sender is a sample inbound
// number, not the saved target (who RECEIVES this bubble).
const SAMPLE_SENDER = "+15550142";
const K = "sms.forwarding.health";

type Health = "active" | "issue" | "unconfigured" | "off";

/**
 * The glyph is the only genuinely per-health fact; the container and disc
 * classes resolve through `HEALTH_TONE` -> `CONDITION_TONE`, so a tone with no
 * matching role is a build failure, not a silent one. Four states, four
 * distinct glyphs: `success` and `warning` containers measure ~1.03:1 apart, so
 * the mark is the channel that survives grayscale and CVD, not the fill.
 */
const HEALTH_GLYPH: Record<Health, MaterialSymbolName> = {
  active: "check_circle",
  issue: "warning",
  unconfigured: "edit",
  off: "do_not_disturb_on",
};

const DeliveryHealthCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSendingTest,
    isClearing,
    sendTest,
    clearFailures,
  } = fwd;

  const handleSendTest = async () => {
    const result = await sendTest();
    if (result.ok) toast.success(t(`${K}.toast_test_success`));
    else toast.error(result.error);
  };

  const handleClear = async () => {
    const result = await clearFailures();
    if (result.ok) toast.success(t(`${K}.toast_clear_success`));
    else toast.error(result.error);
  };

  const header = (
    <CardHeader>
      <CardTitle>{t(`${K}.card_title`)}</CardTitle>
      <CardDescription>{t(`${K}.card_description`)}</CardDescription>
    </CardHeader>
  );

  // --- Loading ---------------------------------------------------------------
  // Every sliver is a line box from `HEALTH_SKELETON` / `HEALTH_HEIGHT`, so the
  // card holds its height and the handoff never snaps.
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent>
          <span className="sr-only">{t("sms.forwarding.sms.loading_label")}</span>
          <div className="flex flex-col gap-5" aria-hidden="true">
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
            </div>
            <Skeleton
              className="w-full rounded-field"
              style={{ height: HEALTH_HEIGHT.NOTICE }}
            />
          </div>
        </CardContent>
        <CardFoot
          className={CARD_FOOT_GUTTER}
          liveStatus={false}
          aria-hidden="true"
          status={<Skeleton className={HEALTH_SKELETON.HINT} />}
          actions={<Skeleton className={HEALTH_SKELETON.ACTION} />}
        />
      </Card>
    );
  }

  // The page renders the read failure once, in place of both cards.
  if (!data) return null;

  const { enabled, target_phone } = data.settings;
  const failures = data.failures ?? [];
  const failureCount = Math.max(data.failure_count, failures.length);

  // One state machine drives the focal block, its detail line and the test gate,
  // so the card cannot contradict itself.
  const health: Health = !enabled
    ? "off"
    : !target_phone
      ? "unconfigured"
      : failureCount > 0
        ? "issue"
        : "active";

  const tone = CONDITION_TONE[HEALTH_TONE[health]];
  const canSendTest = enabled && !!target_phone && !isSendingTest;
  const showsDestination = health === "active" || health === "issue";

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent>
        {/* Variants only, so this stack inherits the card's slot in the page
            cascade rather than starting its own clock. */}
        <motion.div className="flex flex-col gap-5" variants={staggerRows}>
          {/* --- Focal state ------------------------------------------------ */}
          {/* The single status surface for this feature; deliberately no
              duplicate header chip, because two indicators for one fact can
              disagree during a poll. `role="status"` is scoped to THIS block,
              not the page root: the hook polls every 20 s and rebuilds the data
              object each time, so a page-root live region would announce on a
              loop. Here it announces one thing, the relay changing state. */}
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
                {t(`${K}.state_${health}`)}
              </p>
              {showsDestination ? (
                <p className={cn(HEALTH_SHAPE.STATE_DETAIL, "min-w-0 truncate")}>
                  {t(`${K}.destination_label`)}{" "}
                  {/* A phone number is an opaque string you compare and dial,
                      so it stays mono and tabular. */}
                  <span className="font-mono font-semibold tabular-nums">
                    {target_phone}
                  </span>
                </p>
              ) : (
                <p className={cn(HEALTH_SHAPE.STATE_DETAIL, "min-w-0 text-pretty")}>
                  {t(
                    health === "off"
                      ? `${K}.destination_none`
                      : `${K}.state_unconfigured_description`,
                  )}
                </p>
              )}
            </div>
          </motion.div>

          {/* --- Recipient preview ------------------------------------------ */}
          <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <p className={HEALTH_SHAPE.EYEBROW}>{t(`${K}.preview_label`)}</p>
              {/* Says what the bubble could otherwise imply: the number in the
                  From line is a sample inbound sender, and the saved number is
                  the recipient of this message, not its author. */}
              <HintIcon label={t(`${K}.preview_hint_label`)}>
                {t(`${K}.preview_hint`)}
              </HintIcon>
            </div>
            <div
              className={HEALTH_SHAPE.BUBBLE}
              style={{ minHeight: HEALTH_HEIGHT.BUBBLE }}
            >
              <p className="text-sm leading-snug">
                <span className="font-mono text-on-surface-variant">
                  {t(`${K}.preview_from`, { sender: SAMPLE_SENDER })}
                </span>{" "}
                <span className="text-on-surface">
                  {t(`${K}.preview_sample_body`)}
                </span>
              </p>
            </div>
          </motion.div>

          {/* --- Delivery failures ------------------------------------------ */}
          {/* Conditional rather than `AnimatePresence`: failures clearing means
              the condition is gone, and that should feel immediate, not animate
              its own exit. The empty state is a quiet row (glyph and ink, no
              container): the expected state renders quiet, and the fill is
              saved for the row that needs finding. */}
          <motion.div variants={staggerRowItem}>
            {failures.length > 0 ? (
              <div className="flex flex-col gap-3">
                <TonalBanner
                  tone="destructive"
                  icon="error"
                  role="alert"
                  title={
                    // The count changes under the reader on a 20 s poll, so it
                    // is the interface speaking a live figure: sans, tabular.
                    <span className="tabular-nums">
                      {t(`${K}.failures_title`, { count: failures.length })}
                    </span>
                  }
                >
                  {t(`${K}.failures_description`)}
                  {/* The banner body is inline content, so a real `<ul>` here
                      is invalid nesting. Spans with list roles keep the list
                      semantics as phrasing content. */}
                  <span role="list" className="mt-2 flex flex-col gap-1 text-xs">
                    {failures.slice(0, 5).map((f, i) => (
                      <span
                        role="listitem"
                        key={`${f.sender}-${f.timestamp}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-mono font-semibold">
                          {f.sender || t(`${K}.failures_unknown_sender`)}
                        </span>
                        <span className="tabular-nums opacity-90">
                          {f.timestamp}
                        </span>
                        {f.last_error ? (
                          <span className="min-w-0 break-words opacity-90">
                            ({f.last_error})
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                </TonalBanner>
                <Button
                  type="button"
                  variant="tonal-neutral"
                  className="w-fit"
                  disabled={isClearing}
                  onClick={handleClear}
                >
                  <MaterialSymbol
                    name={isClearing ? "progress_activity" : "close"}
                    size={16}
                    className={
                      isClearing
                        ? "animate-spin motion-reduce:animate-none"
                        : undefined
                    }
                  />
                  {t(`${K}.clear_button`)}
                </Button>
              </div>
            ) : (
              // `done_all` is distinct from the `active` block's `check_circle`
              // above: the two sit in one column and must not share a mark.
              <div
                className={HEALTH_SHAPE.QUIET_ROW}
                style={{ minHeight: HEALTH_HEIGHT.NOTICE }}
              >
                <MaterialSymbol name="done_all" size={18} />
                {t(`${K}.failures_empty`)}
              </div>
            )}
          </motion.div>
        </motion.div>
      </CardContent>

      {/* Test the SAVED relay path. A control that cannot currently work
          explains why on the foot's status edge rather than sitting there dead. */}
      <CardFoot
        className={CARD_FOOT_GUTTER}
        status={
          canSendTest || isSendingTest
            ? t(`${K}.test_hint`)
            : t(`${K}.test_disabled_hint`)
        }
        actions={
          <Button
            type="button"
            variant="tonal-neutral"
            size="action"
            disabled={!canSendTest}
            onClick={handleSendTest}
          >
            <MaterialSymbol
              name={isSendingTest ? "progress_activity" : "send"}
              size={18}
              className={
                isSendingTest
                  ? "animate-spin motion-reduce:animate-none"
                  : undefined
              }
            />
            {isSendingTest ? t(`${K}.test_sending`) : t(`${K}.test_button`)}
          </Button>
        }
      />
    </Card>
  );
};

export default DeliveryHealthCard;

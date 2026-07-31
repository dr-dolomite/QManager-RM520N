"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import { type SmsForwardingData } from "@/types/sms-forwarding";

// =============================================================================
// SmsForwardingCard — the control surface for the daemon-backed SMS relay.
//
// Setup only: enable toggle + destination number + save. Live status, the
// recipient preview, the test action, and delivery failures all live in the
// companion DeliveryHealthCard, which shares this card's lifted hook. The split
// is the State-Honesty Rule made structural: this card holds the half-edited
// FORM, the health card reports the SAVED state, and neither is allowed to
// speak for the other.
// =============================================================================

// -----------------------------------------------------------------------------
// Shared geometry
//
// Exported so the health card, both skeletons and the page grid consume the same
// strings rather than restating them (DESIGN.md > The Skeleton-Mirror Rule). The
// two cards sit side by side as a PAIR, so any divergence in shell, header shape
// or row height shows up immediately as a broken baseline.
// -----------------------------------------------------------------------------

/** Copied verbatim from `antenna-statistics/tech-card.tsx` — the anchor-card shell. */
export const CARD_SHELL =
  "h-full gap-5 rounded-hero border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]";

/** The two-up card grid. A container query, never a viewport breakpoint. */
export const CARD_GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";

/** Equal heights are explicit, so a card whose data hasn't landed isn't shorter. */
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

/**
 * The card header's line boxes, for both skeletons.
 *
 * `CardTitle` ships `leading-none`, so `text-xl` is a 20px box rather than the
 * 24px a naive `h-6` would guess; the 13px description resolves to a 20px box.
 */
export const HEADER_SHAPE = {
  TITLE: "h-5 w-44",
  DESCRIPTION: "h-5 w-60",
  GAP: "gap-1",
} as const;

/**
 * The pill action, shared with `radio/page-header.tsx`'s `PILL_ACTION`. 42px is
 * the button height on the role scale and clears the 44px coarse-pointer target
 * once its 2px focus ring is counted.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/**
 * A tonal (secondary-standing) action: `primary-container` with its own ink.
 * Never `variant="secondary"` — shadcn's `--secondary` is a NEUTRAL in this
 * codebase and byte-identical to `surface-container`, so a "secondary" button
 * inside a card is a surface pretending to be a control.
 */
export const TONAL_ACTION =
  "bg-primary-container text-on-primary-container hover:bg-primary-container/80";

/** A neutral action on a plain card surface. */
export const NEUTRAL_ACTION =
  "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-high/80";

export const FORM_SHAPE = {
  /** The enable row, as a metric-row pill. 44px, so it is a coarse-pointer target. */
  TOGGLE_ROW:
    "flex h-11 w-full items-center gap-3 rounded-pill bg-surface-container px-4",
  TOGGLE_LABEL: "min-w-0 flex-auto truncate text-sm font-semibold",
  /**
   * The input, restyled off the shadcn default per the Migration Delta: 20px
   * radius, 42px tall, `surface-container` fill, no visible border at rest.
   * `font-mono tabular-nums` because a phone number is machine truth.
   */
  INPUT:
    "h-[2.625rem] max-w-sm rounded-field border-0 bg-surface-container px-4 font-mono text-sm tabular-nums shadow-none",
  LABEL: "text-sm font-semibold",
  HELP: "text-on-surface-variant text-[13px] leading-relaxed text-pretty",
  /** Tinted text on a PLAIN card takes `-on-surface`, never the container ink. */
  ERROR: "text-destructive-on-surface text-[13px] leading-relaxed",
} as const;

/** Skeleton line boxes for the form, mirroring FORM_SHAPE above. */
export const FORM_SKELETON = {
  TOGGLE: "h-11 w-full rounded-pill",
  LABEL: "h-5 w-28 rounded-inline",
  INPUT: "h-[2.625rem] w-full max-w-sm rounded-field",
  HELP: "h-5 w-56 rounded-inline",
  ACTION: "h-[2.625rem] w-36 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// The shared card header
//
// One implementation for both cards, which is what makes the Truncation-Pair
// Rule structural rather than a review item: every text node here carries
// `min-w-0 truncate`, so Italian cannot wrap one card's header to two lines
// while its sibling stays at one and breaks the paired baseline.
// -----------------------------------------------------------------------------

export function ForwardingCardHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <CardHeader className={cn("px-0", HEADER_SHAPE.GAP)}>
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle className="min-w-0 truncate text-xl font-semibold">
          {title}
        </CardTitle>
        <CardDescription className="min-w-0 truncate text-[13px]">
          {description}
        </CardDescription>
      </div>
    </CardHeader>
  );
}

/** The header skeleton, built from the same constants as the header above. */
export function ForwardingCardHeaderSkeleton() {
  return (
    // The real `CardHeader`, not a hand-rolled div: it ships
    // `grid-rows-[auto_auto]` and that second (empty) track still emits its row
    // gutter, so a flex-column stand-in silently comes out short.
    <CardHeader className={cn("px-0", HEADER_SHAPE.GAP)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className={cn(HEADER_SHAPE.TITLE, "rounded-inline")} />
        <Skeleton className={cn(HEADER_SHAPE.DESCRIPTION, "rounded-inline")} />
      </div>
    </CardHeader>
  );
}

// =============================================================================
// Control card
// =============================================================================

// E.164-ish: optional leading +, first digit 1-9, total 7-15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

const SmsForwardingCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    refresh,
  } = fwd;

  const { saved, markSaved } = useSaveFlash();
  const [prevData, setPrevData] = useState<SmsForwardingData | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [targetPhone, setTargetPhone] = useState("");

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setIsEnabled(data.settings.enabled);
    setTargetPhone(data.settings.target_phone);
  }

  // Only validate while enabling — turning forwarding off must never be blocked
  // by a stale/invalid number left in the field.
  const phoneError =
    isEnabled && targetPhone && !PHONE_REGEX.test(targetPhone)
      ? t("sms.forwarding.fields.target_invalid")
      : null;

  const isDirty = data
    ? isEnabled !== data.settings.enabled ||
      targetPhone !== data.settings.target_phone
    : false;

  const canSave = !phoneError && isDirty && !isSaving && !isSendingTest;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const success = await saveSettings({
      enabled: isEnabled,
      target_phone: targetPhone,
    });
    if (success) {
      markSaved();
      toast.success(t("sms.forwarding.toast.save_success"));
    } else {
      toast.error(error || t("sms.forwarding.toast.save_error"));
    }
  };

  // --- Loading ---------------------------------------------------------------
  // Mirrors the real form geometry (toggle pill → labelled input → pill action)
  // from FORM_SKELETON, so the card holds its height and the handoff is a pure
  // crossfade with no snap.
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        <ForwardingCardHeaderSkeleton />
        <CardContent className="px-0">
          <span className="sr-only">
            {t("sms.forwarding.states.loading_sr")}
          </span>
          <div className="flex flex-col gap-5">
            <Skeleton className={FORM_SKELETON.TOGGLE} />
            <div className="flex flex-col gap-2">
              <Skeleton className={FORM_SKELETON.LABEL} />
              <Skeleton className={FORM_SKELETON.INPUT} />
              <Skeleton className={FORM_SKELETON.HELP} />
            </div>
            <Skeleton className={FORM_SKELETON.ACTION} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error -----------------------------------------------------------------
  // The first fetch never landed, so there is no saved state to control. The
  // form is replaced rather than rendered empty: an enable toggle sitting at
  // `off` with a blank number would ASSERT that forwarding is disabled, when the
  // truth is that we could not read the config at all.
  //
  // `rounded-tile` overrides the primitive's `rounded-hero`: a 40px screen inside
  // a 40px card out-rounds nothing but reads as a second card, and the
  // Radius-Follows-Size Rule wants the inner shape a step down.
  if (!data) {
    return (
      <Card className={CARD_SHELL}>
        <ForwardingCardHeader
          title={t("sms.forwarding.card.relay.title")}
          description={t("sms.forwarding.card.relay.description")}
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

  // --- Loaded ----------------------------------------------------------------
  return (
    <Card className={CARD_SHELL}>
      <ForwardingCardHeader
        title={t("sms.forwarding.card.relay.title")}
        description={t("sms.forwarding.card.relay.description")}
      />
      <CardContent className="px-0">
        {/* `variants` only — no `initial`/`animate`. The stack inherits the
            card's slot in the page cascade, so these rows arrive behind THIS
            card rather than at t=0 alongside its sibling's rows. Restating the
            clock here detaches it. */}
        <motion.form
          className="flex flex-col gap-5"
          onSubmit={handleSave}
          variants={staggerRows}
        >
          {/* Enable toggle */}
          <motion.div variants={staggerRowItem}>
            <Field orientation="horizontal" className={FORM_SHAPE.TOGGLE_ROW}>
              <FieldLabel
                htmlFor="sms-forwarding-enabled"
                className={FORM_SHAPE.TOGGLE_LABEL}
              >
                {t("sms.forwarding.fields.enabled_label")}
              </FieldLabel>
              <Switch
                id="sms-forwarding-enabled"
                className="shrink-0"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </Field>
          </motion.div>

          {/* Target phone */}
          <motion.div variants={staggerRowItem}>
            <Field className="gap-2">
              <FieldLabel
                htmlFor="sms-forwarding-target"
                className={FORM_SHAPE.LABEL}
              >
                {t("sms.forwarding.fields.target_label")}
              </FieldLabel>
              <Input
                id="sms-forwarding-target"
                type="tel"
                inputMode="tel"
                placeholder={t("sms.forwarding.fields.target_placeholder")}
                className={FORM_SHAPE.INPUT}
                value={targetPhone}
                onChange={(e) => setTargetPhone(e.target.value)}
                disabled={!isEnabled}
                required={isEnabled}
                aria-invalid={!!phoneError}
                aria-describedby={
                  phoneError
                    ? "sms-forwarding-target-error"
                    : "sms-forwarding-target-desc"
                }
                autoComplete="tel"
              />
              {/* Validation is stated INLINE, not only in a toast: a toast that
                  has already dismissed cannot tell you which field is wrong. */}
              {phoneError ? (
                <FieldError
                  id="sms-forwarding-target-error"
                  className={FORM_SHAPE.ERROR}
                >
                  {phoneError}
                </FieldError>
              ) : (
                <FieldDescription
                  id="sms-forwarding-target-desc"
                  className={FORM_SHAPE.HELP}
                >
                  {t("sms.forwarding.fields.target_hint")}
                </FieldDescription>
              )}
            </Field>
          </motion.div>

          {/* Save. `SaveButton` owns the loading animation and the product's one
              sanctioned overshoot (the 1.03 confirmation check). */}
          <motion.div variants={staggerRowItem}>
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
              label={t("sms.forwarding.buttons.save")}
              className={cn(PILL_ACTION, "w-fit")}
            />
          </motion.div>
        </motion.form>
      </CardContent>
    </Card>
  );
};

export default SmsForwardingCard;

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
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import { type SmsForwardingData } from "@/types/sms-forwarding";
import {
  CARD_DESCRIPTION,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_HELP,
  FIELD_LABEL,
  FIELD_SHELL,
  FIELD_SHELL_ON_FILL,
  FORM_SKELETON,
  HEADER_SHAPE,
  INLINE_ERROR,
  INLINE_ERROR_ON_FILL,
  PILL_ACTION,
  ROW_DIRTY,
  TOGGLE_LABEL,
  TOGGLE_ROW,
} from "../shapes";

// =============================================================================
// SmsForwardingCard — the control surface for the daemon-backed SMS relay.
//
// Setup only: enable toggle + destination number + save. Live status, the
// recipient preview, the test action, and delivery failures all live in the
// companion DeliveryHealthCard, which shares this card's lifted hook. The split
// is the State-Honesty Rule made structural: this card holds the half-edited
// FORM, the health card reports the SAVED state, and neither is allowed to
// speak for the other.
//
// EVERY GEOMETRY STRING ON THIS SURFACE NOW COMES FROM `../shapes`. This file
// used to EXPORT the card shell, the page grid, the header shape, the pill
// action and the form geometry, and the health card imported them sideways from
// its sibling — so a component was another component's geometry source, and the
// page grid was owned by one of the two cards it lays out. `components/cellular/
// sms/shapes.ts` owns all of it now (DESIGN.md > Layout > "A per-family
// `shapes.ts`"); what still crosses between the two files is the shared HEADER
// COMPONENT below, which is a component, not a constant.
// =============================================================================

/**
 * The on-fill twin of `FIELD_HELP`.
 *
 * `shapes.ts` ships this pair for the error line (`INLINE_ERROR` /
 * `INLINE_ERROR_ON_FILL`) but not for the hint, so it is composed here from the
 * same two facts: the brand ink, and the 90% step that separates supporting copy
 * from the control it describes. When the destination row promotes, a hint that
 * kept `text-on-surface-variant` would be reading as neutral prose directly
 * under a `bg-primary` field — the cross-pair `shapes.ts` names as the most
 * common way the dirty-row pattern goes wrong.
 */
const FIELD_HELP_ON_FILL = cn(
  FIELD_HELP,
  "text-on-primary-container opacity-90",
);

// -----------------------------------------------------------------------------
// The shared card header
//
// One implementation for both cards, which is what makes the Truncation-Pair
// Rule structural rather than a review item: every text node here carries
// `min-w-0 truncate` (via `CARD_TITLE` / `CARD_DESCRIPTION`), so Italian cannot
// wrap one card's header to two lines while its sibling stays at one and breaks
// the paired baseline.
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
        <CardTitle className={CARD_TITLE}>{title}</CardTitle>
        <CardDescription className={CARD_DESCRIPTION}>
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

  // Dirtiness is derived PER CONTROL, not once for the card.
  //
  // It was previously a single `isDirty` spent only on `canSave`, so the entire
  // surface-level signal for "you have an uncommitted edit" was a button that
  // stopped being disabled. The settings family's rule is that rows are neutral
  // at rest and PROMOTE to `primary-container` when dirty — a pending edit is
  // the brand acting, an action awaiting commit, and explicitly NOT a status
  // (a dirty row is neither "good" nor "warning", so no functional role may
  // stand in for pendingness).
  const enabledDirty = !!data && isEnabled !== data.settings.enabled;
  const phoneDirty = !!data && targetPhone !== data.settings.target_phone;
  const isDirty = enabledDirty || phoneDirty;

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
  // `rounded-tile` overrides the primitive's `rounded-hero`: the Radius-Follows-
  // Size Rule wants the inner shape a step down from the card that holds it.
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
          {/* Enable toggle. The row itself carries the promotion; the label
              inside it declares no ink of its own, so it follows the container
              rather than becoming a cross-pair when the row flips. */}
          <motion.div variants={staggerRowItem}>
            <Field
              orientation="horizontal"
              className={cn(
                TOGGLE_ROW,
                enabledDirty ? ROW_DIRTY : "bg-surface-container",
              )}
            >
              <FieldLabel
                htmlFor="sms-forwarding-enabled"
                className={TOGGLE_LABEL}
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

          {/* Target phone.

              A RAW `<input>`, not `components/ui/input.tsx`. The primitive ships
              `dark:bg-input/30`, which compiles to `&:is(.dark *)` — specificity
              (0,2,0) against a bare `bg-surface-container`'s (0,1,0) — and
              tailwind-merge cannot fold the two because they sit in different
              modifier scopes. Every field on this card was rendering `input/30`
              in dark mode instead of the container step. It looks approximately
              right, which is exactly why it survived review. The primitive also
              ships `md:text-sm` (a VIEWPORT breakpoint leaking into a
              container-query surface) and `transition-[color,box-shadow]` with
              no duration (an off-scale 150ms). `FIELD_SHELL` closes all three,
              and is composed with a width and nothing else. */}
          <motion.div variants={staggerRowItem}>
            <Field className="gap-2">
              <FieldLabel
                htmlFor="sms-forwarding-target"
                className={FIELD_LABEL}
              >
                {t("sms.forwarding.fields.target_label")}
              </FieldLabel>
              <input
                id="sms-forwarding-target"
                type="tel"
                inputMode="tel"
                placeholder={t("sms.forwarding.fields.target_placeholder")}
                className={cn(
                  phoneDirty ? FIELD_SHELL_ON_FILL : FIELD_SHELL,
                  "max-w-sm",
                )}
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
                  has already dismissed cannot tell you which field is wrong.
                  Both spellings follow the field's promotion. */}
              {phoneError ? (
                <FieldError
                  id="sms-forwarding-target-error"
                  className={phoneDirty ? INLINE_ERROR_ON_FILL : INLINE_ERROR}
                >
                  {phoneError}
                </FieldError>
              ) : (
                <FieldDescription
                  id="sms-forwarding-target-desc"
                  className={phoneDirty ? FIELD_HELP_ON_FILL : FIELD_HELP}
                >
                  {t("sms.forwarding.fields.target_hint")}
                </FieldDescription>
              )}
            </Field>
          </motion.div>

          {/* Save. `SaveButton` owns the loading animation and the product's one
              sanctioned overshoot (the 1.03 confirmation check). It stays
              mounted in every state so its grid width-lock holds, and it is
              never wrapped in `AnimatePresence`. Its glyphs are lucide, which is
              correct: it is a route-agnostic primitive that the Icon-Boundary
              Rule pins to lucide wherever it mounts. */}
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

"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConditionScreen } from "@/components/cellular/condition-screen";

// =============================================================================
// EmptyProfileViewComponent — the TRUE empty state
// =============================================================================
// Reached only when there is nothing saved AND no carrier suggestion to offer
// (see the gate in `custom-profile-view.tsx`). It replaces the Saved Profiles
// card entirely rather than nesting inside it, because with neither a roster
// nor a recommendation there is no list for it to sit in — the card would be a
// header over a void.
//
// The OTHER emptiness — nothing saved but a suggestion matched — renders as a
// dashed row INSIDE the list and lives in `custom-profile-view.tsx`, because it
// still has content to frame. Two different emptinesses, two different
// surfaces, deliberately.
//
// WHY `ConditionScreen` AND NOT THE `Empty` PRIMITIVE. This is a condition the
// page is reporting about itself, which is exactly the shape
// `components/cellular/condition-screen.tsx` exists for, and routing through it
// buys the surface the `CONDITION_TONE` container/disc pair rather than a
// hand-written dashed box. `neutral` is the honest tone: having no profiles is
// not a failure, not a warning and not a success, so it takes the neutral
// container and a `surface-container-high` disc.
//
// THE COPY IS SCOPED TO WHAT IS ACTUALLY TRUE. "No profiles saved" — never "no
// active profile". The two are different facts and this card only knows the
// first one: the modem may well be running a perfectly good configuration that
// simply was not saved as a profile, and the hero above is what reports that.
//
// NO LOCAL `initial`/`animate`. This component is returned from the same slot
// as the Saved Profiles card, which the page wraps in its own `staggerItem`.
// Declaring an entrance here would run a second, unsynchronised clock inside
// the page cascade — the nested-motion rule. The parent carries it.
// =============================================================================

interface EmptyProfileViewProps {
  onRefresh?: () => void;
}

const EmptyProfileViewComponent = ({ onRefresh }: EmptyProfileViewProps) => {
  const { t } = useTranslation("cellular");

  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>{t("custom_profiles.empty_state.card_title")}</CardTitle>
        <CardDescription>
          {t("custom_profiles.empty_state.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex h-full items-center justify-center">
        {/* `rounded-tile` (28px): an inner block inside a `rounded-card` (36px)
            card may not carry its parent's radius, and the primitive's own
            `rounded-hero` (40px) would out-round the card hosting it.
            `ariaRole="status"` — a polite report, not an alert: nothing has
            gone wrong. */}
        <ConditionScreen
          tone="neutral"
          glyph="sim_card"
          ariaRole="status"
          title={t("custom_profiles.empty_state.teaching_headline")}
          /* The teaching copy, not the one-liner: a user who has never made a
             profile does not yet know what one bundles, and this is the only
             place on the surface that can tell them. */
          description={t("custom_profiles.empty_state.teaching_body")}
          onRetry={onRefresh}
          retryLabel={t("custom_profiles.empty_state.refresh")}
          className="w-full rounded-tile py-10"
        />
      </CardContent>
    </Card>
  );
};

export default EmptyProfileViewComponent;

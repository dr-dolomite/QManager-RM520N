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
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { PILL_ACTION } from "@/components/cellular/custom-profiles/shapes";

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
//
// WHY THE CREATE BUTTON IS A SIBLING OF THE CONDITION SCREEN, NOT INSIDE IT.
// `ConditionScreen`'s one action slot is `onRetry`/`retryLabel`, and it is
// hard-wired to a `refresh` glyph on a low-contrast `spec.action` wash — a
// RETRY affordance by construction. It cannot express a filled primary create
// button, and widening it would touch nine call sites across four other
// features to serve one. So Refresh stays the screen's retry and Create sits
// beneath it as a peer, which is also the shipped composition in
// `settings/fplmn-settings/fplmn-card.tsx`.
//
// That ordering is the honest one for this card, too: the screen's own copy
// teaches what a profile IS, and the button is the answer to it. Reading order
// runs explanation -> action, and the visual weight matches — a filled pill
// under a tonal wash.
// =============================================================================

interface EmptyProfileViewProps {
  /** Re-run the list GET. Omit to render no retry affordance. */
  onRefresh?: () => void;
  /**
   * Open the profile editor on a blank profile. Omit and NO create button
   * renders — the same clean degradation `onRefresh` already has, so a caller
   * that has no editor to open never ships a dead pill.
   */
  onNewProfile?: () => void;
}

const EmptyProfileViewComponent = ({
  onRefresh,
  onNewProfile,
}: EmptyProfileViewProps) => {
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
        <div className="flex w-full flex-col gap-4">
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
            className="rounded-tile py-10"
          />

          {/* THE CARD'S ONLY REAL EXIT. Before this, the single affordance on
              the true empty state was Refresh — a button that reloads a list
              the user already knows is empty. `cta_new` was already written
              and already translated in all five packs with no call site; this
              adopts it rather than minting a sixth spelling of "New Profile".

              Default (filled) variant, per the Primary-Action rule: this is the
              one thing a user with zero profiles came here to do, and an
              outline pill under a tonal wash would read as the quieter of the
              two buttons on the card. */}
          {onNewProfile && (
            <div className="flex justify-center">
              <Button type="button" className={PILL_ACTION} onClick={onNewProfile}>
                <MaterialSymbol name="add" size={17} />
                {t("custom_profiles.empty_state.cta_new")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EmptyProfileViewComponent;

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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
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
// The mock's empty state (lines 360–387) is the OTHER empty case: nothing saved
// but a suggestion matched. That one renders as a dashed row INSIDE the list
// and lives in `custom-profile-view.tsx`, because it still has content to
// frame. Two different emptinesses, two different surfaces, deliberately.
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
        {/* The dashed stroke is semantic here — this codebase's vocabulary for
            a slot with nothing in it yet — not a compensation for a weak fill,
            so No-Hairline-On-Fill does not apply. `rounded-card`: an inner
            block that behaves as its own surface, never out-rounding the card
            that hosts it. */}
        <Empty className="border-outline rounded-card border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MaterialSymbol name="badge" size={24} aria-hidden />
            </EmptyMedia>
            <EmptyTitle>
              {t("custom_profiles.empty_state.teaching_headline")}
            </EmptyTitle>
            {/* The teaching copy, not the one-liner: a user who has never made
                a profile does not yet know what one bundles, and this is the
                only place on the surface that can tell them. */}
            <EmptyDescription className="text-pretty">
              {t("custom_profiles.empty_state.teaching_body")}
            </EmptyDescription>
          </EmptyHeader>
          {onRefresh && (
            <EmptyContent>
              <Button
                variant="tonal"
                className={cn(PILL_ACTION, "h-9 px-4 text-[0.8125rem]")}
                onClick={onRefresh}
              >
                <MaterialSymbol name="refresh" size={16} aria-hidden />
                {t("custom_profiles.empty_state.refresh")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </CardContent>
    </Card>
  );
};

export default EmptyProfileViewComponent;

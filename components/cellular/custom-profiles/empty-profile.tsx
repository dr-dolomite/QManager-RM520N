"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";

// The registry's empty state, rendered INSIDE the Saved Profiles card: nothing
// is saved and no suggestion matched. A resting state, so neutral + `status`.

interface EmptyProfileProps {
  /** Opens the new-profile wizard; the button renders only when given. */
  onAdd?: () => void;
}

const EmptyProfileComponent = ({ onAdd }: EmptyProfileProps) => {
  const { t } = useTranslation("cellular");
  return (
    <div className="flex flex-col items-center gap-4">
      <ConditionScreen
        tone="neutral"
        glyph="sim_card"
        ariaRole="status"
        title={t("custom_profiles.empty_state.teaching_headline")}
        description={t("custom_profiles.empty_state.teaching_body")}
        className="w-full rounded-tile py-10"
      />
      {onAdd ? (
        <Button size="action" onClick={onAdd}>
          <MaterialSymbol name="add" size={18} />
          {t("custom_profiles.empty_state.cta_new")}
        </Button>
      ) : null}
    </div>
  );
};

export default EmptyProfileComponent;

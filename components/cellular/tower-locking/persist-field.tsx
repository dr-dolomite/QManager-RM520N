"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import type { TowerModemState } from "@/types/tower-locking";

import { LEG_KEYS, type TowerLeg } from "./shapes";

// =============================================================================
// TowerPersistField — one radio's "Keep after reboot", for a leg card's footer
// =============================================================================
// Shows the modem's read-back, not the config, and writes on change. An
// unread value selects neither option rather than claiming "Off".
// =============================================================================

const K = "tower_locking";

type PersistValue = "off" | "on" | "";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    size={16}
    className={className}
    aria-hidden="true"
  />
);

export interface TowerPersistFieldProps {
  leg: TowerLeg;
  modemState: TowerModemState | null;
  disabled: boolean;
  onSetPersist: (on: boolean) => void;
}

export function TowerPersistField({
  leg,
  modemState,
  disabled,
  onSetPersist,
}: TowerPersistFieldProps) {
  const { t } = useTranslation("cellular");
  const labelId = `tower-persist-${leg}-label`;

  const unread = !modemState || modemState.persist_read_ok === false;
  const on = leg === "lte" ? modemState?.persist_lte : modemState?.persist_nr;
  const value: PersistValue = unread ? "" : on ? "on" : "off";

  return (
    <div className="flex items-center gap-3">
      <span
        id={labelId}
        className="text-on-surface-variant text-[13px] font-medium"
      >
        {t(`${K}.card.persist_label`)}
      </span>
      <div role="group" aria-labelledby={labelId}>
        <SegmentedField<PersistValue>
          value={value}
          onValueChange={(v) => {
            if (v !== "" && v !== value) onSetPersist(v === "on");
          }}
          options={[
            { value: "off", label: t("state.off", { ns: "common" }) },
            { value: "on", label: t("state.on", { ns: "common" }) },
          ]}
          ariaLabel={t(`${K}.card.persist_aria`, {
            leg: t(LEG_KEYS[leg].short),
          })}
          disabled={disabled || unread}
          breakpoint="never"
          glyph={renderCheckGlyph}
        />
      </div>
    </div>
  );
}

export default TowerPersistField;

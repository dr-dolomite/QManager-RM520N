"use client";

import * as React from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  CfunMode,
  ModePref,
  Nr5gMode,
  RoamPref,
  SimDetect,
  SimSlot,
  WritableSettingKey,
} from "@/types/cellular-settings";
import type { UseCellularSettingsReturn } from "@/hooks/use-cellular-settings";

import PendingSaveBar from "./pending-save-bar";
import SegmentedField, { type SegmentedOption } from "./segmented-field";
import SettingRow from "./setting-row";
import {
  CARD_PAD,
  CARD_SHELL,
  PILL_ACTION,
  ROW_GROUP,
  SETTING_ROW,
} from "./shapes";

// =============================================================================
// Modem Radio Settings — the write surface
// =============================================================================
// Six settings as grouped rows rather than six labels over six dropdowns.
//
// ON THE OPTION SETS. Three of these rows have more options than the approved
// comp drew. That is deliberate and it is a correctness fix, not scope creep:
// the comp dropped `LTE:NR5G` ("LTE + 5G") from Preferred Network Type and
// `roam_pref=3` ("Partner networks") from Roaming. The backend still accepts
// and reports both. A modem already sitting on either value would have rendered
// a control with NO matching option — blank, or snapped to a neighbour — and
// the diff would then have treated the user's untouched row as a pending change
// and written the wrong value on the next save. Every value the modem can
// report must be representable in the control that reports it.
//
// ON "RADIO OFF" vs THE COMP'S "LOW POWER". CFUN=0 is minimum functionality: it
// deselects the SIM as well as the radio. CFUN=4 (airplane) keeps the SIM
// powered with RF off. The comp labelled CFUN=0 "Low power" and sat it between
// Normal and Airplane, which reads as a middle power tier — no such state
// exists, and the real difference between the two is SIM power, not wattage.
// The incumbent label ("Radio Off") was already correct and is kept. It also
// avoids colliding with the removed Low Power Mode feature by name.
// =============================================================================

export interface CellularSettingsCardProps {
  form: UseCellularSettingsReturn;
}

export function CellularSettingsCard({ form }: CellularSettingsCardProps) {
  const { t } = useTranslation("cellular");
  const {
    draft,
    settings,
    dirtyFields,
    isLoading,
    isSaving,
    applyPhase,
    changeCount,
    lastApply,
    setField,
    discard,
    saveSettings,
    refresh,
  } = form;

  const [saved, setSaved] = React.useState(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const K = "core_settings.basic";

  // --- Option sets -----------------------------------------------------------
  // Built inside the component because the labels are translated. Values are
  // the modem's own, stringified for the control and cast back on write.

  const simSlotOptions: SegmentedOption<string>[] = [
    { value: "1", label: t(`${K}.rows.sim_slot.options.slot_1`) },
    { value: "2", label: t(`${K}.rows.sim_slot.options.slot_2`) },
  ];

  const simDetectOptions: SegmentedOption<string>[] = [
    { value: "1", label: t(`${K}.rows.sim_detect.on`) },
    { value: "0", label: t(`${K}.rows.sim_detect.off`) },
  ];

  const radioPowerOptions: SegmentedOption<string>[] = [
    // Keyed on `cfun`, the field name — NOT on a friendlier "radio_power".
    // The row's label, consequence and failed-field lookup all key on the
    // field name, and one alias here is enough to make the options silently
    // resolve to nothing.
    { value: "1", label: t(`${K}.rows.cfun.options.normal`) },
    { value: "0", label: t(`${K}.rows.cfun.options.radio_off`) },
    { value: "4", label: t(`${K}.rows.cfun.options.airplane`) },
  ];

  // The four values worth OFFERING. The backend validator accepts seven —
  // the three missing ones are the legacy WCDMA combinations (`WCDMA`,
  // `LTE:WCDMA`, `NR5G:LTE:WCDMA`), which are not useful choices on this
  // hardware and would make a seven-segment control unusable.
  const modePrefOffered: SegmentedOption<string>[] = [
    { value: "AUTO", label: t(`${K}.rows.mode_pref.options.auto`) },
    { value: "LTE:NR5G", label: t(`${K}.rows.mode_pref.options.lte_nr`) },
    { value: "NR5G", label: t(`${K}.rows.mode_pref.options.nr_only`) },
    { value: "LTE", label: t(`${K}.rows.mode_pref.options.lte_only`) },
  ];

  const nr5gModeOptions: SegmentedOption<string>[] = [
    { value: "0", label: t(`${K}.rows.nr5g_mode.options.auto`) },
    { value: "1", label: t(`${K}.rows.nr5g_mode.options.nsa`) },
    { value: "2", label: t(`${K}.rows.nr5g_mode.options.sa`) },
  ];

  const roamPrefOptions: SegmentedOption<string>[] = [
    { value: "255", label: t(`${K}.rows.roam_pref.options.any`) },
    { value: "1", label: t(`${K}.rows.roam_pref.options.home`) },
    { value: "3", label: t(`${K}.rows.roam_pref.options.partner`) },
  ];

  // --- Loading ---------------------------------------------------------------
  // Geometry is MIRRORED from the shape constants, never restated. The old
  // skeleton hand-wrote `h-4 w-36` per field and titled itself "Cellular Basic
  // Settings" while the loaded card said "Modem Radio Settings" — a visible
  // title swap on every load. The header text is real in both states now.

  if (isLoading || !draft || !settings) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${K}.radio.title`)}</CardTitle>
          <CardDescription>{t(`${K}.radio.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(SETTING_ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Helpers ---------------------------------------------------------------

  // A control MUST be able to represent whatever the modem actually reports,
  // even a value we would never offer. QManager ships an AT terminal, so
  // `AT+QNWPREFCFG="mode_pref",WCDMA` is reachable, and a modem sitting on an
  // unoffered value would otherwise render a control with no matching segment —
  // blank, or snapped to a neighbour — after which the diff would treat the
  // untouched row as pending and write the WRONG value on the next save. That
  // is the same hazard restoring `LTE:NR5G` fixed; this closes the remainder.
  //
  // The reported value is prepended as its own segment, labelled with the raw
  // modem string (machine voice, because that is what it is). The user can move
  // OFF it and cannot come back — correct, since it is a state to escape rather
  // than a choice to offer.
  //
  // Declared HERE, below the loading return, because it reads `draft` — above
  // it, `draft` is still nullable.
  const modePrefOptions: SegmentedOption<string>[] = modePrefOffered.some(
    (option) => option.value === draft.mode_pref,
  )
    ? modePrefOffered
    : [{ value: draft.mode_pref, label: draft.mode_pref }, ...modePrefOffered];

  const labelOf = (options: SegmentedOption<string>[], value: string) =>
    options.find((option) => option.value === value)?.label ?? value;

  /** "before -> after", or null when the row is clean. */
  const deltaFor = (
    key: WritableSettingKey,
    options: SegmentedOption<string>[],
  ) => {
    if (!dirtyFields.has(key)) return null;
    const from = labelOf(options, String(settings[key]));
    const to = labelOf(options, String(draft[key]));
    return `${from} → ${to}`;
  };

  const failedLabels = (lastApply?.failedFields ?? []).map((key) =>
    t(`${K}.rows.${key}.label`),
  );

  const handleSave = async () => {
    const result = await saveSettings();
    if (result.success) {
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    }
  };

  const rowDirty = (key: WritableSettingKey) => dirtyFields.has(key);

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.radio.title`)}</CardTitle>
        <CardDescription>{t(`${K}.radio.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={ROW_GROUP.ROOT}>
          <SettingRow
            label={t(`${K}.rows.sim_slot.label`)}
            consequence={t(`${K}.rows.sim_slot.consequence`)}
            dirty={rowDirty("sim_slot")}
            delta={deltaFor("sim_slot", simSlotOptions)}
            control={
              <SegmentedField
                value={String(draft.sim_slot)}
                onValueChange={(next) =>
                  setField("sim_slot", Number(next) as SimSlot)
                }
                options={simSlotOptions}
                ariaLabel={t(`${K}.rows.sim_slot.label`)}
                disabled={isSaving}
                onFill={rowDirty("sim_slot")}
              />
            }
          />

          <div className={ROW_GROUP.DIVIDER} />

          {/* SIM hot-swap detection is binary (on/off), same as every other
              row on this card is a closed set of named states — so it takes
              the same SegmentedField the rest of the card uses, not a bare
              Switch. A Switch communicates state through track colour alone;
              every sibling row here keeps its selection legible as TEXT
              ("✓ SIM 1", "✓ Normal"), and this row now matches that. Placed
              right after SIM Slot because both rows are about the same
              physical thing (the SIM), before the radio-behaviour rows that
              follow. */}
          <SettingRow
            label={t(`${K}.rows.sim_detect.label`)}
            consequence={t(`${K}.rows.sim_detect.consequence`)}
            dirty={rowDirty("sim_detect")}
            delta={deltaFor("sim_detect", simDetectOptions)}
            control={
              <SegmentedField
                value={String(draft.sim_detect)}
                onValueChange={(next) =>
                  setField("sim_detect", Number(next) as SimDetect)
                }
                options={simDetectOptions}
                ariaLabel={t(`${K}.rows.sim_detect.label`)}
                disabled={isSaving}
                onFill={rowDirty("sim_detect")}
              />
            }
          />

          <div className={ROW_GROUP.DIVIDER} />

          <SettingRow
            label={t(`${K}.rows.cfun.label`)}
            consequence={t(`${K}.rows.cfun.consequence`)}
            dirty={rowDirty("cfun")}
            delta={deltaFor("cfun", radioPowerOptions)}
            control={
              <SegmentedField
                value={String(draft.cfun)}
                onValueChange={(next) =>
                  setField("cfun", Number(next) as CfunMode)
                }
                options={radioPowerOptions}
                ariaLabel={t(`${K}.rows.cfun.label`)}
                disabled={isSaving}
                onFill={rowDirty("cfun")}
              />
            }
          />

          <div className={ROW_GROUP.DIVIDER} />

          <SettingRow
            label={t(`${K}.rows.mode_pref.label`)}
            consequence={t(`${K}.rows.mode_pref.consequence`)}
            dirty={rowDirty("mode_pref")}
            delta={deltaFor("mode_pref", modePrefOptions)}
            control={
              <SegmentedField
                value={draft.mode_pref}
                onValueChange={(next) =>
                  setField("mode_pref", next as ModePref)
                }
                options={modePrefOptions}
                ariaLabel={t(`${K}.rows.mode_pref.label`)}
                disabled={isSaving}
                onFill={rowDirty("mode_pref")}
              />
            }
          />

          <div className={ROW_GROUP.DIVIDER} />

          <SettingRow
            label={t(`${K}.rows.nr5g_mode.label`)}
            consequence={t(`${K}.rows.nr5g_mode.consequence`)}
            dirty={rowDirty("nr5g_mode")}
            delta={deltaFor("nr5g_mode", nr5gModeOptions)}
            control={
              <SegmentedField
                value={String(draft.nr5g_mode)}
                onValueChange={(next) =>
                  setField("nr5g_mode", Number(next) as Nr5gMode)
                }
                options={nr5gModeOptions}
                ariaLabel={t(`${K}.rows.nr5g_mode.label`)}
                disabled={isSaving}
                onFill={rowDirty("nr5g_mode")}
              />
            }
          />

          <div className={ROW_GROUP.DIVIDER} />

          <SettingRow
            label={t(`${K}.rows.roam_pref.label`)}
            consequence={t(`${K}.rows.roam_pref.consequence`)}
            dirty={rowDirty("roam_pref")}
            delta={deltaFor("roam_pref", roamPrefOptions)}
            control={
              <SegmentedField
                value={String(draft.roam_pref)}
                onValueChange={(next) =>
                  setField("roam_pref", Number(next) as RoamPref)
                }
                options={roamPrefOptions}
                ariaLabel={t(`${K}.rows.roam_pref.label`)}
                disabled={isSaving}
                onFill={rowDirty("roam_pref")}
              />
            }
          />
        </div>

        <PendingSaveBar
          changeCount={changeCount}
          isSaving={isSaving}
          applyPhase={applyPhase}
          failedLabels={failedLabels}
          onDiscard={discard}
          onSave={handleSave}
          saved={saved}
          copy={{
            count: t(`${K}.save_bar.count`, { count: changeCount }),
            note: t(`${K}.save_bar.note`),
            discard: t(`${K}.save_bar.discard`),
            save: t(`${K}.save_bar.save`),
            failed: t(`${K}.save_bar.failed`, {
              fields: failedLabels.join(", "),
            }),
            steps: {
              writing: t(`${K}.apply.writing`),
              recovering: t(`${K}.apply.recovering`),
              verifying: t(`${K}.apply.verifying`),
            },
          }}
        />

        {/* The resting footer. Only shown when nothing is pending — otherwise
            the save bar owns this slot and two status lines would contradict
            each other. */}
        {changeCount === 0 && !isSaving ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={refresh}
              className={PILL_ACTION}
            >
              <MaterialSymbol name="refresh" size={17} />
              {t(`${K}.footer.reread`)}
            </Button>
            <span className="text-on-surface-variant text-xs">
              {t(`${K}.footer.in_sync`)}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default CellularSettingsCard;

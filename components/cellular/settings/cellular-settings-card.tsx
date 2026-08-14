"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
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

import SegmentedField, { type SegmentedOption } from "./segmented-field";
import SettingRow from "./setting-row";
import {
  CARD_NOTICE,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  ROW_GROUP,
  SETTING_ROW,
} from "./shapes";

// =============================================================================
// Modem Radio Settings — the write surface, split into two section cards
// =============================================================================
// One card per section of three grouped rows rather than six labels over six
// dropdowns. The two sections are "SIM & Radio Power" (SIM Slot, SIM Hot-Swap
// Detection, Radio Power) and "Network Mode & Roaming" (Preferred Network
// Type, 5G Architecture, Roaming Preference) — the split follows the physical
// thing being configured, not the backend's field order.
//
// THE SAVE BAR LIVES UPSTAIRS. Both cards share ONE form state, one save bar
// and one re-read footer; they are rendered by the route shell below the
// cards, not here — a per-card save bar would show the same "N changes
// pending" twice, and the backend accepts any subset of fields in a single
// POST, so one save is the honest unit.
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
//
// ON THE SEGMENTED BREAKPOINT. These two cards are roughly half the width of
// the single card they replace, so `SegmentedField` is told to keep its pill
// group down to the card's `lg` step instead of the family default `2xl` —
// otherwise the primary control would silently become a Select on desktop
// widths where the old layout showed the pill group. See
// `segmentedBreakpoint()` in shapes.ts.
// =============================================================================

export interface CellularSettingsCardProps {
  form: UseCellularSettingsReturn;
  /** Which half of the six rows this card renders. */
  section: "sim" | "network";
}

/** One declarative row. The value/onChange pair binds the modem's own strings. */
interface RowDef {
  key: WritableSettingKey;
  label: string;
  consequence: string;
  options: SegmentedOption<string>[];
  value: string;
  onValueChange: (next: string) => void;
}

export function CellularSettingsCard({
  form,
  section,
}: CellularSettingsCardProps) {
  const { t } = useTranslation("cellular");
  const {
    draft,
    settings,
    dirtyFields,
    error,
    isLoading,
    isSaving,
    setField,
  } = form;

  const K = "core_settings.basic";
  const HEADER = section === "sim" ? `${K}.sim_card` : `${K}.network_card`;

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

  // --- Never read ------------------------------------------------------------
  // A failed FIRST read is a third state, not a longer loading state. The hook
  // clears `isLoading` and leaves `settings` at `null`, so the skeleton below
  // used to shimmer forever with no explanation. The card states why it has
  // nothing to show, quietly — the route shell's banner already carries the
  // alarm and the retry action, and repeating it here would say it twice per
  // card. See `CARD_NOTICE` in shapes.ts.
  //
  // Only the NEVER-READ case lands here: a failed re-read leaves the previous
  // snapshot in place, so the card keeps rendering real values and the banner is
  // what says they may be stale.

  if (!isLoading && !settings && error) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${HEADER}.title`)}</CardTitle>
          <CardDescription className="min-w-0">
            {t(`${HEADER}.description`)}
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            <p className={CARD_NOTICE}>{t(`${K}.cards.unread`)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Loading ---------------------------------------------------------------
  // Geometry is MIRRORED from the shape constants, never restated, and the
  // header text is real in both states — the old skeleton titled itself
  // "Cellular Basic Settings" while the loaded card said "Modem Radio
  // Settings", a visible title swap on every load.

  if (isLoading || !draft || !settings) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${HEADER}.title`)}</CardTitle>
          <CardDescription className="min-w-0">
            {t(`${HEADER}.description`)}
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          {/* The dividers are part of the mirror. The loaded group interleaves
              two of them between its three rows; a skeleton that renders three
              bare rows is ~6px shorter, so every load ended in a visible jump. */}
          <div className={ROW_GROUP.ROOT}>
            {Array.from({ length: 3 }).map((_, index) => (
              <React.Fragment key={index}>
                {index > 0 ? <div className={ROW_GROUP.DIVIDER} /> : null}
                <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
              </React.Fragment>
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

  const rowDirty = (key: WritableSettingKey) => dirtyFields.has(key);

  const simRows: RowDef[] = [
    {
      key: "sim_slot",
      label: t(`${K}.rows.sim_slot.label`),
      consequence: t(`${K}.rows.sim_slot.consequence`),
      options: simSlotOptions,
      value: String(draft.sim_slot),
      onValueChange: (next) => setField("sim_slot", Number(next) as SimSlot),
    },
    // SIM hot-swap detection is binary (on/off), same as every other row on
    // this card is a closed set of named states — so it takes the same
    // SegmentedField the rest of the card uses, not a bare Switch. A Switch
    // communicates state through track colour alone; every sibling row keeps
    // its selection legible as TEXT ("✓ SIM 1", "✓ Normal"), and this row
    // matches that. Placed right after SIM Slot because both rows are about
    // the same physical thing (the SIM), before the radio-behaviour rows that
    // follow.
    {
      key: "sim_detect",
      label: t(`${K}.rows.sim_detect.label`),
      consequence: t(`${K}.rows.sim_detect.consequence`),
      options: simDetectOptions,
      value: String(draft.sim_detect),
      onValueChange: (next) => setField("sim_detect", Number(next) as SimDetect),
    },
    {
      key: "cfun",
      label: t(`${K}.rows.cfun.label`),
      consequence: t(`${K}.rows.cfun.consequence`),
      options: radioPowerOptions,
      value: String(draft.cfun),
      onValueChange: (next) => setField("cfun", Number(next) as CfunMode),
    },
  ];

  const networkRows: RowDef[] = [
    {
      key: "mode_pref",
      label: t(`${K}.rows.mode_pref.label`),
      consequence: t(`${K}.rows.mode_pref.consequence`),
      options: modePrefOptions,
      value: draft.mode_pref,
      onValueChange: (next) => setField("mode_pref", next as ModePref),
    },
    {
      key: "nr5g_mode",
      label: t(`${K}.rows.nr5g_mode.label`),
      consequence: t(`${K}.rows.nr5g_mode.consequence`),
      options: nr5gModeOptions,
      value: String(draft.nr5g_mode),
      onValueChange: (next) => setField("nr5g_mode", Number(next) as Nr5gMode),
    },
    {
      key: "roam_pref",
      label: t(`${K}.rows.roam_pref.label`),
      consequence: t(`${K}.rows.roam_pref.consequence`),
      options: roamPrefOptions,
      value: String(draft.roam_pref),
      onValueChange: (next) => setField("roam_pref", Number(next) as RoamPref),
    },
  ];

  const rows = section === "sim" ? simRows : networkRows;

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${HEADER}.title`)}</CardTitle>
        <CardDescription className="min-w-0">
          {t(`${HEADER}.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <motion.div
          // Declared initial AND animate on the cascade root: a variants-only
          // child that mounts on a state swap renders blank, and this group
          // mounts when the settings read lands.
          className={ROW_GROUP.ROOT}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          {rows.map((row, index) => (
            <React.Fragment key={row.key}>
              {index > 0 ? <div className={ROW_GROUP.DIVIDER} /> : null}
              <motion.div variants={staggerRowItem}>
                <SettingRow
                  label={row.label}
                  consequence={row.consequence}
                  dirty={rowDirty(row.key)}
                  delta={deltaFor(row.key, row.options)}
                  control={
                    <SegmentedField
                      value={row.value}
                      onValueChange={row.onValueChange}
                      options={row.options}
                      ariaLabel={row.label}
                      disabled={isSaving}
                      onFill={rowDirty(row.key)}
                      // These two cards are half the width of the single card
                      // they replaced — keep the pill group down to the card's
                      // `lg` step instead of the family default. See the
                      // header comment and `segmentedBreakpoint()`.
                      breakpoint="lg"
                    />
                  }
                />
              </motion.div>
            </React.Fragment>
          ))}
        </motion.div>
      </CardContent>
    </Card>
  );
}

export default CellularSettingsCard;

"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BACKUP_GROUPS,
  BACKUP_SECTIONS,
  computeMutex,
  MUTEX_GROUPS,
  type MutexReason,
  type SelectionMap,
} from "@/lib/config-backup/sections";
import { cn } from "@/lib/utils";
import type { BackupSectionKey, BackupSectionMeta } from "@/types/config-backup";

import { PICK, ROW_GROUP } from "../shapes";

const K = "config_backup";

export interface SectionPickerProps {
  /** Unique per card, so two pickers on one page never share checkbox ids. */
  idPrefix: string;
  /** Sections to list, in any order; rendered in picker order. */
  keys: readonly BackupSectionKey[];
  selection: SelectionMap;
  onChange: (key: BackupSectionKey, checked: boolean) => void;
  /** Keys the device build lacks: shown disabled. Null when unknown. */
  unsupported?: ReadonlySet<string> | null;
  busy?: boolean;
  /** A standing second line for a row (a restore consequence). */
  note?: (key: BackupSectionKey) => string | null;
}

/** Grouped checkbox picker shared by the create and restore cards. */
export function SectionPicker({
  idPrefix,
  keys,
  selection,
  onChange,
  unsupported,
  busy = false,
  note,
}: SectionPickerProps) {
  const { t, i18n } = useTranslation("system-settings");
  const held = useMemo(() => computeMutex(selection), [selection]);
  const shown = useMemo(() => new Set(keys), [keys]);
  const list = useMemo(
    () => new Intl.ListFormat(i18n.language, { style: "long", type: "conjunction" }),
    [i18n.language],
  );

  const label = (key: BackupSectionKey) => t(`${K}.sections.${key}`);

  const reasonText = (r: MutexReason): string => {
    if (r.kind === "parent_on") return t(`${K}.mutex_parent_on`, { parent: label(r.parent) });
    const members = MUTEX_GROUPS.find((g) => g.parent === r.parent)?.members ?? [];
    return t(`${K}.mutex_member_on`, { members: list.format(members.map(label)) });
  };

  const groups = BACKUP_GROUPS.map((group) => ({
    group,
    rows: BACKUP_SECTIONS.filter((s) => s.group === group && shown.has(s.key)),
  })).filter((g) => g.rows.length > 0);

  const isOn = (key: BackupSectionKey) =>
    !!selection[key] && !held.has(key) && !unsupported?.has(key);

  const renderRow = (s: BackupSectionMeta) => {
    const notHere = !!unsupported?.has(s.key);
    const reason = held.get(s.key);
    const isDisabled = notHere || !!reason;
    const id = `${idPrefix}-${s.key}`;
    const why = notHere
      ? t(`${K}.not_supported_here`)
      : reason
        ? reasonText(reason)
        : (note?.(s.key) ?? null);
    return (
      <label key={s.key} htmlFor={id} className={PICK.ROW}>
        <Checkbox
          id={id}
          checked={isOn(s.key)}
          disabled={isDisabled || busy}
          onCheckedChange={(v) => onChange(s.key, v === true)}
        />
        <span className={PICK.TEXT}>
          <span className={cn(PICK.NAME, isDisabled && "text-on-surface-variant")}>
            {label(s.key)}
          </span>
          {why ? <span className={PICK.WHY}>{why}</span> : null}
        </span>
      </label>
    );
  };

  return (
    // Connection opens first; the rest stay folded to save height.
    <Accordion type="multiple" defaultValue={["connection"]} className="flex flex-col gap-3">
      {groups.map(({ group, rows }) => (
        <AccordionItem key={group} value={group} className="border-b-0">
          <AccordionTrigger className={cn(PICK.LABEL, "items-center rounded-field py-1.5")}>
            {t(`${K}.groups.${group}`)}
            <span className={PICK.COUNT}>
              {t(`${K}.group_count`, {
                on: rows.filter((r) => isOn(r.key)).length,
                total: rows.length,
              })}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-0">
            <div className={ROW_GROUP}>{rows.map(renderRow)}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export default SectionPicker;

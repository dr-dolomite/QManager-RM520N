"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";

import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScenarioPicker } from "./scenario-picker";
import { parseHhmm } from "@/lib/scenario-schedule";
import type { ScenarioScheduleBlock } from "@/types/sim-profile";
import type { ScheduleBlockError } from "@/lib/scenario-schedule";
import type { ScenarioOption } from "@/hooks/use-scenario-list";

// =============================================================================
// ScheduleBlockEditor: the expanded body of one schedule entry
// =============================================================================
// Three controls only: a start time, an end time, and the scenario to run in
// that window. Per-day scheduling was removed deliberately — every entry runs
// every day, so the editor writes all seven days under the hood (see
// scenario-card.tsx::newBlock) and never asks the user about days. This keeps
// the device cron generator and the synced shell/TS resolver unchanged.
//
// Surfaces a blocking error (malformed/zero-length time), a non-blocking
// overlap warning (first-in-array wins), and an overnight hint when the window
// crosses midnight. The entry header (reorder, remove) lives on the collapsed
// summary row, not here.
// =============================================================================

interface ScheduleBlockEditorProps {
  block: ScenarioScheduleBlock;
  scenarios: ScenarioOption[];
  scenariosLoading?: boolean;
  error?: ScheduleBlockError;
  overlap?: boolean;
  onChange: (next: ScenarioScheduleBlock) => void;
}

export function ScheduleBlockEditor({
  block,
  scenarios,
  scenariosLoading,
  error,
  overlap,
  onChange,
}: ScheduleBlockEditorProps) {
  const { t } = useTranslation("cellular");
  const uid = useId();
  const startId = `${uid}-start`;
  const endId = `${uid}-end`;
  const scnId = `${uid}-scenario`;

  const errorText = error
    ? t(`custom_profiles.form.scenario.block_errors.${error}`)
    : undefined;

  // Overnight hint: both times valid AND end <= start (window wraps midnight).
  const s = parseHhmm(block.start);
  const e = parseHhmm(block.end);
  const showOvernight = s !== null && e !== null && e <= s;

  return (
    <div className="@container/block grid gap-3">
      <div className="grid grid-cols-1 gap-3 @sm/block:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={startId}>
            {t("custom_profiles.form.scenario.start_label")}
          </FieldLabel>
          <Input
            id={startId}
            type="time"
            className="tabular-nums"
            value={block.start}
            onChange={(ev) => onChange({ ...block, start: ev.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={endId}>
            {t("custom_profiles.form.scenario.end_label")}
          </FieldLabel>
          <Input
            id={endId}
            type="time"
            className="tabular-nums"
            value={block.end}
            onChange={(ev) => onChange({ ...block, end: ev.target.value })}
          />
          {showOvernight && (
            <p className="text-muted-foreground text-xs">
              {t("custom_profiles.form.scenario.overnight_hint")}
            </p>
          )}
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={scnId}>
          {t("custom_profiles.form.scenario.block_scenario_label")}
        </FieldLabel>
        <ScenarioPicker
          id={scnId}
          value={block.scenario}
          scenarios={scenarios}
          loading={scenariosLoading}
          aria-label={t("custom_profiles.form.scenario.block_scenario_label")}
          onChange={(scn) => onChange({ ...block, scenario: scn })}
        />
      </Field>

      {errorText && <FieldError>{errorText}</FieldError>}

      {!errorText && overlap && (
        <p
          role="status"
          className="text-warning flex items-center gap-1.5 text-xs"
        >
          <TriangleAlertIcon className="size-3 shrink-0" />
          {t("custom_profiles.form.scenario.overlap_warning")}
        </p>
      )}
    </div>
  );
}

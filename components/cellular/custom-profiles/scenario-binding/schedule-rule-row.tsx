"use client";

import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ScheduleBlockEditor } from "./schedule-block-editor";
import type { ScheduleBlockError } from "@/lib/scenario-schedule";
import type { ScenarioOption } from "@/hooks/use-scenario-list";
import type { ScenarioScheduleBlock } from "@/types/sim-profile";

// =============================================================================
// ScheduleRuleRow: one accordion row in the schedule entry list
// =============================================================================
// Collapsed: a single summary line ("{start}–{end} → {scenario}") with reorder
// + remove affordances and a warning glyph when the entry has a blocking error
// or an overlap. Expanded: the ScheduleBlockEditor body (start/end/scenario).
// Open state is controlled by the parent so only one row opens at a time and an
// invalid row can be force-expanded. Day vocabulary is gone — every entry runs
// every day, so there is nothing day-shaped to summarize here.
// =============================================================================

interface ScheduleRuleRowProps {
  index: number;
  block: ScenarioScheduleBlock;
  scenarios: ScenarioOption[];
  scenariosLoading?: boolean;
  error?: ScheduleBlockError;
  overlap?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolve a scenario id to its display name for the summary line. */
  nameForId: (id: string) => string;
  /** Reorder controls; rendered only when canReorder is true. */
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChange: (next: ScenarioScheduleBlock) => void;
  onRemove: () => void;
  /** Set on the row so the form can scroll an invalid entry into view. */
  rowRef?: (el: HTMLDivElement | null) => void;
}

export function ScheduleRuleRow({
  index,
  block,
  scenarios,
  scenariosLoading,
  error,
  overlap,
  open,
  onOpenChange,
  nameForId,
  canReorder,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChange,
  onRemove,
  rowRef,
}: ScheduleRuleRowProps) {
  const { t } = useTranslation("cellular");

  const flagged = Boolean(error) || Boolean(overlap);

  const timeRange = t("custom_profiles.form.scenario.time_range", {
    start: block.start,
    end: block.end,
  });

  const summary = t("custom_profiles.form.scenario.summary_line", {
    time: timeRange,
    scenario: nameForId(block.scenario),
  });

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div ref={rowRef} className="rounded-lg border">
        <div className="flex items-center gap-1 p-2">
          {canReorder && (
            <div className="flex flex-col">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={isFirst}
                aria-label={t("custom_profiles.form.scenario.move_up_aria")}
                onClick={onMoveUp}
              >
                <ChevronUpIcon className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={isLast}
                aria-label={t("custom_profiles.form.scenario.move_down_aria")}
                onClick={onMoveDown}
              >
                <ChevronDownIcon className="size-3.5" />
              </Button>
            </div>
          )}

          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-expanded={open}
              aria-label={t("custom_profiles.form.scenario.expand_rule_aria")}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm"
            >
              {flagged && (
                <TriangleAlertIcon className="text-warning size-3 shrink-0" />
              )}
              <span className="truncate tabular-nums">{summary}</span>
              <ChevronDownIcon
                className={cn(
                  "text-muted-foreground ml-auto size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t("custom_profiles.form.scenario.remove_block_aria")}
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>

        <CollapsibleContent className="px-3 pb-3">
          {/* Keep the 1-based entry index discoverable to assistive tech; the
              summary row already carries the human-readable identity. */}
          <span className="sr-only">
            {t("custom_profiles.form.scenario.block_label", {
              index: index + 1,
            })}
          </span>
          <ScheduleBlockEditor
            block={block}
            scenarios={scenarios}
            scenariosLoading={scenariosLoading}
            error={error}
            overlap={overlap}
            onChange={onChange}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

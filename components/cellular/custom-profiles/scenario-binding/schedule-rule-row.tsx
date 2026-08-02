"use client";

import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MACHINE_VALUE } from "@/components/cellular/custom-profiles/shapes";

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

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div ref={rowRef} className="rounded-tile border">
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
                <MaterialSymbol name="arrow_upward" size={14} />
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
                <MaterialSymbol name="arrow_downward" size={14} />
              </Button>
            </div>
          )}

          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-expanded={open}
              aria-label={t("custom_profiles.form.scenario.expand_rule_aria")}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-inline px-1 py-1 text-left text-sm"
            >
              {flagged && (
                <MaterialSymbol
                  name="warning"
                  size={12}
                  className="text-warning-on-surface shrink-0"
                />
              )}
              {/* Machine-Voice Rule per segment: the HH:MM range is
                  device-format and renders mono; the scenario name is
                  human-authored (user-typed or a translated default) and
                  stays proportional. The arrow is a bare separator glyph,
                  not linguistic content, so it isn't routed through i18n. */}
              <span className="flex min-w-0 items-center gap-1 truncate">
                <span className={cn("shrink-0", MACHINE_VALUE)}>
                  {timeRange}
                </span>
                <span
                  className="text-on-surface-variant shrink-0"
                  aria-hidden="true"
                >
                  →
                </span>
                <span className="truncate">{nameForId(block.scenario)}</span>
              </span>
              <MaterialSymbol
                name="expand_more"
                size={16}
                className={cn(
                  "text-on-surface-variant ml-auto shrink-0 transition-transform duration-[var(--duration-quick)] ease-out motion-reduce:transition-none",
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
            <MaterialSymbol name="delete" size={16} />
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

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { CARD_FOOT, CARD_FOOT_ACTIONS, CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ApplyPhase } from "@/hooks/use-cellular-settings";

import {
  APPLY_FOOT_SKELETON,
  APPLY_LEDGER,
  CARD_PAD,
} from "./shapes";

// Re-exported so the family's sub-pages (Network Priority) can type their
// own step ledger without importing the parent page's hook.
export type { ApplyPhase };

// The settings family's persistent apply footer: consequence, failure or
// the running step ledger on the left; Discard then Save on the right.

/** The apply sequence, in order. `idle` is not a step. */
const APPLY_STEPS: readonly Exclude<ApplyPhase, "idle">[] = [
  "writing",
  "recovering",
  "verifying",
];

export interface ApplyFootProps {
  changeCount: number;
  isSaving: boolean;
  applyPhase: ApplyPhase;
  /** Field names that failed on the last apply, already translated. */
  failedLabels?: readonly string[];
  onDiscard: () => void;
  onSave: () => void;
  saved: boolean;
  /** Secondary actions, rendered before Discard. Text only, ghost or tonal-neutral. */
  secondary?: React.ReactNode;
  /** An action on the foot's left edge, ahead of the status text. */
  leading?: React.ReactNode;
  /** Copy, all pre-translated by the caller. */
  copy: {
    note: string;
    discard: string;
    save: string;
    steps: Record<Exclude<ApplyPhase, "idle">, string>;
    failed?: string;
    /** Status when nothing is pending. */
    idle?: string;
  };
}

export function ApplyFoot({
  changeCount,
  isSaving,
  applyPhase,
  failedLabels = [],
  onDiscard,
  onSave,
  saved,
  secondary,
  leading,
  copy,
}: ApplyFootProps) {
  const activeIndex = APPLY_STEPS.indexOf(
    applyPhase as Exclude<ApplyPhase, "idle">,
  );

  const status = isSaving ? (
    <div className={APPLY_LEDGER.ROOT}>
      {APPLY_STEPS.map((step, index) => {
        const done = activeIndex > index;
        const active = activeIndex === index;
        return (
          <div key={step} className={APPLY_LEDGER.STEP}>
            <span
              className={cn(
                APPLY_LEDGER.DOT,
                done
                  ? APPLY_LEDGER.DOT_DONE
                  : active
                    ? APPLY_LEDGER.DOT_ACTIVE
                    : APPLY_LEDGER.DOT_PENDING,
              )}
              aria-hidden="true"
            />
            <span className={active ? "text-foreground font-semibold" : undefined}>
              {copy.steps[step]}
            </span>
          </div>
        );
      })}
    </div>
  ) : changeCount > 0 ? (
    <>
      <span className="text-pretty">
        {failedLabels.length > 0 && copy.failed ? copy.failed : copy.note}
      </span>
    </>
  ) : copy.idle ? (
    <span>{copy.idle}</span>
  ) : null;

  return (
    <CardFoot
      className={CARD_PAD}
      status={
        <>
          {leading}
          {status}
        </>
      }
      actions={
        <>
          {secondary}
          <Button
            type="button"
            variant="ghost"
            onClick={onDiscard}
            disabled={isSaving || changeCount === 0}
            size="action" className="gap-0"
          >
            {copy.discard}
          </Button>
          <SaveButton
            type="button"
            onClick={onSave}
            isSaving={isSaving}
            saved={saved}
            label={copy.save}
            disabled={changeCount === 0}
            size="action"
          />
        </>
      }
    />
  );
}

/** The footer's loading placeholder: the same row, Discard and Save pills only. */
export function ApplyFootSkeleton() {
  return (
    <div className={cn(CARD_PAD, CARD_FOOT)}>
      <div className={CARD_FOOT_ACTIONS}>
        <Skeleton className={APPLY_FOOT_SKELETON.DISCARD} />
        <Skeleton className={APPLY_FOOT_SKELETON.SAVE} />
      </div>
    </div>
  );
}

export default ApplyFoot;

"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DUR, EASE_STANDARD, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ApplyPhase } from "@/hooks/use-cellular-settings";

import { APPLY_LEDGER, PILL_ACTION, SAVE_BAR } from "./shapes";

// =============================================================================
// PendingSaveBar — exists only while something is pending
// =============================================================================
// Not a permanently mounted footer that greys out. The page this replaces had
// an always-enabled Save button and caught a no-op save AFTER the fact with a
// toast reading "No changes to save" — the UI could not tell you whether you
// had changed anything, so it waited for you to ask and then said no.
//
// -----------------------------------------------------------------------------
// THE EXIT ANIMATION, AND WHY IT IS NOT A RULE VIOLATION
// -----------------------------------------------------------------------------
// DESIGN.md: "Don't add an exit animation to a banner or a route transition."
// That rule is scoped to CONDITIONS and NAVIGATION — a banner leaving means the
// condition cleared, and that should feel immediate.
//
// A save bar is not a condition. Its disappearance is the terminal frame of a
// commit the user initiated, and cutting it dead reads as the app dropping the
// interaction rather than completing it. So it exits — but on the QUICK clock,
// transform and opacity only. The Modal-Exit Rule's reasoning applies by
// analogy: the exit clock is how long the user waits to see the result, so it
// is deliberately shorter than the entrance.
//
// `SaveButton` is NEVER wrapped in `AnimatePresence`. It width-locks by keeping
// all three of its layers permanently mounted in one grid cell; unmounting a
// layer removes that layer's width contribution and the lock breaks.
// =============================================================================

/** The apply sequence, in order. `idle` is not a step. */
const APPLY_STEPS: readonly Exclude<ApplyPhase, "idle">[] = [
  "writing",
  "recovering",
  "verifying",
];

export interface PendingSaveBarProps {
  changeCount: number;
  isSaving: boolean;
  applyPhase: ApplyPhase;
  /** Field names that failed on the last apply, already translated. */
  failedLabels?: readonly string[];
  onDiscard: () => void;
  onSave: () => void;
  saved: boolean;
  /** Copy, all pre-translated by the caller. */
  copy: {
    count: string;
    note: string;
    discard: string;
    save: string;
    steps: Record<Exclude<ApplyPhase, "idle">, string>;
    failed: string;
  };
}

export function PendingSaveBar({
  changeCount,
  isSaving,
  applyPhase,
  failedLabels = [],
  onDiscard,
  onSave,
  saved,
  copy,
}: PendingSaveBarProps) {
  const visible = changeCount > 0 || isSaving;
  const activeIndex = APPLY_STEPS.indexOf(
    applyPhase as Exclude<ApplyPhase, "idle">,
  );

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          // Declared on the cascade root even though there is no variant
          // cascade below it: a child that mounts on a swap with only variants
          // renders blank, and this bar mounts on a state swap.
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{
            duration: isSaving ? DUR.standard : DUR.quick,
            ease: applyPhase === "idle" ? EASE_QUICK : EASE_STANDARD,
          }}
          className={SAVE_BAR.ROOT}
          role="status"
          aria-live="polite"
        >
          {isSaving ? (
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
                    <span
                      className={
                        active ? "font-semibold" : "text-on-surface-variant"
                      }
                    >
                      {copy.steps[step]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={SAVE_BAR.TEXT}>
              <span className={SAVE_BAR.COUNT}>{copy.count}</span>
              <span className={SAVE_BAR.NOTE}>
                {failedLabels.length > 0 ? copy.failed : copy.note}
              </span>
            </div>
          )}

          <div className={SAVE_BAR.ACTIONS}>
            <Button
              type="button"
              variant="ghost"
              onClick={onDiscard}
              disabled={isSaving || changeCount === 0}
              className={cn(PILL_ACTION, "gap-0")}
            >
              {copy.discard}
            </Button>
            {/* No children — `SaveButton` is typed `Omit<ButtonProps,
                "children">` because it owns all three of its stacked layers
                (idle / spinner / check) to hold its width lock. The comp drew a
                save glyph here; the component's own check state replaces it. */}
            <SaveButton
              type="button"
              onClick={onSave}
              isSaving={isSaving}
              saved={saved}
              label={copy.save}
              disabled={changeCount === 0}
              className={PILL_ACTION}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default PendingSaveBar;

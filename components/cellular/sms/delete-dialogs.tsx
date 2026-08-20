"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { CONDITION_TONE } from "@/components/cellular/condition-screen";
import { DELETE_STEP_TONE, PILL_ACTION } from "./shapes";
import type { SmsMessage } from "@/types/sms";

// =============================================================================
// SmsDeleteDialogs — the three destructive confirmations (single / all /
// selected). They share one `isDeleting` flag because only one can be open.
// =============================================================================
// THE TWO-STEP PROGRESS IS REAL HERE, not theatre.
//
// The mock animates "Modem memory cleared ✓" followed by "Clearing SIM memory ⟳".
// Against the `delete_all` CGI action that is a lie the client cannot detect:
// `delete_all` is ONE synchronous POST that runs both deletes before emitting a
// single result, and on partial failure it returns one merged error — so a UI
// showing ME "cleared" could be displaying a step that actually errored.
//
// Rather than drop the visual, the CALLER makes it true: `inbox-card.tsx` fires
// two sequential `deleteSms(indexes, storage)` calls, one per memory, grouped
// from `messages[].storage`. That contract already exists in `hooks/use-sms.ts`,
// costs no backend work, and makes each step genuinely observable — including
// *which* memory failed. This file only renders the steps it is handed.
//
// Pre-flight counts are phrased as what WILL be removed, never as a completion
// log, until the call actually returns.
// =============================================================================

export type DeleteStepStatus = "pending" | "running" | "done" | "failed";

export interface DeleteStep {
  storage: "ME" | "SM";
  /** Messages this step will remove. A zero-length step is never emitted. */
  count: number;
  status: DeleteStepStatus;
}

/** The destructive pill, from the button variant — not three hand-written copies
 *  of `bg-destructive text-destructive-foreground hover:bg-destructive/90` — on
 *  the family's own action geometry. */
const DESTRUCTIVE_ACTION = cn(
  buttonVariants({ variant: "destructive" }),
  PILL_ACTION,
);
const CANCEL_ACTION = PILL_ACTION;

function DeleteProgress({ steps }: { steps: DeleteStep[] }) {
  const { t } = useTranslation("cellular");

  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {steps.map((step) => (
        <li
          key={step.storage}
          // A row reporting a step is a METRIC-ROW shape, so it takes the pill
          // radius rather than the 20px field radius a text input wears.
          //
          // The tone comes from `DELETE_STEP_TONE`, which keys onto
          // `ConditionTone` and resolves through the one exported container
          // table — so a status with no matching role is a BUILD failure,
          // rather than four hand-written class strings quietly drifting from
          // their siblings. Each status still carries its OWN glyph:
          // `success-container` and `warning-container` sit ~1.03:1 apart, so
          // the glyph is the only separating channel.
          className={cn(
            "rounded-pill flex items-center gap-3 px-4 py-3",
            CONDITION_TONE[DELETE_STEP_TONE[step.status]].container,
          )}
        >
          {step.status === "running" ? (
            <MaterialSymbol
              name="progress_activity"
              size={19}
              className="flex-none animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <MaterialSymbol
              name={
                step.status === "done"
                  ? "check_circle"
                  : step.status === "failed"
                    ? "cancel"
                    : "schedule"
              }
              filled
              size={19}
              className="flex-none"
              aria-hidden="true"
            />
          )}
          <span className="text-sm font-semibold">
            {t(`sms.inbox.delete_progress.${step.status}`, {
              memory: t(`sms.inbox.memory.${step.storage.toLowerCase()}`),
            })}
          </span>
          <span className="ml-auto text-xs tabular-nums">
            {t(
              step.status === "done"
                ? "sms.inbox.delete_progress.count_done"
                : "sms.inbox.delete_progress.count_pending",
              { count: step.count },
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface SmsDeleteDialogsProps {
  isDeleting: boolean;
  /** Per-memory progress for the two multi-message flows. */
  steps: DeleteStep[];
  /** Single-message delete: the target message, or `null` when closed */
  deleteTarget: SmsMessage | null;
  onCloseDeleteTarget: () => void;
  onConfirmDelete: () => void;
  showDeleteAll: boolean;
  onCloseDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
  /** Total messages in the inbox — shown in the delete-all confirmation */
  totalCount: number;
  /** Pre-flight split, so the confirmation names both memories honestly. */
  meCount: number;
  smCount: number;
  showDeleteSelected: boolean;
  onCloseDeleteSelected: () => void;
  onConfirmDeleteSelected: () => void;
  selectedCount: number;
}

export function SmsDeleteDialogs({
  isDeleting,
  steps,
  deleteTarget,
  onCloseDeleteTarget,
  onConfirmDelete,
  showDeleteAll,
  onCloseDeleteAll,
  onConfirmDeleteAll,
  totalCount,
  meCount,
  smCount,
  showDeleteSelected,
  onCloseDeleteSelected,
  onConfirmDeleteSelected,
  selectedCount,
}: SmsDeleteDialogsProps) {
  const { t } = useTranslation("cellular");

  return (
    <>
      {/* Delete Single Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && onCloseDeleteTarget()}
      >
        <AlertDialogContent className="rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sms.inbox.delete_single_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.inbox.delete_single_confirm.description", {
                sender: deleteTarget?.sender ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal"
              disabled={isDeleting}
              className={CANCEL_ACTION}
            >
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDelete}
              disabled={isDeleting}
              className={DESTRUCTIVE_ACTION}
            >
              {isDeleting ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t("sms.inbox.delete_single_confirm.deleting")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="delete" size={18} />
                  {t("sms.inbox.delete_single_confirm.confirm")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Confirmation */}
      <AlertDialog
        open={showDeleteAll}
        onOpenChange={(open) => !open && onCloseDeleteAll()}
      >
        <AlertDialogContent className="rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDeleting
                ? t("sms.inbox.delete_all_confirm.progress_title")
                : t("sms.inbox.delete_all_confirm.title", {
                    count: totalCount,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDeleting
                ? t("sms.inbox.delete_all_confirm.progress_note")
                : t("sms.inbox.delete_all_confirm.description", {
                    count: totalCount,
                    me: meCount,
                    sm: smCount,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isDeleting && steps.length > 0 && <DeleteProgress steps={steps} />}

          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal"
              disabled={isDeleting}
              className={CANCEL_ACTION}
            >
              {t("sms.inbox.delete_all_confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDeleteAll}
              disabled={isDeleting}
              className={DESTRUCTIVE_ACTION}
            >
              {isDeleting ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {/* Its OWN key. All three dialogs previously reused
                      `delete_single_confirm.deleting`. */}
                  {t("sms.inbox.delete_all_confirm.deleting")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="delete_sweep" size={18} />
                  {t("sms.inbox.delete_all_confirm.confirm")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Selected Confirmation */}
      <AlertDialog
        open={showDeleteSelected}
        onOpenChange={(open) => !open && onCloseDeleteSelected()}
      >
        <AlertDialogContent className="rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDeleting
                ? t("sms.inbox.delete_selected_confirm.progress_title", {
                    count: selectedCount,
                  })
                : t("sms.inbox.delete_selected_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDeleting
                ? t("sms.inbox.delete_all_confirm.progress_note")
                : t("sms.inbox.delete_selected_confirm.description", {
                    count: selectedCount,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isDeleting && steps.length > 0 && <DeleteProgress steps={steps} />}

          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal"
              disabled={isDeleting}
              className={CANCEL_ACTION}
            >
              {t("sms.inbox.delete_all_confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDeleteSelected}
              disabled={isDeleting}
              className={DESTRUCTIVE_ACTION}
            >
              {isDeleting ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t("sms.inbox.delete_selected_confirm.deleting")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="delete" size={18} />
                  {t("sms.inbox.delete_selected_confirm.confirm", {
                    count: selectedCount,
                  })}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

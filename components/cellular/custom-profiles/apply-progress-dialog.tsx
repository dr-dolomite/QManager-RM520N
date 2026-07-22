"use client";

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2Icon,
  XCircleIcon,
  Loader2,
  EllipsisIcon,
  ClockIcon,
  MinusCircleIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion";

import type {
  ProfileApplyState,
  ApplyStep,
  ApplyStepStatus,
} from "@/types/sim-profile";

// =============================================================================
// ApplyProgressDialog — the Sequenced Pipeline Dialog
// =============================================================================
// QManager's signature shape for irreversible, multi-step apply pipelines
// (profile apply here; config-restore and language-install share it). A
// justified modal — profile activation reconfigures a live modem.
//
// Composition leads with a status HERO: a single state glyph, a headline that
// names the step in flight (or the terminal verdict), and one determinate fill
// bar that advances as steps complete. The per-step list sits beneath as
// supporting detail — a compact ledger, not the primary progress signal. This
// keeps one obvious "where am I" focal point instead of four competing rows.
// "Skipped" reads as a calm "Unchanged" (the value was already correct) and
// resolves to a check once the whole apply completes. The fill is transform-
// only (scaleX) on the system EXPO ease and collapses to instant under
// prefers-reduced-motion.
//
// RM520N contract: EXACTLY 4 steps in worker/serialization order —
// apn → ttl_hl → scenario → imei. (There is no `mpdn_rule` step here; MPDN is
// a Verizon concept that only exists on the RM551E target.) IMEI is last
// because it carries the deferred reboot.
// =============================================================================

interface ApplyProgressDialogProps {
  open: boolean;
  onClose: () => void;
  applyState: ProfileApplyState | null;
  error: string | null;
  /** Called when the user clicks Retry on a partial/failed terminal state. */
  onRetry?: () => void;
}

/**
 * Default steps shown while waiting for the first poll response. Order MUST
 * mirror the worker's execution/serialization order (apn → ttl_hl → scenario →
 * imei) so the placeholder ledger doesn't reshuffle when the first real poll
 * lands. IMEI is last because it carries the deferred reboot.
 */
const DEFAULT_STEPS: ApplyStep[] = [
  { name: "apn", status: "pending", detail: "" },
  { name: "ttl_hl", status: "pending", detail: "" },
  { name: "scenario", status: "pending", detail: "" },
  { name: "imei", status: "pending", detail: "" },
];

const EXPO = EASE_OUT_EXPO;

type Tone = "info" | "success" | "warning" | "destructive";

/**
 * The effective node status. "skipped" means "already correct"; once the whole
 * apply completes we show it as done (a check).
 */
function effectiveStatus(
  status: ApplyStepStatus,
  overall?: string,
): ApplyStepStatus {
  if (status === "skipped" && overall === "complete") return "done";
  return status;
}

/** Does this step count toward the completed fraction? */
function isTraversed(status: ApplyStepStatus): boolean {
  return status === "done" || status === "skipped";
}

const TONE_FILL: Record<Tone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

const TONE_RING: Record<Tone, string> = {
  info: "border-info/20 bg-info/10 text-info",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
};

/** The large hero glyph for the current overall state. */
function HeroGlyph({ tone, status }: { tone: Tone; status: string }) {
  const Icon =
    status === "complete"
      ? CheckCircle2Icon
      : status === "partial"
        ? MinusCircleIcon
        : status === "failed"
          ? XCircleIcon
          : null;

  return (
    <span
      className={cn(
        "flex size-14 items-center justify-center rounded-full border",
        TONE_RING[tone],
      )}
    >
      {Icon ? (
        <Icon className="size-7" />
      ) : (
        // In-flight: a calm pulsing ellipsis (not a spinner) so the focal glyph
        // reads as "working" without the rotation that competes with the fill bar.
        <EllipsisIcon className="size-7 animate-pulse motion-reduce:animate-none" />
      )}
    </span>
  );
}

/** Compact status node for the supporting step ledger. */
function StepNode({ status }: { status: ApplyStepStatus }) {
  const base =
    "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "text-info")}>
          <Loader2 className="size-4 animate-spin" />
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "text-success")}>
          <CheckCircle2Icon className="size-4" />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "text-destructive")}>
          <XCircleIcon className="size-4" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <MinusCircleIcon className="size-4" />
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-muted-foreground/60")}>
          <ClockIcon className="size-3.5" />
        </span>
      );
  }
}

export function ApplyProgressDialog({
  open,
  onClose,
  applyState,
  error,
  onRetry,
}: ApplyProgressDialogProps) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useReducedMotion();

  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      apn: t("custom_profiles.apply_dialog.step_labels.apn"),
      ttl_hl: t("custom_profiles.apply_dialog.step_labels.ttl_hl"),
      scenario: t("custom_profiles.apply_dialog.step_labels.scenario"),
      imei: t("custom_profiles.apply_dialog.step_labels.imei"),
    }),
    [t],
  );

  const status = applyState?.status ?? (open ? "applying" : "idle");
  const isTerminal = ["complete", "partial", "failed"].includes(status);
  const steps = applyState?.steps ?? (open ? DEFAULT_STEPS : []);

  const tone: Tone =
    status === "complete"
      ? "success"
      : status === "partial"
        ? "warning"
        : status === "failed"
          ? "destructive"
          : "info";

  // Completed fraction drives the determinate fill (skipped counts as done).
  const total = applyState?.total_steps || steps.length || 0;
  const doneCount = steps.filter((s) => isTraversed(s.status)).length;
  const fraction = isTerminal
    ? status === "complete"
      ? 1
      : total > 0
        ? doneCount / total
        : 1
    : total > 0
      ? doneCount / total
      : 0;

  // Headline + subtext: name the step in flight, or the terminal verdict.
  const runningStep = steps.find((s) => s.status === "running");
  const headline =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_headline")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_headline")
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_headline")
          : runningStep
            ? (stepLabels[runningStep.name] ?? runningStep.name)
            : t("custom_profiles.apply_dialog.preparing");

  const subtext =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_sub")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_sub")
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_sub")
          : runningStep && total > 0
            ? t("custom_profiles.apply_dialog.step_progress", {
                current: applyState?.current_step ?? doneCount + 1,
                total,
              })
            : null;

  const canRetry =
    !!onRetry && (status === "partial" || status === "failed");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isTerminal && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("custom_profiles.apply_dialog.title")}</DialogTitle>
          {applyState?.profile_name && (
            <DialogDescription>{applyState.profile_name}</DialogDescription>
          )}
        </DialogHeader>

        {/* Status hero — the single focal point. Text block reserves a fixed
            two-line height so advancing between steps doesn't resize the dialog. */}
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <HeroGlyph tone={tone} status={status} />
          <div className="flex min-h-[2.75rem] flex-col justify-center space-y-1">
            <p className="text-base font-semibold tracking-tight">{headline}</p>
            {subtext && (
              <p className="text-muted-foreground text-sm">{subtext}</p>
            )}
          </div>

          {/* Determinate fill — transform-only (scaleX). */}
          <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
            <motion.div
              className={cn(
                "h-full w-full origin-left rounded-full",
                TONE_FILL[tone],
              )}
              initial={false}
              animate={{ scaleX: fraction }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EXPO }
              }
            />
          </div>
        </div>

        {/* Supporting ledger — compact per-step detail. */}
        {steps.length > 0 && (
          <div className="rounded-lg border">
            <p className="text-muted-foreground border-b px-3 py-2 text-xs font-medium">
              {t("custom_profiles.apply_dialog.details_label")}
            </p>
            <ul className="divide-y">
              {steps.map((step) => {
                const eff = effectiveStatus(step.status, applyState?.status);
                const detailText =
                  eff === "skipped"
                    ? t("custom_profiles.apply_dialog.step_state_unchanged")
                    : step.detail;
                return (
                  <li
                    key={step.name}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 transition-colors duration-300 motion-reduce:transition-none",
                      eff === "running" && "bg-info/5",
                    )}
                  >
                    <StepNode status={eff} />
                    <span
                      className={cn(
                        "flex-1 text-sm font-medium",
                        eff === "pending" && "text-muted-foreground",
                      )}
                    >
                      {stepLabels[step.name] ?? step.name}
                    </span>
                    {detailText && (
                      <span className="text-muted-foreground max-w-[45%] truncate text-xs">
                        {detailText}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Reboot notice — deferred, never an inline reboot. */}
        {applyState?.requires_reboot && (
          <div className="border-info/30 bg-info/10 text-info flex items-start gap-2 rounded-md border p-3 text-sm">
            <RotateCwIcon className="mt-0.5 size-4 shrink-0" />
            <p>{t("custom_profiles.apply_dialog.reboot_notice")}</p>
          </div>
        )}

        {/* Error from the start request (not step-level) */}
        {error && !applyState && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Partial / failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <div className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{applyState.error}</span>
          </div>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
            <XCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{applyState.error}</span>
          </div>
        )}

        {/* Footer — height reserved (min-h) so a button appearing at a terminal
            state doesn't resize the dialog. Buttons render only when actionable. */}
        <div className="flex min-h-9 justify-end gap-2">
          {(isTerminal || (error && !applyState)) && (
            <>
              {canRetry && (
                <Button variant="outline" onClick={onRetry}>
                  <RotateCwIcon className="size-4" />
                  {t("actions.retry", { ns: "common" })}
                </Button>
              )}
              <Button
                variant={canRetry ? "default" : "outline"}
                onClick={onClose}
              >
                {t("actions.close", { ns: "common" })}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
// RotateCwIcon stays lucide: it is passed to the shared `Banner` primitive's
// `icon` prop, which is typed `LucideIcon` on purpose — Banner is
// route-agnostic and stays on lucide-react everywhere it mounts (see
// banner.tsx's Icon-Boundary Rule note).
import { RotateCwIcon } from "lucide-react";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/ui/banner";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { transitionStandard } from "@/lib/motion";
import { LEDGER_SHAPE, PILL_ACTION, ledgerStepTone } from "./shapes";

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
// only (scaleX) on the system standard curve — the motion canon puts meter
// fills there — and collapses to instant under prefers-reduced-motion.
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

// "primary" stands in for the old "info" tone. Per shapes.ts's Tone Rule,
// `info` has no tone steps by design — the Info-Is-Brand Rule routes every
// in-progress surface to the brand fill (`primary` / `primary-container`),
// never a separate info hue.
type Tone = "primary" | "success" | "warning" | "destructive";

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
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/**
 * Glyph-Disc Rule: a state icon sits in a filled circle on the role's STRONG
 * fill (`bg-{role} text-{role}-foreground`), never a washed border+tint. This
 * replaces the retired `border-{role}/20 bg-{role}/10 text-{role}` ring, which
 * is exactly the pattern `Banner`'s own header comment documents retiring for
 * the reboot notice below.
 */
const HERO_FILL: Record<Tone, string> = {
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};

/** The large hero glyph for the current overall state. */
function HeroGlyph({ tone, status }: { tone: Tone; status: string }) {
  const name =
    status === "complete"
      ? "check_circle"
      : status === "partial"
        ? "do_not_disturb_on"
        : status === "failed"
          ? "cancel"
          : null;

  return (
    <span
      className={cn(
        "flex size-14 items-center justify-center rounded-pill",
        HERO_FILL[tone],
      )}
    >
      {name ? (
        <MaterialSymbol name={name} filled size={28} />
      ) : (
        // In-flight: a calm pulsing ellipsis (not a spinner) so the focal glyph
        // reads as "working" without the rotation that competes with the fill bar.
        <MaterialSymbol
          name="more_horiz"
          filled
          size={28}
          className="animate-pulse motion-reduce:animate-none"
        />
      )}
    </span>
  );
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
          : "primary";

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
      <DialogContent className="rounded-card border-0 sm:max-w-md">
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
          <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-pill">
            <motion.div
              className={cn(
                "h-full w-full origin-left rounded-pill",
                TONE_FILL[tone],
              )}
              initial={false}
              animate={{ scaleX: fraction }}
              transition={
                reduceMotion ? { duration: 0 } : transitionStandard
              }
            />
          </div>
        </div>

        {/* Supporting ledger — the shipped step-ledger pattern from
            `sms/delete-dialogs.tsx`'s `DeleteProgress`: an `aria-live` list of
            tonal steps, each carrying its own container fill AND a distinct
            glyph. No outer border/box — the tonal fill on each row is what
            carries separation (No-Hairline-On-Fill), so a wrapping card would
            just be a second layer of framing around framing that already
            exists. */}
        {steps.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-on-surface-variant px-1 text-xs font-medium">
              {t("custom_profiles.apply_dialog.details_label")}
            </p>
            <ul className={LEDGER_SHAPE.LIST} aria-live="polite">
              {steps.map((step) => {
                const eff = effectiveStatus(step.status, applyState?.status);
                const detailText =
                  eff === "skipped"
                    ? t("custom_profiles.apply_dialog.step_state_unchanged")
                    : step.detail;
                const { fill, glyph, spin } = ledgerStepTone(eff);
                return (
                  <li
                    key={step.name}
                    className={cn(
                      LEDGER_SHAPE.STEP,
                      "transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
                      fill,
                    )}
                  >
                    <MaterialSymbol
                      name={glyph}
                      filled
                      size={18}
                      className={cn(
                        LEDGER_SHAPE.GLYPH,
                        spin && "animate-spin motion-reduce:animate-none",
                      )}
                    />
                    <span className="flex-1 font-semibold">
                      {stepLabels[step.name] ?? step.name}
                    </span>
                    {detailText && (
                      <span className="max-w-[45%] truncate text-xs opacity-80">
                        {detailText}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Reboot notice — deferred, never an inline reboot.
            Uses the Banner primitive's `in-progress` role: a solid
            `primary-container` rather than the retired `border-info/30
            bg-info/10` wash, which collapsed in dark mode and washed out first
            in sunlight — the exact condition this notice has to survive, since
            it is read beside the modem. The explicit glyph overrides the role's
            default spinner: the reboot is deferred, not running. */}
        {applyState?.requires_reboot && (
          <Banner
            role="in-progress"
            icon={RotateCwIcon}
            description={t("custom_profiles.apply_dialog.reboot_notice")}
          />
        )}

        {/* Error from the start request (not step-level). This is the exact
            `border-destructive/30 bg-destructive/10` wash the reboot notice
            above already retired — ported onto `TonalBanner`, the card-scoped
            sibling of `Banner` (Material glyph, `rounded-field`, solid
            container). */}
        {error && !applyState && (
          <TonalBanner tone="destructive" icon="warning" size="compact">
            {error}
          </TonalBanner>
        )}

        {/* Partial / failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <TonalBanner tone="warning" icon="warning" size="compact">
            {applyState.error}
          </TonalBanner>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <TonalBanner tone="destructive" icon="cancel" size="compact">
            {applyState.error}
          </TonalBanner>
        )}

        {/* Footer — height reserved (min-h) so a button appearing at a terminal
            state doesn't resize the dialog. Buttons render only when actionable.
            Primary = default variant + pill shape; secondary = `tonal`, never
            `outline` (a hand-rolled `ghost` + container override loses its hover
            in dark mode — see CLAUDE.md's Buttons rule). */}
        <div className="flex min-h-9 justify-end gap-2">
          {(isTerminal || (error && !applyState)) && (
            <>
              {canRetry && (
                <Button variant="tonal" onClick={onRetry} className={PILL_ACTION}>
                  <MaterialSymbol name="restart_alt" size={16} />
                  {t("actions.retry", { ns: "common" })}
                </Button>
              )}
              <Button
                variant={canRetry ? "default" : "tonal"}
                onClick={onClose}
                className={PILL_ACTION}
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

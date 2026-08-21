"use client";

import { useMemo } from "react";
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
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { cn } from "@/lib/utils";
import { transitionStandard } from "@/lib/motion";
import {
  APPLY_DIALOG_PANEL,
  LEDGER_BAR,
  LEDGER_SHAPE,
  LEDGER_VALUE,
  MACHINE_VALUE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  ledgerStepTone,
} from "./shapes";

import type {
  ProfileApplyState,
  ApplyStatus,
  ApplyStep,
  ApplyStepStatus,
} from "@/types/sim-profile";

// =============================================================================
// ApplyProgressDialog — the Sequenced Pipeline Dialog
// =============================================================================
// QManager's signature shape for irreversible, multi-step apply pipelines. A
// justified modal: profile activation reconfigures a live modem, and the device
// serving this page is the device being configured.
//
// Composition, top to bottom: a status HERO (one glyph disc, the step in flight
// or the terminal verdict, and the step counter), one determinate bar, then the
// DETAILS LEDGER, then a notice, then actions.
//
// THE LEDGER IS THE POINT OF THIS REBUILD. Every step row now carries a
// right-aligned machine value — `ApplyStep.detail`, verbatim from the worker.
// The previous ledger said a step was "done" without saying what it did, which
// is exactly the opaque progress the State-Honesty Rule exists to stop: "APN
// Configuration ✓" is not an answer to "which APN landed?". `detail` carries
// the APN and CID that were written, the reason a step was skipped, or the raw
// `+CME ERROR: n` a failed step returned. It is rendered verbatim and NEVER
// synthesized — an empty `detail` renders an empty slot, not a guess.
//
// RM520N contract: EXACTLY 4 steps in worker/serialization order —
// apn → ttl_hl → scenario → imei. (No `mpdn_rule`; MPDN is RM551E-only.) IMEI
// is last because it carries the deferred reboot.
//
// THE APPLY IS ALL-OR-NOTHING ON RETRY. `qmanager_profile_apply` re-runs the
// whole four-step sequence or nothing; there is no per-step endpoint. So the
// action reads "Reapply profile", not the mock's "Retry IMEI" — a per-step
// retry label claims a capability the backend does not have.
//
// Icons: this dialog mounts only under `/cellular/`, a Material Symbols route,
// and `ledgerStepTone` already returns a `MaterialSymbolName`. Material end to
// end, with `size` explicit at every call site.
// =============================================================================

interface ApplyProgressDialogProps {
  open: boolean;
  onClose: () => void;
  applyState: ProfileApplyState | null;
  error: string | null;
  /**
   * Called when the user reapplies from a partial/failed terminal state. This
   * re-runs the ENTIRE four-step sequence — see the all-or-nothing note above.
   */
  onRetry?: () => void;
}

/**
 * The placeholder ledger shown between opening the dialog and the first poll
 * response. Order MUST mirror the worker's execution order so the list does not
 * reshuffle when real data lands. Details are empty because nothing has run —
 * the value slot stays blank rather than inventing a "Waiting…".
 */
const DEFAULT_STEPS: ApplyStep[] = [
  { name: "apn", status: "pending", detail: "" },
  { name: "ttl_hl", status: "pending", detail: "" },
  { name: "scenario", status: "pending", detail: "" },
  { name: "imei", status: "pending", detail: "" },
];

/**
 * The hero, keyed on the apply status.
 *
 * `disc` is a FILL pair (`bg-{role}` + its own `-foreground`), never a
 * container pair and never a hardcoded ink. The mock draws the partial disc as
 * `background: var(--wa)` with a literal `color: oklch(0.20 0.06 70)` — that
 * breaks the Container-Pair Rule and inverts in dark mode, where the warning
 * fill is LIGHT and a dark literal ink is the only thing on screen that did not
 * flip. `text-warning-foreground` is the token that tracks the fill.
 *
 * Every status carries a DISTINCT glyph. `primary` and `success` sit close in
 * lightness and are identical under deuteranopia, so the glyph — not the fill —
 * is what separates "still working" from "finished".
 */
const HERO: Record<
  ApplyStatus,
  { disc: string; bar: string; glyph: MaterialSymbolName; loop: boolean }
> = {
  // `idle` only occurs in the frame between `open` flipping true and the first
  // poll; it deliberately renders identically to `applying` so the dialog does
  // not flash a second state on the way in.
  idle: {
    disc: "bg-primary text-primary-foreground",
    bar: "bg-primary",
    glyph: "progress_activity",
    loop: true,
  },
  applying: {
    disc: "bg-primary text-primary-foreground",
    bar: "bg-primary",
    glyph: "progress_activity",
    loop: true,
  },
  complete: {
    disc: "bg-success text-success-foreground",
    bar: "bg-success",
    glyph: "check_circle",
    loop: false,
  },
  partial: {
    disc: "bg-warning text-warning-foreground",
    bar: "bg-warning",
    glyph: "do_not_disturb_on",
    loop: false,
  },
  failed: {
    disc: "bg-destructive text-destructive-foreground",
    bar: "bg-destructive",
    glyph: "cancel",
    loop: false,
  },
};

/** Does this step count as traversed for the determinate fill? */
function isTraversed(status: ApplyStepStatus): boolean {
  return status === "done" || status === "skipped";
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

  // Written out as four explicit keys rather than a template lookup so a plain
  // grep of the codebase finds every one of them. The worker's step names are a
  // fixed four-member contract, not an open set.
  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      apn: t("custom_profiles.apply_dialog.step_labels.apn"),
      ttl_hl: t("custom_profiles.apply_dialog.step_labels.ttl_hl"),
      scenario: t("custom_profiles.apply_dialog.step_labels.scenario"),
      imei: t("custom_profiles.apply_dialog.step_labels.imei"),
    }),
    [t],
  );

  const status: ApplyStatus = applyState?.status ?? (open ? "applying" : "idle");
  const isTerminal =
    status === "complete" || status === "partial" || status === "failed";
  const startFailed = !!error && !applyState;
  /**
   * The dialog is a trap while the apply is in flight — closing mid-sequence
   * strands the user with no route back to the progress, and the worker keeps
   * running regardless. It becomes dismissable (X, Esc, outside click, Close)
   * the moment there is a verdict to leave with.
   */
  const dismissable = isTerminal || startFailed;

  const steps = applyState?.steps ?? (open ? DEFAULT_STEPS : []);
  const hero = HERO[status];

  // ---------------------------------------------------------------------------
  // The determinate fraction
  // ---------------------------------------------------------------------------
  // Deliberately TRAVERSED steps over total, not `current_step / total_steps`.
  // The worker increments `current_step` in `mark_step_running`, so the literal
  // ratio reads 25% before the first step has written anything to the modem —
  // it reports what has been *started*, and a progress bar reports what has been
  // *finished*. A completed apply pins to 1 regardless, so a skipped-heavy run
  // does not land at 75% with nothing left to do.
  const total = applyState?.total_steps || steps.length || 0;
  const traversed = steps.filter((s) => isTraversed(s.status)).length;
  const fraction =
    status === "complete" ? 1 : total > 0 ? traversed / total : 0;

  const runningStep = steps.find((s) => s.status === "running");
  const failedCount = steps.filter((s) => s.status === "failed").length;
  // A "partial" verdict with no per-step failure still owes the user a number;
  // 1 is the floor, never 0 ("Applied with 0 steps left over" is nonsense).
  const leftOver = Math.max(failedCount, 1);

  const headline =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_headline")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_hero_headline", {
            count: leftOver,
          })
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_headline")
          : runningStep
            ? (stepLabels[runningStep.name] ?? runningStep.name)
            : t("custom_profiles.apply_dialog.preparing");

  const subtext =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_sub")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_hero_sub", {
            count: leftOver,
          })
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_sub")
          : null;

  // The step counter is machine voice — a position in a fixed sequence, not a
  // sentence. Mono + tabular so the digit does not shift the line as it climbs.
  const counter =
    !isTerminal && total > 0
      ? t("custom_profiles.apply_dialog.step_progress", {
          current: Math.min(applyState?.current_step || traversed + 1, total),
          total,
        })
      : null;

  const canRetry = !!onRetry && (status === "partial" || status === "failed");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissable) onClose();
      }}
    >
      <DialogContent
        className={APPLY_DIALOG_PANEL}
        showCloseButton={dismissable}
        // Radix's `onOpenChange` guard above already refuses the close; these
        // cancel the gesture at source so an outside click while applying does
        // not bounce focus out of the dialog on its way to being ignored.
        onInteractOutside={(e) => {
          if (!dismissable) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!dismissable) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("custom_profiles.apply_dialog.title")}</DialogTitle>
          {/* Required, always rendered: the profile name when we have one, the
              generic line before the first poll. An omitted DialogDescription
              leaves the Radix dialog without an accessible description. */}
          <DialogDescription>
            {applyState?.profile_name ||
              t("custom_profiles.apply_dialog.description")}
          </DialogDescription>
        </DialogHeader>

        {/* --- Hero ---------------------------------------------------------
            One focal point. The text block reserves a fixed two-line height so
            advancing from step to step never resizes the dialog under the
            pointer. */}
        <div className="flex min-w-0 flex-col items-center gap-3 py-1 text-center">
          <span
            className={cn(
              "grid size-14 flex-none place-items-center rounded-pill",
              hero.disc,
            )}
          >
            <MaterialSymbol
              name={hero.glyph}
              filled
              size={28}
              className={cn(
                // ONE-SCALE exception: a continuous in-progress loop, not a
                // transition. `progress_activity` is a spinner glyph — it
                // reads as "working" by rotating, the same way the ledger's
                // own running row spins its glyph below. `animate-spin` is
                // the shared rotation clock; there is no ambient-duration
                // variant of it to retune separately.
                hero.loop && "animate-spin motion-reduce:animate-none",
              )}
            />
          </span>

          <div className="flex min-h-[2.75rem] flex-col justify-center gap-1">
            <p className="text-base leading-tight font-semibold tracking-tight text-balance">
              {headline}
            </p>
            {subtext && (
              <p className="text-on-surface-variant text-sm text-pretty">
                {subtext}
              </p>
            )}
            {counter && (
              <p className={cn("text-on-surface-variant text-sm", MACHINE_VALUE)}>
                {counter}
              </p>
            )}
          </div>

          {/* Determinate bar. TRANSFORM-ONLY: `scaleX` from a left origin,
              never `width` — the mock animates width, and the one sanctioned
              width animation in the product is the carrier-aggregation segment
              strip. This bar advances in four discrete jumps as steps land, so
              it takes the standard state-change curve rather than `ease-linear`:
              linear is for a continuously-streaming value, and each jump here is
              a state change with a start and an end. Under reduced motion it
              snaps, keeping the value visible without the travel. */}
          <div
            className={LEDGER_BAR.TRACK}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total || 1}
            aria-valuenow={status === "complete" ? total || 1 : traversed}
          >
            <motion.div
              className={cn(LEDGER_BAR.FILL, "w-full", hero.bar)}
              initial={false}
              animate={{ scaleX: fraction }}
              transition={reduceMotion ? { duration: 0 } : transitionStandard}
            />
          </div>
        </div>

        {/* --- Details ledger ----------------------------------------------
            One row per REAL backend step. No invented stages: the SMS
            `DeleteProgress` precedent split a genuine backend call rather than
            animate a two-step UI over one opaque request. */}
        {steps.length > 0 && (
          // `LEDGER_SHAPE.ROOT` carries `min-w-0`, and this element is the
          // direct grid item of `DialogContent` (`display:grid`, one implicit
          // `auto` track). That `min-w-0` is what pins the track to
          // `sm:max-w-md` instead of to the longest `detail` string the modem
          // returns — see THE MIN-CONTENT CHAIN in `shapes.ts`. It is not
          // interchangeable with the `min-w-0` on the list or the step.
          <div className={LEDGER_SHAPE.ROOT}>
            <p className="text-on-surface-variant px-1 text-xs font-medium">
              {t("custom_profiles.apply_dialog.details_label")}
            </p>
            <ul className={LEDGER_SHAPE.LIST} aria-live="polite">
              {steps.map((step) => {
                const { fill, glyph, spin } = ledgerStepTone(step.status);
                return (
                  <li
                    key={step.name}
                    className={cn(
                      LEDGER_SHAPE.STEP,
                      "gap-2.5 transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
                      fill,
                    )}
                  >
                    <MaterialSymbol
                      name={glyph}
                      filled={step.status !== "pending"}
                      size={18}
                      className={cn(
                        LEDGER_SHAPE.GLYPH,
                        // ONE-SCALE exception, as above: a continuous loop with
                        // its own tempo, not a transition on the duration scale.
                        spin && "animate-spin motion-reduce:animate-none",
                      )}
                    />
                    <span className={LEDGER_SHAPE.LABEL}>
                      {stepLabels[step.name] ?? step.name}
                    </span>
                    {/* `ApplyStep.detail`, VERBATIM. Never synthesized: an
                        empty detail renders an empty slot.

                        The slot is SHRINKABLE (`LEDGER_SHAPE.VALUE`), never
                        `flex-none`. A non-shrinkable sibling cannot give way,
                        so the long form ("Set APN to telstra.internet (CID 1)",
                        or a raw `+CME ERROR:` payload) pushed the row past the
                        panel and got sheared off at the padding edge instead of
                        ellipsizing inside its own row. `title` keeps the full
                        string reachable either way. */}
                    {step.detail ? (
                      <span
                        className={cn(LEDGER_VALUE, LEDGER_SHAPE.VALUE)}
                        title={step.detail}
                      >
                        {step.detail}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* --- Notices ------------------------------------------------------
            Container pairs at `rounded-field`, never an opacity wash and never
            out-rounding the `rounded-card` dialog hosting them. */}

        {/* Deferred reboot. The app runs ON the modem, so an inline reboot
            would kill the very response reporting it — nothing reboots here. */}
        {applyState?.requires_reboot && (
          <TonalBanner tone="info" icon="restart_alt" size="compact">
            {t("custom_profiles.apply_dialog.reboot_notice_deferred")}
          </TonalBanner>
        )}

        {/* The start request itself failed — no state to report on. */}
        {startFailed && (
          <TonalBanner tone="destructive" icon="warning" size="compact">
            {error}
          </TonalBanner>
        )}

        {/* Partial: some of the profile is live. The body always states that
            reapplying re-runs the whole sequence, because the retry button
            beside it is a whole-sequence button. */}
        {status === "partial" && (
          <TonalBanner
            tone="warning"
            icon="warning"
            title={
              applyState?.error ||
              t("custom_profiles.apply_dialog.partial_notice_title")
            }
          >
            {t("custom_profiles.apply_dialog.reapply_notice")}
          </TonalBanner>
        )}

        {status === "failed" && (
          <TonalBanner
            tone="destructive"
            icon="cancel"
            title={
              applyState?.error ||
              t("custom_profiles.apply_dialog.failed_notice_title")
            }
          >
            {t("custom_profiles.apply_dialog.reapply_notice")}
          </TonalBanner>
        )}

        {/* --- Actions ------------------------------------------------------
            Height reserved so a button appearing at a terminal state does not
            resize the dialog. Nothing renders while applying — there is no
            honest action to offer mid-sequence. */}
        <div className="flex min-h-10 items-center justify-end gap-2">
          {dismissable && (
            <>
              {canRetry && (
                <Button
                  variant="tonal"
                  onClick={onRetry}
                  className={PILL_ACTION}
                >
                  <MaterialSymbol name="restart_alt" size={16} />
                  {t("custom_profiles.apply_dialog.reapply_action")}
                </Button>
              )}
              <Button
                variant={canRetry ? "default" : "tonal"}
                onClick={onClose}
                className={PILL_ACTION_PLAIN}
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

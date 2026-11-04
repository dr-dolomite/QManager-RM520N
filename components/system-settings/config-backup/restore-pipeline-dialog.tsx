"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  InfoIcon,
  Loader2Icon,
  MinusCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { useMotionReduced } from "@/components/motion-preference";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { transitionStandard } from "@/lib/motion";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { isSectionKey } from "@/lib/config-backup/sections";
import { cn } from "@/lib/utils";
import type { BackupSectionKey, RestoreProgress, SectionProgress } from "@/types/config-backup";

import { NOTICE, PIPELINE, PIPELINE_TONE, type PipelineTone } from "../shapes";

const K = "config_backup.pipeline";

/** Where the run is: the hook's progress plus whether it reached the end. */
export type PipelinePhase = "starting" | "running" | "done" | "start_failed";

interface RestorePipelineDialogProps {
  open: boolean;
  phase: PipelinePhase;
  /** The sections being restored, shown as pending until the first poll. */
  planned: BackupSectionKey[];
  progress: RestoreProgress | null;
  /** The backend code when the run could not start or was lost. */
  startError: string | null;
  startDetail: string | null;
  sourceModel: string;
  stopping: boolean;
  onStop: () => void;
  onClose: () => void;
}

type StepTone = "done" | "running" | "retrying" | "failed" | "skipped" | "pending";

function stepTone(status: SectionProgress["status"]): StepTone {
  if (status === "success") return "done";
  if (status === "running") return "running";
  if (status.startsWith("retrying:")) return "retrying";
  if (status === "failed") return "failed";
  if (status.startsWith("skipped")) return "skipped";
  return "pending";
}

// Ink on the ledger's neutral row; the running row is promoted and takes its own ink.
const STEP_GLYPH: Record<StepTone, { icon: LucideIcon; ink: string; spin?: boolean }> = {
  done: { icon: CheckCircle2Icon, ink: "text-success-on-surface" },
  running: { icon: Loader2Icon, ink: "", spin: true },
  retrying: { icon: RefreshCwIcon, ink: "text-warning-on-surface", spin: true },
  failed: { icon: XCircleIcon, ink: "text-destructive-on-surface" },
  skipped: { icon: MinusCircleIcon, ink: "text-on-surface-variant" },
  pending: { icon: CircleDashedIcon, ink: "text-on-surface-variant" },
};

const HERO_GLYPH: Record<Exclude<PipelineTone, "info">, LucideIcon> = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  destructive: XCircleIcon,
};

export function RestorePipelineDialog({
  open,
  phase,
  planned,
  progress,
  startError,
  startDetail,
  sourceModel,
  stopping,
  onStop,
  onClose,
}: RestorePipelineDialogProps) {
  const { t } = useTranslation("system-settings");
  const reduceMotion = useMotionReduced();

  const steps: SectionProgress[] =
    progress?.sections && progress.sections.length > 0
      ? progress.sections
      : planned.map((key) => ({ key, status: "pending", attempts: 0 }));

  const terminal = phase === "done" || phase === "start_failed";
  const failed = steps.filter((s) => s.status === "failed").length;
  const skipped = steps.filter((s) => s.status.startsWith("skipped")).length;
  const restored = steps.filter((s) => s.status === "success").length;
  const cancelled = progress?.status === "cancelled";
  const crashed = progress?.status === "crashed";

  const tone: PipelineTone =
    phase === "start_failed" || crashed || (phase === "done" && restored === 0 && failed > 0)
      ? "destructive"
      : phase === "done" && (failed > 0 || skipped > 0 || cancelled)
        ? "warning"
        : phase === "done"
          ? "success"
          : "info";

  const total = steps.length;
  const traversed = steps.filter((s) => {
    const tn = stepTone(s.status);
    return tn === "done" || tn === "failed" || tn === "skipped";
  }).length;
  const fraction = phase === "start_failed" && !progress ? 0 : total > 0 ? traversed / total : 0;

  const running = steps.find((s) => {
    const tn = stepTone(s.status);
    return tn === "running" || tn === "retrying";
  });

  const nameOf = (key: string) => (isSectionKey(key) ? t(`config_backup.sections.${key}`) : key);

  const headline =
    tone === "success"
      ? t(`${K}.done_headline`)
      : tone === "warning"
        ? t(`${K}.partial_headline`)
        : tone === "destructive"
          ? t(`${K}.failed_headline`)
          : stopping
            ? t(`${K}.stopping`)
            : running
              ? nameOf(running.key)
              : t(`${K}.preparing`);

  const subtext =
    tone === "success"
      ? t(`${K}.done_sub`, { count: restored })
      : tone === "warning"
        ? cancelled
          ? t(`${K}.cancelled_sub`)
          : t(`${K}.partial_sub`, { restored, total })
        : tone === "destructive"
          ? phase === "start_failed"
            ? resolveErrorMessage(t, startError, startDetail, t(`${K}.failed_sub`))
            : crashed
              ? t(`${K}.crashed_sub`)
              : t(`${K}.failed_sub`)
          : running
            ? t(`${K}.step_progress`, { current: Math.min(traversed + 1, total), total })
            : null;

  const detailFor = (s: SectionProgress): string | null => {
    if (s.status === "skipped:incompatible") return t(`${K}.detail_incompatible`);
    if (s.status === "skipped:not_supported") return t(`${K}.detail_not_supported`);
    if (s.status === "skipped:sim_mismatch") return t(`${K}.detail_sim_mismatch`);
    if (s.status.startsWith("skipped")) return t(`${K}.detail_unchanged`);
    if (s.status.startsWith("retrying:"))
      return t(`${K}.detail_retrying`, { n: s.status.split(":")[1] });
    if (s.status === "failed") return t(`${K}.detail_failed`);
    return null;
  };

  const notesFor = (s: SectionProgress): string[] => {
    const out: string[] = [];
    if ((s.ignored_keys ?? 0) > 0) out.push(t(`${K}.note_ignored`, { count: s.ignored_keys }));
    if ((s.dropped ?? 0) > 0) out.push(t(`${K}.note_dropped`, { count: s.dropped }));
    return out;
  };

  const HeroGlyph = tone === "info" ? null : HERO_GLYPH[tone];
  const showLedger = total > 0 && !(phase === "start_failed" && !progress);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && terminal && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        showCloseButton={false}
        // Not dismissible until terminal: a half-finished restore is never abandoned by accident.
        onEscapeKeyDown={(e) => !terminal && e.preventDefault()}
        onInteractOutside={(e) => !terminal && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t(`${K}.title`)}</DialogTitle>
          <DialogDescription>{t(`${K}.description`, { model: sourceModel || "—" })}</DialogDescription>
        </DialogHeader>

        <div className={PIPELINE.HERO} role="status" aria-live="polite">
          <span className={cn(PIPELINE.DISC, PIPELINE_TONE[tone].disc)} aria-hidden="true">
            {HeroGlyph ? (
              <HeroGlyph className={PIPELINE.GLYPH} />
            ) : (
              <Loader2Icon className={cn(PIPELINE.GLYPH, "motion-safe:animate-spin")} />
            )}
          </span>
          <div className={PIPELINE.TEXT}>
            <p className={PIPELINE.HEADLINE}>{headline}</p>
            {subtext ? <p className={PIPELINE.SUB}>{subtext}</p> : null}
          </div>
          <div
            className={PIPELINE.TRACK}
            role="progressbar"
            aria-label={t(`${K}.progress_aria`)}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={traversed}
          >
            <motion.div
              className={cn(PIPELINE.FILL, PIPELINE_TONE[tone].fill)}
              initial={false}
              animate={{ scaleX: fraction }}
              transition={reduceMotion ? { duration: 0 } : transitionStandard}
            />
          </div>
        </div>

        {showLedger ? (
          <ul className={PIPELINE.LEDGER} aria-label={t(`${K}.ledger_aria`)}>
            {steps.map((s) => {
              const tn = stepTone(s.status);
              const g = STEP_GLYPH[tn];
              const Icon = g.icon;
              const isRunning = tn === "running";
              const detail = detailFor(s);
              const notes = notesFor(s);
              return (
                <li key={s.key} className={cn(PIPELINE.STEP, isRunning && PIPELINE.STEP_RUNNING)}>
                  <Icon
                    className={cn(
                      PIPELINE.STEP_GLYPH,
                      !isRunning && g.ink,
                      g.spin && "motion-safe:animate-spin",
                    )}
                    aria-hidden="true"
                  />
                  <span className={PIPELINE.STEP_TEXT}>
                    <span
                      className={cn(PIPELINE.STEP_NAME, tn === "pending" && "text-on-surface-variant")}
                    >
                      {nameOf(s.key)}
                    </span>
                    {notes.map((n) => (
                      <span
                        key={n}
                        className={cn(
                          PIPELINE.STEP_NOTE,
                          isRunning ? "opacity-90" : "text-on-surface-variant",
                        )}
                      >
                        {n}
                      </span>
                    ))}
                  </span>
                  {detail ? (
                    <span
                      className={cn(
                        PIPELINE.STEP_DETAIL,
                        isRunning ? "opacity-90" : "text-on-surface-variant",
                      )}
                    >
                      {detail}
                    </span>
                  ) : (
                    <span className="sr-only">{t(`${K}.state_${tn}`)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {/* Deferred-reboot row: a calm notice, never an inline reboot. */}
        {progress?.reboot_required ? (
          <div className={cn(NOTICE.BOX, "bg-primary-container text-on-primary-container")}>
            <RotateCcwIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.reboot_notice`)}</span>
          </div>
        ) : null}

        {phase === "done" && failed > 0 ? (
          <div className={cn(NOTICE.BOX, "bg-surface-container text-on-surface")}>
            <InfoIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.failed_hint`)}</span>
          </div>
        ) : null}

        {/* Reserved height so the action swap never resizes the dialog. */}
        <DialogFooter className="min-h-[2.625rem]">
          {terminal ? (
            <Button size="action" onClick={onClose}>
              {t(`${K}.close`)}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="action"
              onClick={onStop}
              disabled={phase === "starting" || cancelled || stopping}
            >
              {stopping ? (
                <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : null}
              {t(`${K}.stop`)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RestorePipelineDialog;

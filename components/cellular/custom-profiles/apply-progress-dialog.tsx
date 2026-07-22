"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TbCircleCheck,
  TbCircleX,
  TbLoader2,
  TbClock,
} from "react-icons/tb";
import {
  CheckCircle2Icon,
  Loader2Icon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import type {
  ProfileApplyState,
  ApplyStepStatus,
} from "@/types/sim-profile";

// =============================================================================
// ApplyProgressDialog — Shows step-by-step profile application progress
// =============================================================================

interface ApplyProgressDialogProps {
  open: boolean;
  onClose: () => void;
  applyState: ProfileApplyState | null;
  error: string | null;
  /** Called when the user clicks Retry on a partial/failed terminal state */
  onRetry?: () => void;
}

const stepIcons: Record<ApplyStepStatus, React.ReactNode> = {
  pending: <TbClock className="size-4 text-muted-foreground" />,
  running: <TbLoader2 className="size-4 text-info animate-spin" />,
  done: <TbCircleCheck className="size-4 text-success" />,
  failed: <TbCircleX className="size-4 text-destructive" />,
  // Skipped = value already matches modem state. Muted check reads as
  // "nothing to do" both transiently and at completion — no retroactive remap.
  skipped: <TbCircleCheck className="size-4 text-muted-foreground" />,
};

const stepLabels: Record<string, string> = {
  apn: "APN Configuration",
  ttl_hl: "TTL / Hop Limit",
  scenario: "Connection Scenario",
  imei: "IMEI",
};

const statusBadge = (status: string) => {
  switch (status) {
    case "applying":
      return (
        <Badge
          variant="outline"
          className="bg-info/15 text-info hover:bg-info/20 border-info/30"
        >
          <Loader2Icon className="size-3 animate-spin" />
          Applying…
        </Badge>
      );
    case "complete":
      return (
        <Badge
          variant="outline"
          className="bg-success/15 text-success hover:bg-success/20 border-success/30"
        >
          <CheckCircle2Icon className="size-3" />
          Complete
        </Badge>
      );
    case "partial":
      return (
        <Badge
          variant="outline"
          className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
        >
          <TriangleAlertIcon className="size-3" />
          Partial
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="outline"
          className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
        >
          <XCircleIcon className="size-3" />
          Failed
        </Badge>
      );
    default:
      return null;
  }
};

export function ApplyProgressDialog({
  open,
  onClose,
  applyState,
  error,
  onRetry,
}: ApplyProgressDialogProps) {
  const isTerminal =
    applyState &&
    ["complete", "partial", "failed"].includes(applyState.status);

  const steps = applyState?.steps ?? [];

  // Resolve display status — when the dialog first opens with no applyState
  // yet, show "Applying…" badge so the user sees immediate feedback.
  const displayStatus = applyState?.status ?? (open ? "applying" : undefined);

  // Show Step N of M only while applying and the backend has populated counts.
  const showStepCounter =
    applyState?.status === "applying" &&
    applyState.total_steps > 0 &&
    applyState.current_step > 0;

  // Reboot heartbeat — only shown while the modem is actively unreachable.
  // A precise elapsed-seconds counter would require Date.now() in render
  // (flagged as impure by React Compiler), so we set expectations with
  // explanatory copy + the animated loader icon instead.
  const isRebooting =
    !!applyState?.requires_reboot && applyState.status === "applying";

  const canRetry =
    !!onRetry &&
    (applyState?.status === "partial" || applyState?.status === "failed");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isTerminal && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Applying Profile
            {displayStatus && statusBadge(displayStatus)}
          </DialogTitle>
          {(applyState?.profile_name || showStepCounter) && (
            <DialogDescription className="flex items-center gap-2">
              {applyState?.profile_name && <span>{applyState.profile_name}</span>}
              {showStepCounter && (
                <>
                  {applyState?.profile_name && (
                    <span className="text-muted-foreground/50" aria-hidden>
                      ·
                    </span>
                  )}
                  <span className="text-xs tabular-nums">
                    Step {applyState.current_step} of {applyState.total_steps}
                  </span>
                </>
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step list — populated from backend poll */}
        {steps.length > 0 ? (
          <div className="space-y-1 py-2">
            {steps.map((step) => (
              <div
                key={step.name}
                className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  step.status === "running"
                    ? "bg-info/5"
                    : ""
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {stepIcons[step.status]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {stepLabels[step.name] ?? step.name}
                  </div>
                  {step.detail ? (
                    <div className="text-muted-foreground text-xs truncate">
                      {step.detail}
                    </div>
                  ) : step.status === "skipped" ? (
                    <div className="text-muted-foreground text-xs">
                      Unchanged
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : open && !error ? (
          // Pre-first-poll: ~50-500ms window between starting the apply and the
          // first /apply_status.sh response. Render a single honest row instead
          // of a hard-coded placeholder list (the real count is 3 or 4 depending
          // on the RESOLVED scenario — i.e. the scenario in force now per the
          // schedule, not the static scenario_id — and we don't have that info
          // here).
          <div className="space-y-1 py-2">
            <div className="flex items-start gap-3 rounded-md px-3 py-2 text-sm bg-info/5">
              <div className="mt-0.5 shrink-0">
                <TbLoader2 className="size-4 text-info animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">Preparing…</div>
                <div className="text-muted-foreground text-xs">
                  Starting profile apply
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Reboot notice — heartbeat while modem is unreachable */}
        {isRebooting && (
          <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/15 p-3 text-sm text-info">
            <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin" />
            <div className="flex-1">
              <div>Modem is restarting to apply the IMEI change.</div>
              <div className="text-xs text-info/80 mt-0.5">
                This usually takes 30–60 seconds. The dashboard will reconnect
                automatically.
              </div>
            </div>
          </div>
        )}

        {/* Error from the start request (not step-level) */}
        {error && !applyState && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive">
            <XCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Partial/failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/15 p-3 text-sm text-warning">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{applyState.error}</span>
          </div>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive">
            <XCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{applyState.error}</span>
          </div>
        )}

        {/* Footer actions (only on terminal states) */}
        {(isTerminal || (error && !applyState)) && (
          <div className="flex justify-end gap-2 pt-2">
            {canRetry && (
              <Button variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
            <Button
              variant={canRetry ? "default" : "outline"}
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

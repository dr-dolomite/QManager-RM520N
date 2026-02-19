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
  TbCircleMinus,
} from "react-icons/tb";

import type {
  ProfileApplyState,
  ApplyStep,
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
}

/** Default steps shown while waiting for the first poll response */
const DEFAULT_STEPS: ApplyStep[] = [
  { name: "apn", status: "pending", detail: "" },
  { name: "ttl_hl", status: "pending", detail: "" },
  { name: "imei", status: "pending", detail: "" },
];

const stepIcons: Record<ApplyStepStatus, React.ReactNode> = {
  pending: <TbClock className="h-4 w-4 text-muted-foreground" />,
  running: <TbLoader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  done: <TbCircleCheck className="h-4 w-4 text-green-500" />,
  failed: <TbCircleX className="h-4 w-4 text-red-500" />,
  skipped: <TbCircleMinus className="h-4 w-4 text-muted-foreground" />,
};

/** When the overall apply is complete, "skipped" means "already correct" — show a check */
const getStepIcon = (stepStatus: ApplyStepStatus, overallStatus?: string) => {
  if (stepStatus === "skipped" && overallStatus === "complete") {
    return <TbCircleCheck className="h-4 w-4 text-green-500" />;
  }
  return stepIcons[stepStatus];
};

const stepLabels: Record<string, string> = {
  apn: "APN Configuration",
  ttl_hl: "TTL / Hop Limit",
  imei: "IMEI",
};

const statusBadge = (status: string) => {
  switch (status) {
    case "applying":
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800">
          Applying…
        </Badge>
      );
    case "complete":
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-green-200 dark:border-green-800">
          Complete
        </Badge>
      );
    case "partial":
      return (
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800">
          Partial
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800">
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
}: ApplyProgressDialogProps) {
  const isTerminal =
    applyState &&
    ["complete", "partial", "failed"].includes(applyState.status);

  // Use live steps from backend, or show default pending steps while waiting
  const steps = applyState?.steps ?? (open ? DEFAULT_STEPS : []);

  // Resolve display status — when the dialog first opens with no applyState
  // yet, show "Applying…" badge so the user sees immediate feedback.
  const displayStatus = applyState?.status ?? (open ? "applying" : undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isTerminal && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Applying Profile
            {displayStatus && statusBadge(displayStatus)}
          </DialogTitle>
          {applyState?.profile_name && (
            <DialogDescription>
              {applyState.profile_name}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step list — always visible when dialog is open */}
        {steps.length > 0 && (
          <div className="space-y-1 py-2">
            {steps.map((step) => (
              <div
                key={step.name}
                className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  step.status === "running"
                    ? "bg-blue-50 dark:bg-blue-950/50"
                    : ""
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {getStepIcon(step.status, applyState?.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {stepLabels[step.name] ?? step.name}
                  </div>
                  {step.detail && (
                    <div className="text-muted-foreground text-xs truncate">
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reboot notice */}
        {applyState?.requires_reboot && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-700 dark:text-blue-300">
            Modem is restarting to apply IMEI change. Dashboard will reconnect
            automatically.
          </div>
        )}

        {/* Error from the start request (not step-level) */}
        {error && !applyState && (
          <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Partial/failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <div className="rounded-md bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            {applyState.error}
          </div>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
            {applyState.error}
          </div>
        )}

        {/* Close button (only on terminal states) */}
        {(isTerminal || (error && !applyState)) && (
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2Icon,
  PlayIcon,
  DownloadIcon,
  Trash2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  TriangleAlertIcon,
  MinusCircleIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { HealthCheckJob } from "@/types/system-health-check";

interface SummaryCardProps {
  job: HealthCheckJob | null;
  isRunning: boolean;
  isStarting: boolean;
  isClearing: boolean;
  onRun: () => void;
  onClear: () => void;
  onDownload: () => void;
}

function formatRelative(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SummaryCard({
  job,
  isRunning,
  isStarting,
  isClearing,
  onRun,
  onClear,
  onDownload,
}: SummaryCardProps) {
  const hasRun = !!job;
  const summary = job?.summary;
  const canDownload = !!job && job.status === "complete" && !!job.tarball_path;
  const canClear = hasRun && !isRunning && !isStarting;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">System Health Check</CardTitle>
        <CardDescription>
          Run a full diagnostic of binaries, permissions, AT transport, services, and configuration. Download the bundle to share with support.
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={onRun} disabled={isRunning || isStarting}>
              {isRunning || isStarting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <PlayIcon className="size-4" />
                  Run Diagnostics
                </>
              )}
            </Button>
            {canDownload && (
              <Button onClick={onDownload} variant="outline">
                <DownloadIcon className="size-4" />
                Download Bundle
              </Button>
            )}
            {canClear && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isClearing}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {isClearing ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                    {isClearing ? "Clearing…" : "Clear"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear diagnostic results?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes the previous run, all per-test output files, and the downloadable bundle from the device. The page will reset to its empty state.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onClear}
                      className={buttonVariants({ variant: "destructive" })}
                    >
                      Clear results
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          {hasRun && summary ? (
            <>
              <Badge variant="success">
                <CheckCircle2Icon className="size-3" />
                {summary.pass} pass
              </Badge>
              <Badge variant="destructive">
                <XCircleIcon className="size-3" />
                {summary.fail} fail
              </Badge>
              <Badge variant="warning">
                <TriangleAlertIcon className="size-3" />
                {summary.warn} warn
              </Badge>
              <Badge variant="muted">
                <MinusCircleIcon className="size-3" />
                {summary.skip} skip
              </Badge>
              {job?.started_at && (
                <span className="text-xs text-muted-foreground ml-2">
                  {isRunning ? "Started " : "Last run "} {formatRelative(job.started_at)}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No diagnostics run yet.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

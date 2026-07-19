"use client";

import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDown,
  ArrowUp,
  Activity,
  Server,
  Globe,
  ExternalLink,
  Loader2,
  TriangleAlert,
  Play,
  RefreshCwIcon,
} from "lucide-react";
import { useSpeedtest, type SpeedtestPhase } from "@/hooks/use-speedtest";
import { bytesToMbps, formatSpeed, formatBytes } from "@/types/speedtest";

interface SpeedtestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// =============================================================================
// Phase Indicator — shows which test phase is active
// =============================================================================
function PhaseIndicator({ phase }: { phase: SpeedtestPhase }) {
  const { t } = useTranslation("dashboard");
  const phases: { key: SpeedtestPhase; label: string }[] = [
    { key: "ping", label: t("speedtest.phase_ping") },
    { key: "download", label: t("speedtest.phase_download") },
    { key: "upload", label: t("speedtest.phase_upload") },
  ];

  return (
    <div className="flex items-center justify-center gap-2">
      {phases.map((p, i) => {
        const isActive = p.key === phase;
        const isPast =
          phases.findIndex((x) => x.key === phase) >
          phases.findIndex((x) => x.key === p.key);

        return (
          <React.Fragment key={p.key}>
            {i > 0 && (
              <div
                className={`h-px w-6 ${isPast ? "bg-primary" : "bg-muted"}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  isActive
                    ? "bg-primary animate-pulse"
                    : isPast
                      ? "bg-primary"
                      : "bg-muted"
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isActive
                    ? "text-foreground"
                    : isPast
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                }`}
              >
                {p.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// =============================================================================
// Live Speed Display — shown during download/upload
// =============================================================================
function LiveSpeed({
  phase,
  bandwidth,
  progress,
  bytes,
}: {
  phase: "download" | "upload";
  bandwidth: number;
  progress: number;
  bytes: number;
}) {
  const { t } = useTranslation("dashboard");
  const Icon = phase === "download" ? ArrowDown : ArrowUp;
  const mbps = bytesToMbps(bandwidth);
  const pct = Math.round(progress * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <span className="text-sm font-medium">
            {t(`speedtest.phase_${phase}`)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("speedtest.bytes_transferred", { bytes: formatBytes(bytes) })}
        </span>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums tracking-tight">
          {mbps >= 100 ? mbps.toFixed(1) : mbps.toFixed(2)}
        </span>
        <span className="text-sm text-muted-foreground">Mbps</span>
      </div>

      <div className="space-y-1">
        <Progress value={pct} />
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Result Card — shown after test completes
// =============================================================================
function ResultDisplay({
  result,
}: {
  result: NonNullable<ReturnType<typeof useSpeedtest>["result"]>;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="space-y-4">
      {/* Primary metrics — three big numbers */}
      <div className="grid grid-cols-3 gap-3">
        {/* Download */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1 text-primary font-semibold">
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="text-xs">{t("speedtest.result_download")}</span>
          </div>
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-2xl font-bold tabular-nums">
              {formatSpeed(result.download.bandwidth)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              Mbps
            </span>
          </div>
        </div>

        {/* Upload */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1 text-primary font-semibold">
            <ArrowUp className="h-3.5 w-3.5" />
            <span className="text-xs">{t("speedtest.result_upload")}</span>
          </div>
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-2xl font-bold tabular-nums">
              {formatSpeed(result.upload.bandwidth)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              Mbps
            </span>
          </div>
        </div>

        {/* Ping */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-1 text-primary font-semibold">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-xs">{t("speedtest.result_ping")}</span>
          </div>
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-2xl font-bold tabular-nums">
              {result.ping.latency.toFixed(1)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              ms
            </span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_jitter")}
          </span>
          <span className="font-semibold tabular-nums">
            {result.ping.jitter.toFixed(1)} ms
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_packet_loss")}
          </span>
          <span className="font-semibold tabular-nums">
            {result.packetLoss !== undefined
              ? `${result.packetLoss.toFixed(2)}%`
              : "-"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_dl_latency")}
          </span>
          <span className="font-semibold tabular-nums">
            {result.download.latency.iqm.toFixed(1)} ms
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_ul_latency")}
          </span>
          <span className="font-semibold tabular-nums">
            {result.upload.latency.iqm.toFixed(1)} ms
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_dl_data")}
          </span>
          <span className="font-semibold tabular-nums">
            {formatBytes(result.download.bytes)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {t("speedtest.metric_ul_data")}
          </span>
          <span className="font-semibold tabular-nums">
            {formatBytes(result.upload.bytes)}
          </span>
        </div>
      </div>

      <Separator />

      {/* Server info */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5 text-primary" />
          <span className="text-primary font-semibold">
            {t("speedtest.result_server_heading")}
          </span>
          <span className="font-medium ml-auto">{result.server.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <span className="text-primary font-semibold">
            {t("speedtest.result_location")}
          </span>
          <span className="font-medium ml-auto">
            {result.server.location}, {result.server.country}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="text-primary font-semibold">
            {t("speedtest.result_isp")}
          </span>
          <span className="font-medium ml-auto">{result.isp}</span>
        </div>
      </div>

      {/* Result link */}
      {result.result?.url && (
        <a
          href={result.result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors pt-1 underline underline-offset-4"
        >
          <ExternalLink className="h-3 w-3" />
          {t("speedtest.view_result_link")}
        </a>
      )}
    </div>
  );
}

// =============================================================================
// Main Dialog Component
// =============================================================================
export function SpeedtestDialog({ open, onOpenChange }: SpeedtestDialogProps) {
  const { t } = useTranslation("dashboard");
  const {
    isAvailable,
    phase,
    progress,
    currentProgress,
    result,
    error,
    isRunning,
    servers,
    selectedServer,
    isLoadingServers,
    start,
    refreshStatus,
    fetchServers,
    setSelectedServer,
  } = useSpeedtest();

  // On dialog open: check status and fetch nearby servers
  useEffect(() => {
    if (open) {
      refreshStatus();
      fetchServers();
    }
  }, [open, refreshStatus, fetchServers]);

  // Prevent closing while test is running
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isRunning) return; // Block close while running
    onOpenChange(newOpen);
  };

  // Extract live bandwidth from progress data
  const liveBandwidth =
    currentProgress?.type === "download"
      ? currentProgress.download.bandwidth
      : currentProgress?.type === "upload"
        ? currentProgress.upload.bandwidth
        : 0;

  const liveBytes =
    currentProgress?.type === "download"
      ? currentProgress.download.bytes
      : currentProgress?.type === "upload"
        ? currentProgress.upload.bytes
        : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("speedtest.title")}
            {isRunning && (
              <Badge variant="default" className="text-[10px] font-normal">
                {t("speedtest.running_badge")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ============================================================= */}
          {/* IDLE — No test running, show start button */}
          {/* ============================================================= */}
          {phase === "idle" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <p className="text-sm text-muted-foreground text-center">
                {t("speedtest.dialog_idle_description")}
              </p>

              {/* Server selection */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t("speedtest.server_label")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={fetchServers}
                    disabled={isLoadingServers}
                    aria-label={t("speedtest.refresh_aria")}
                  >
                    <RefreshCwIcon className={`size-3.5 ${isLoadingServers ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                {isLoadingServers && servers.length === 0 ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select
                    value={selectedServer === null ? "auto" : String(selectedServer)}
                    onValueChange={(value) =>
                      setSelectedServer(value === "auto" ? null : Number(value))
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("speedtest.server_select_aria")}
                    >
                      <SelectValue placeholder={t("speedtest.server_automatic")} />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl max-h-64">
                      <SelectItem value="auto" className="rounded-lg">
                        {t("speedtest.server_automatic")}
                      </SelectItem>
                      {servers.map((s) => (
                        <SelectItem
                          key={s.id}
                          value={String(s.id)}
                          className="rounded-lg"
                        >
                          {s.name} — {s.location}, {s.country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Button onClick={start} disabled={!isAvailable} className="gap-2">
                <Play className="size-4" />
                {t("speedtest.run_button")}
              </Button>
              {isAvailable === false && (
                <p className="text-xs text-destructive">
                  {t("speedtest.not_installed_error")}
                </p>
              )}
            </div>
          )}

          {/* ============================================================= */}
          {/* INITIALIZING — Connecting to server */}
          {/* ============================================================= */}
          {phase === "initializing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {t("speedtest.connecting_message")}
              </p>
              {currentProgress?.type === "testStart" && (
                <p className="text-xs text-muted-foreground">
                  {currentProgress.server.name} —{" "}
                  {currentProgress.server.location}
                </p>
              )}
            </div>
          )}

          {/* ============================================================= */}
          {/* PING — Latency test */}
          {/* ============================================================= */}
          {phase === "ping" && (
            <div className="space-y-3 py-2">
              <PhaseIndicator phase="ping" />
              <div className="flex flex-col items-center gap-2 py-4">
                <Activity className="size-6 text-primary animate-pulse" />
                <span className="text-sm font-medium">
                  {t("speedtest.testing_latency_message")}
                </span>
                {currentProgress?.type === "ping" && (
                  <span className="text-2xl font-bold tabular-nums">
                    {currentProgress.ping.latency.toFixed(1)}{" "}
                    <span className="text-sm text-muted-foreground font-normal">
                      ms
                    </span>
                  </span>
                )}
              </div>
              <Progress value={Math.round(progress * 100)} />
            </div>
          )}

          {/* ============================================================= */}
          {/* DOWNLOAD — Speed test (download phase) */}
          {/* ============================================================= */}
          {phase === "download" && (
            <div className="space-y-3 py-2">
              <PhaseIndicator phase="download" />
              <LiveSpeed
                phase="download"
                bandwidth={liveBandwidth}
                progress={progress}
                bytes={liveBytes}
              />
            </div>
          )}

          {/* ============================================================= */}
          {/* UPLOAD — Speed test (upload phase) */}
          {/* ============================================================= */}
          {phase === "upload" && (
            <div className="space-y-3 py-2">
              <PhaseIndicator phase="upload" />
              <LiveSpeed
                phase="upload"
                bandwidth={liveBandwidth}
                progress={progress}
                bytes={liveBytes}
              />
            </div>
          )}

          {/* ============================================================= */}
          {/* COMPLETE — Show results */}
          {/* ============================================================= */}
          {phase === "complete" && result && (
            <div className="space-y-4">
              <ResultDisplay result={result} />
              <div className="flex justify-center pt-2">
                <Button onClick={start}>
                  <Play className="h-3.5 w-3.5" />
                  {t("speedtest.run_again_button")}
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================= */}
          {/* ERROR */}
          {/* ============================================================= */}
          {phase === "error" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <TriangleAlert className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button
                onClick={start}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                {t("speedtest.try_again_button")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

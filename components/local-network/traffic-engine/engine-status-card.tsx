"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import type { MasqueradeStatus, VideoOptimizerStatus } from "@/types/traffic-engine";

// =============================================================================
// engine-status-card — live engine state: status chip, uptime, packet rate,
// hostlist count (Video Optimizer mode only — masquerade applies to every
// connection and has nothing to count), and REDIRECT rule state.
// Polls arrive via the parent hooks' 2s cadence; packets/s is derived here
// from successive samples.
// =============================================================================

const ENGINE_TONE: Record<
  string,
  { variant: "success" | "warning" | "destructive" | "muted"; icon: ReactNode }
> = {
  running: { variant: "success", icon: <CheckCircle2Icon /> },
  restarting: { variant: "warning", icon: <TriangleAlertIcon /> },
  error: { variant: "destructive", icon: <XCircleIcon /> },
  stopped: { variant: "muted", icon: <MinusCircleIcon /> },
};

export interface EngineStatusCardProps {
  data: VideoOptimizerStatus | MasqueradeStatus | null;
  loading: boolean;
}

const EngineStatusCard = ({ data, loading }: EngineStatusCardProps) => {
  const { t } = useTranslation("common");

  const prevRef = useRef<{ ts: number; pkts: number } | null>(null);
  const [pktsPerSec, setPktsPerSec] = useState(0);

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const prev = prevRef.current;
    if (prev && now > prev.ts) {
      const delta = data.packets_processed - prev.pkts;
      setPktsPerSec(Math.max(0, Math.round((delta * 1000) / (now - prev.ts))));
    }
    prevRef.current = { ts: now, pkts: data.packets_processed };
  }, [data]);

  if (loading || !data) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.status.title")}</CardTitle>
          <CardDescription>{t("trafficEngine.status.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 @3xl/card:grid-cols-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const tone = ENGINE_TONE[data.status] ?? ENGINE_TONE.stopped;
  const isMasq = "sni_domain" in data;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("trafficEngine.status.title")}</CardTitle>
        <CardDescription>{t("trafficEngine.status.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 @3xl/card:grid-cols-4">
          {/* Status chip + uptime */}
          <div className="flex flex-col gap-2 rounded-tile bg-surface-container p-4 text-on-surface">
            <span className="text-xs text-muted-foreground">
              {t("trafficEngine.status.state")}
            </span>
            <Badge variant={tone.variant} className="w-fit">
              {tone.icon}
              {t(`trafficEngine.status.${data.status}`)}
            </Badge>
            {data.status === "running" && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("trafficEngine.status.uptime")}: {data.uptime}
              </span>
            )}
          </div>

          {/* Packets + rate */}
          <div className="flex flex-col gap-1 rounded-tile bg-surface-container p-4 text-on-surface">
            <span className="text-xs text-muted-foreground">
              {t("trafficEngine.status.packets")}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {data.packets_processed.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("trafficEngine.status.packets_per_sec", { n: pktsPerSec })}
            </span>
          </div>

          {/* Mode-specific: domains loaded (VO); masquerade applies to every
              connection, so nothing to count here */}
          {!isMasq && (
            <div className="flex flex-col gap-1 rounded-tile bg-surface-container p-4 text-on-surface">
              <span className="text-xs text-muted-foreground">
                {t("trafficEngine.status.domains")}
              </span>
              <span className="text-2xl font-semibold tabular-nums">
                {data.domains_loaded}
              </span>
            </div>
          )}
          {isMasq && (
            <div className="flex flex-col gap-1 rounded-tile bg-surface-container p-4 text-on-surface">
              <span className="text-xs text-muted-foreground">
                {t("trafficEngine.status.masq_scope")}
              </span>
              <span className="text-sm">{t("trafficEngine.status.masq_all")}</span>
            </div>
          )}

          {/* Redirect rule */}
          <div className="flex flex-col gap-2 rounded-tile bg-surface-container p-4 text-on-surface">
            <span className="text-xs text-muted-foreground">
              {t("trafficEngine.status.rule")}
            </span>
            <Badge
              variant={data.kernel_module_loaded ? "success" : "muted"}
              className="w-fit"
            >
              {data.kernel_module_loaded ? (
                <CheckCircle2Icon />
              ) : (
                <MinusCircleIcon />
              )}
              {t(
                data.kernel_module_loaded
                  ? "trafficEngine.status.rule_active"
                  : "trafficEngine.status.rule_inactive",
              )}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {data.binary_installed
                ? t("trafficEngine.status.binary_installed")
                : t("trafficEngine.status.binary_missing")}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EngineStatusCard;
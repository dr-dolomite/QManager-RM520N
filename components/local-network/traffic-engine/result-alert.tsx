"use client";

import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2Icon,
  TriangleAlertIcon,
  XCircleIcon,
  TrendingUpIcon,
} from "lucide-react";
import type { VerifyResult } from "@/types/traffic-engine";

// =============================================================================
// result-alert — renders a completed verify comparison: without/with bypass
// samples + improvement factor, with the throttled heuristic as chips.
// =============================================================================

export interface ResultAlertProps {
  result: VerifyResult;
}

const ResultAlert = ({ result }: ResultAlertProps) => {
  const { t } = useTranslation("common");

  if (result.status === "error") {
    return (
      <Alert variant="destructive">
        <XCircleIcon className="size-4" />
        <AlertTitle>{t("trafficEngine.verify.error")}</AlertTitle>
        <AlertDescription>
          {result.detail || result.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (result.status !== "complete" || !result.with_bypass || !result.without_bypass) {
    return null;
  }

  const sample = (label: string, s: { speed_mbps: number; throttled: boolean }) => (
    <div className="flex items-center justify-between gap-2 rounded-tile bg-surface-container p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{s.speed_mbps} Mbps</span>
        <Badge variant={s.throttled ? "warning" : "success"}>
          {s.throttled ? <TriangleAlertIcon /> : <CheckCircle2Icon />}
          {s.throttled
            ? t("trafficEngine.verify.throttled")
            : t("trafficEngine.verify.unthrottled")}
        </Badge>
      </div>
    </div>
  );

  return (
    <Alert>
      <TrendingUpIcon className="size-4" />
      <AlertTitle>
        {t("trafficEngine.verify.improvement")}: {result.improvement}
      </AlertTitle>
      <AlertDescription>
        <div className="mt-2 grid gap-2">
          {sample(t("trafficEngine.verify.without"), result.without_bypass)}
          {sample(t("trafficEngine.verify.with"), result.with_bypass)}
        </div>
      </AlertDescription>
    </Alert>
  );
};

export default ResultAlert;
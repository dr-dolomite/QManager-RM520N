"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircleIcon } from "lucide-react";

import EngineEnableRow from "./engine-enable-row";
import CdnHostlistCard from "./cdn-hostlist-card";
import EngineCheckRow from "./engine-check-row";
import type { UseVideoOptimizerReturn } from "@/hooks/use-video-optimizer";
import type { UseCdnHostlistReturn } from "@/hooks/use-cdn-hostlist";

// =============================================================================
// video-optimizer-panel — Video Optimizer tab: enable row, hostlist editor,
// and the verify/test row. Hostlist editing is available regardless of
// engine state (saved for when the engine runs); tpws hot-reloads it.
// =============================================================================

export interface VideoOptimizerPanelProps {
  videoOptimizer: UseVideoOptimizerReturn;
  hostlist: UseCdnHostlistReturn;
  masqueradeEnabled: boolean;
}

const VideoOptimizerPanel = ({
  videoOptimizer,
  hostlist,
  masqueradeEnabled,
}: VideoOptimizerPanelProps) => {
  const { t } = useTranslation("common");

  if (videoOptimizer.isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.tabs.video_optimizer")}</CardTitle>
          <CardDescription>
            {t("trafficEngine.enable.description_vo")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = videoOptimizer.data;

  return (
    <div className="grid grid-cols-1 gap-4">
      {videoOptimizer.error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>{videoOptimizer.error}</AlertDescription>
        </Alert>
      )}

      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.tabs.video_optimizer")}</CardTitle>
          <CardDescription>
            {t("trafficEngine.enable.description_vo")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EngineEnableRow
            enabled={data?.enabled ?? false}
            otherEnabled={masqueradeEnabled}
            isSaving={videoOptimizer.isSaving}
            otherModeLabel={t("trafficEngine.tabs.masquerade")}
            title={t("trafficEngine.enable.video_optimizer")}
            description={t("trafficEngine.enable.description_vo")}
            toastEnabled={t("trafficEngine.enable.toast_enabled_vo")}
            toastDisabled={t("trafficEngine.enable.toast_disabled_vo")}
            onSave={videoOptimizer.saveEnabled}
          />
        </CardContent>
      </Card>

      <CdnHostlistCard hostlist={hostlist} />

      <EngineCheckRow binaryInstalled={data?.binary_installed ?? false} />
    </div>
  );
};

export default VideoOptimizerPanel;
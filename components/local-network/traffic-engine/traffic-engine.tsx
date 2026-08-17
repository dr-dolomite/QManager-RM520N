"use client";

import { useTranslation } from "react-i18next";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import EngineStatusCard from "./engine-status-card";
import EngineOnboarding from "./engine-onboarding";
import VideoOptimizerPanel from "./video-optimizer-panel";
import MasqueradePanel from "./masquerade-panel";

import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { MaterialSymbol } from "@/components/ui/material-symbol";

const TrafficEngine = () => {
  const { t } = useTranslation("common");

  const videoOptimizer = useVideoOptimizer();
  const masquerade = useTrafficMasquerade();
  const hostlist = useCdnHostlist();

  const engineData = videoOptimizer.data ?? masquerade.data ?? null;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("trafficEngine.page.title")}</h1>
        <p className="text-muted-foreground">
          {t("trafficEngine.page.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <EngineStatusCard data={engineData} loading={videoOptimizer.isLoading && masquerade.isLoading} />

        <Tabs defaultValue="video_optimizer" className="w-full">
          <TabsList>
            <TabsTrigger value="video_optimizer">
              <MaterialSymbol name="videocam" size={18} className="me-1.5" />
              {t("trafficEngine.tabs.video_optimizer")}
            </TabsTrigger>
            <TabsTrigger value="masquerade">
              <MaterialSymbol name="swap_horiz" size={18} className="me-1.5" />
              {t("trafficEngine.tabs.masquerade")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="video_optimizer" className="mt-4">
            <VideoOptimizerPanel
              videoOptimizer={videoOptimizer}
              hostlist={hostlist}
              masqueradeEnabled={masquerade.data?.enabled ?? false}
            />
          </TabsContent>

          <TabsContent value="masquerade" className="mt-4">
            <MasqueradePanel
              masquerade={masquerade}
              videoOptimizerEnabled={videoOptimizer.data?.enabled ?? false}
            />
          </TabsContent>
        </Tabs>

        <EngineOnboarding
          binaryInstalled={engineData?.binary_installed ?? false}
          isInstalling={videoOptimizer.isInstalling}
          installPhase={videoOptimizer.installPhase}
          installMessage={videoOptimizer.installMessage}
          onInstall={videoOptimizer.installBinary}
        />
      </div>
    </div>
  );
};

export default TrafficEngine;
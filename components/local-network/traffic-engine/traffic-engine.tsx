"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftRight, RefreshCcwIcon, TriangleAlertIcon, Video, XIcon } from "lucide-react";

import EngineStatusCard from "./engine-status-card";
import EngineOnboarding from "./engine-onboarding";
import VideoOptimizerPanel from "./video-optimizer-panel";
import MasqueradePanel from "./masquerade-panel";

import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";

// Returns true only once `active` has held for `delayMs`. Suppresses the
// flash-of-skeleton on fast loads — and this app runs ON the modem, so loads
// are routinely sub-100ms. setState lives only in the timer callback and the
// cleanup (never synchronously in the effect body) to stay clear of the
// React-compiler setState-in-effect rule.
function useDelayedFlag(active: boolean, delayMs = 160) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(id);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}

// Skeleton mirrors the loaded single-column layout (status card, tab bar,
// panel block) so the skeleton->content swap doesn't jump.
function StackSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-[22rem] w-full rounded-xl" />
    </div>
  );
}

const TrafficEngine = () => {
  const { t } = useTranslation("common");

  const videoOptimizer = useVideoOptimizer();
  const masquerade = useTrafficMasquerade();
  const hostlist = useCdnHostlist();

  const engineData = videoOptimizer.data ?? masquerade.data ?? null;
  const installed = engineData?.binary_installed ?? false;

  const isLoading = videoOptimizer.isLoading && masquerade.isLoading;
  const showSkeleton = useDelayedFlag(isLoading);
  const loadError =
    (videoOptimizer.error !== null && !videoOptimizer.data) ||
    (masquerade.error !== null && !masquerade.data);

  const retry = () => {
    videoOptimizer.refresh();
    masquerade.refresh();
  };

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("trafficEngine.page.title")}</h1>
        <p className="text-muted-foreground">
          {t("trafficEngine.page.description")}
        </p>
      </div>

      {isLoading ? (
        showSkeleton ? (
          <StackSkeleton />
        ) : null
      ) : loadError ? (
        <Alert variant="destructive" aria-live="polite">
          <TriangleAlertIcon className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{t("trafficEngine.load_error")}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCcwIcon className="size-3.5" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !installed ? (
        <EngineOnboarding
          binaryInstalled={installed}
          isInstalling={videoOptimizer.isInstalling}
          installPhase={videoOptimizer.installPhase}
          installMessage={videoOptimizer.installMessage}
          onInstall={videoOptimizer.installBinary}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {videoOptimizer.installPhase === "error" && (
            <Alert variant="destructive" aria-live="assertive">
              <TriangleAlertIcon className="size-4" />
              <AlertDescription className="flex items-center justify-between gap-4">
                <span>
                  {videoOptimizer.installMessage ??
                    videoOptimizer.error ??
                    t("trafficEngine.binary_op_failed")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={videoOptimizer.dismissBinaryOpError}
                >
                  <XIcon className="size-3.5" />
                  {t("actions.dismiss", { ns: "common" })}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <EngineStatusCard
            data={engineData}
            loading={false}
            onUninstall={videoOptimizer.uninstallBinary}
            isUninstalling={videoOptimizer.isUninstalling}
          />

          <Tabs defaultValue="video_optimizer" className="w-full">
            <TabsList>
              <TabsTrigger value="video_optimizer">
                <Video className="me-1.5 size-4" />
                {t("trafficEngine.tabs.video_optimizer")}
              </TabsTrigger>
              <TabsTrigger value="masquerade">
                <ArrowLeftRight className="me-1.5 size-4" />
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
        </div>
      )}
    </div>
  );
};

export default TrafficEngine;
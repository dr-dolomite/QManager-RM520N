"use client";

import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import VideoOptimizerSettingsCard from "./video-optimizer-settings-card";
import CdnHostlistCard from "./cdn-hostlist-card";

export default function VideoOptimizerComponent() {
  const videoOptimizer = useVideoOptimizer();
  const trafficMasquerade = useTrafficMasquerade();

  const masqActive = trafficMasquerade.settings?.enabled === true;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Video Optimizer</h1>
        <p className="text-muted-foreground">
          Bypass carrier video throttling using DPI evasion on targeted video
          CDN hostnames
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <VideoOptimizerSettingsCard
          hook={videoOptimizer}
          otherActive={masqActive}
          onSaved={() => trafficMasquerade.refresh(true)}
        />
        <CdnHostlistCard />
      </div>
    </div>
  );
}

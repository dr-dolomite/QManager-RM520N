"use client";

import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import TrafficMasqueradeSettingsCard from "./traffic-masquerade-settings-card";

export default function TrafficMasqueradeComponent() {
  const videoOptimizer = useVideoOptimizer();
  const trafficMasquerade = useTrafficMasquerade();

  const voActive = videoOptimizer.settings?.enabled === true;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Traffic Masquerade</h1>
        <p className="text-muted-foreground">
          Make all HTTPS traffic appear as a whitelisted service to carrier DPI
        </p>
      </div>
      <div className="max-w-2xl">
        <TrafficMasqueradeSettingsCard
          hook={trafficMasquerade}
          otherActive={voActive}
          onSaved={() => videoOptimizer.refresh(true)}
        />
      </div>
    </div>
  );
}

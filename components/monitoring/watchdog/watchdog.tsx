"use client";

import { useWatchdogSettings } from "@/hooks/use-watchdog-settings";
import { WatchdogSettingsCard } from "./watchdog-settings-card";
import { WatchdogStatusCard } from "./watchdog-status-card";

const WatchdogComponent = () => {
  const hookData = useWatchdogSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Watchdog</h1>
        <p className="text-muted-foreground">
          Automatically detect and recover from internet outages with
          escalating recovery steps.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 grid-flow-row gap-4">
        <WatchdogSettingsCard {...hookData} />
        <WatchdogStatusCard revertSim={hookData.revertSim} />
      </div>
    </div>
  );
};

export default WatchdogComponent;

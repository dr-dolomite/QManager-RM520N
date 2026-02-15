"use client";

import React from "react";
import { useModemStatus } from "@/hooks/use-modem-status";
import NetworkStatusComponent from "./network-status";
import DeviceStatus from "./device-status";
import LTEStatusComponent from "./lte-status";
import NrStatusComponent from "./nr-status";
import { SignalHistoryComponent } from "./signal-history";
import RecentActivitiesComponent from "./recent-activities";
import DeviceMetricsComponent from "./device-metrics";
import LiveLatencyComponent from "./live-latency";

const HomeComponent = () => {
  const { data, isLoading, isStale, error } = useModemStatus();

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-6 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-5">
      <div className="grid gap-4 @xl/main:col-span-3 @5xl/main:col-span-3 col-span-1 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <NetworkStatusComponent
          data={data?.network ?? null}
          connectivity={data?.connectivity ?? null}
          modemReachable={data?.modem_reachable ?? false}
          isLoading={isLoading}
          isStale={isStale}
        />
        <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
          <LTEStatusComponent
            data={data?.lte ?? null}
            isLoading={isLoading}
          />
          <NrStatusComponent
            data={data?.nr ?? null}
            isLoading={isLoading}
          />
        </div>
      </div>
      <div className="@xl/main:col-span-2 @5xl/main:col-span-2 col-span-1 h-full *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs *:data-[slot=card]:h-full">
        <DeviceStatus
          data={data?.device ?? null}
          isLoading={isLoading}
        />
      </div>

      <div className="col-span-1 xl:col-span-5">
        <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-3 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
          <DeviceMetricsComponent
            deviceData={data?.device ?? null}
            trafficData={data?.traffic ?? null}
            lteData={data?.lte ?? null}
            nrData={data?.nr ?? null}
            isLoading={isLoading}
          />
          <LiveLatencyComponent />
          <RecentActivitiesComponent />
        </div>
      </div>

      <div className="col-span-1 xl:col-span-5 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <SignalHistoryComponent />
      </div>
    </div>
  );
};

export default HomeComponent;

"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  TbAlertTriangleFilled,
  TbCircleArrowDownFilled,
  TbCircleArrowUpFilled,
  TbInfoCircleFilled,
} from "react-icons/tb";

import type {
  DeviceStatus,
  TrafficStatus,
  LteStatus,
  NrStatus,
} from "@/types/modem-status";
import {
  formatBytesPerSec,
  formatBytes,
  formatUptime,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
} from "@/types/modem-status";

interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  trafficData: TrafficStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  isLoading: boolean;
}

// --- Warning thresholds ---
const TEMP_WARN = 60; // °C
const CPU_WARN = 80; // percentage

const DeviceMetricsComponent = ({
  deviceData,
  trafficData,
  lteData,
  nrData,
  isLoading,
}: DeviceMetricsComponentProps) => {
  const temp = deviceData?.temperature ?? null;
  const cpu = deviceData?.cpu_usage ?? null;
  const memUsed = deviceData?.memory_used_mb ?? 0;
  const memTotal = deviceData?.memory_total_mb ?? 0;

  // Uptime values — read directly from poll data (no seconds displayed,
  // so no need for 1-second client-side interpolation)
  const displayDevUptime = deviceData?.uptime_seconds ?? 0;
  const displayConnUptime = deviceData?.conn_uptime_seconds ?? 0;

  const rxSpeed = trafficData?.rx_bytes_per_sec ?? 0;
  const txSpeed = trafficData?.tx_bytes_per_sec ?? 0;
  const totalRx = trafficData?.total_rx_bytes ?? 0;
  const totalTx = trafficData?.total_tx_bytes ?? 0;

  const isTempHigh = temp !== null && temp >= TEMP_WARN;
  const isCpuHigh = cpu !== null && cpu >= CPU_WARN;

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader className="-mb-4">
          <CardTitle className="text-lg font-semibold tabular-nums">
            Device Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i}>
                <Separator />
                <div className="flex items-center justify-between py-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          Device Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {/* Modem Temperature */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Modem Temperature
            </p>
            <div className="flex items-center gap-1.5">
              {isTempHigh && (
                <Badge className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm">
                  <TbAlertTriangleFilled className="text-orange-500" />
                  High Temp
                </Badge>
              )}
              <p className="font-semibold text-sm tabular-nums">
                {temp !== null ? `${temp}°C` : "-"}
              </p>
            </div>
          </div>

          {/* CPU Usage */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              CPU Usage
            </p>
            <div className="flex items-center gap-1.5">
              {isCpuHigh && (
                <Badge className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-300/50 backdrop-blur-sm">
                  <TbAlertTriangleFilled className="text-orange-500" />
                  High CPU
                </Badge>
              )}
              <p className="font-semibold text-sm tabular-nums">
                {cpu !== null ? `${cpu}%` : "-"}
              </p>
            </div>
          </div>

          {/* Memory Usage */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Memory Usage
            </p>
            <p className="font-semibold text-sm tabular-nums">
              {memTotal > 0 ? `${memUsed} MB / ${memTotal} MB` : "-"}
            </p>
          </div>

          {/* Live Traffic */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Live Traffic
            </p>
            <div className="flex items-center gap-x-2">
              <div className="flex items-center gap-1">
                <TbCircleArrowDownFilled className="text-blue-500 w-5 h-5" />
                <p className="font-semibold text-sm tabular-nums">
                  {formatBytesPerSec(rxSpeed)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <TbCircleArrowUpFilled className="text-purple-500 w-5 h-5" />
                <p className="font-semibold text-sm tabular-nums">
                  {formatBytesPerSec(txSpeed)}
                </p>
              </div>
            </div>
          </div>

          {/* Data Usage */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Data Usage
            </p>
            <div className="flex items-center gap-x-2">
              <div className="flex items-center gap-1">
                <TbCircleArrowDownFilled className="text-blue-500 w-5 h-5" />
                <p className="font-semibold text-sm tabular-nums">
                  {formatBytes(totalRx)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <TbCircleArrowUpFilled className="text-purple-500 w-5 h-5" />
                <p className="font-semibold text-sm tabular-nums">
                  {formatBytes(totalTx)}
                </p>
              </div>
            </div>
          </div>

          {/* LTE Cell Distance */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              LTE Cell Distance
            </p>

            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  {/* Will show in Hexadecimal form */}
                  {lteData?.ta !== null && lteData?.ta !== undefined ? (
                    <p>
                      This is only an approximation based <br /> on the LTE
                      Timing Advance value of{" "}
                      <span className="font-semibold">{lteData.ta}</span>.
                    </p>
                  ) : (
                    <p>Timing Advance value is not available.</p>
                  )}
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm tabular-nums">
                {formatDistance(calculateLteDistance(lteData?.ta ?? null))}
              </p>
            </div>
          </div>

          {/* NR Cell Distance */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              NR Cell Distance
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                </TooltipTrigger>
                <TooltipContent>
                  {/* Will show in Hexadecimal form */}
                  {nrData?.ta !== null && nrData?.ta !== undefined ? (
                    <p>
                      This is only an approximation based <br /> on the NR
                      Timing Advance value of{" "}
                      <span className="font-semibold">{nrData.ta}</span>.
                    </p>
                  ) : (
                    <p>Timing Advance value is not available.</p>
                  )}
                </TooltipContent>
              </Tooltip>
              <p className="font-semibold text-sm tabular-nums">
                {formatDistance(calculateNrDistance(nrData?.ta ?? null))}
              </p>
            </div>
          </div>

          {/* Connection Uptime */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Connection Uptime
            </p>
            <p className="font-semibold text-sm tabular-nums">
              {displayConnUptime > 0 ? formatUptime(displayConnUptime) : "-"}
            </p>
          </div>

          {/* Device Uptime */}
          <Separator />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-muted-foreground text-sm">
              Device Uptime
            </p>
            <p className="font-semibold text-sm tabular-nums">
              {displayDevUptime > 0 ? formatUptime(displayDevUptime) : "-"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceMetricsComponent;

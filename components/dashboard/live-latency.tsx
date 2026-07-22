"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";

import { CartesianGrid, Line, LineChart } from "recharts";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "../ui/button";
import {
  TbCircleArrowDownFilled,
  TbCircleArrowUpFilled,
  TbPlayerPlayFilled,
  TbTimeline,
} from "react-icons/tb";
import { SpeedtestDialog } from "./speedtest-dialog";
import {
  bytesToMbps,
  formatSpeed,
  type SpeedtestFinalResult,
  type SpeedtestStatusResponse,
} from "@/types/speedtest";

import type { ConnectivityStatus } from "@/types/modem-status";

export const description = "A multiple bar chart";

// =============================================================================
// Data Wiring
// =============================================================================
// The ping daemon writes RTT history as (number | null)[] where null = timeout.
// We show the last 10 data points. For each point:
//   - latency: the RTT in ms (rounded), or 0 if timeout
//   - packetloss: rolling % of null entries in a 10-sample window ending at
//                 that point (gives a smoothed per-point loss indicator)
// =============================================================================

/** How many points to show on the chart */
const CHART_POINTS = 10;

/** Rolling window size for per-point packet loss calculation */
const LOSS_WINDOW = 10;

const CGI_BASE = "/cgi-bin/quecmanager/at_cmd";

interface LiveLatencyComponentProps {
  connectivity: ConnectivityStatus | null;
  isLoading: boolean;
}

const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--chart-1)",
  },
  packetloss: {
    label: "Packetloss",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const LiveLatencyComponent = ({ connectivity }: LiveLatencyComponentProps) => {
  const { t } = useTranslation("dashboard");
  const [speedtestOpen, setSpeedtestOpen] = useState(false);
  const [cachedResult, setCachedResult] = useState<SpeedtestFinalResult | null>(
    null,
  );

  // Fetch any cached speedtest result
  const fetchCachedResult = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/speedtest_status.sh`);
      if (!resp.ok) return;
      const data: SpeedtestStatusResponse = await resp.json();
      if (data.status === "complete" && data.result) {
        setCachedResult(data.result);
      }
    } catch {
      // Silent — no cached result is fine
    }
  }, []);

  // Fetch cached result on mount
  useEffect(() => {
    fetchCachedResult();
  }, [fetchCachedResult]);

  const handleSpeedtestOpen = useCallback(() => {
    setSpeedtestOpen(true);
  }, []);

  // Refresh cached result when dialog closes (may have new result)
  const handleDialogChange = useCallback(
    (open: boolean) => {
      setSpeedtestOpen(open);
      if (!open) {
        fetchCachedResult();
      }
    },
    [fetchCachedResult],
  );

  const chartData = useMemo(() => {
    if (
      !connectivity?.latency_history ||
      connectivity.latency_history.length === 0
    ) {
      return [];
    }

    const history = connectivity.latency_history;
    const interval = connectivity.history_interval_sec || 2;

    // We need the last CHART_POINTS entries for display, but also preceding
    // entries for the rolling packet-loss window calculation.
    const endIdx = history.length;
    const startIdx = Math.max(0, endIdx - CHART_POINTS);
    const displaySlice = history.slice(startIdx, endIdx);

    return displaySlice.map((rtt, i) => {
      // Absolute index in the full history array
      const absIdx = startIdx + i;

      // Time label: seconds ago counting back from the most recent entry
      const secsAgo = (displaySlice.length - 1 - i) * interval;
      const timeLabel = secsAgo === 0 ? "Now" : `-${secsAgo}s`;

      // Rolling packet loss: look back LOSS_WINDOW entries ending at absIdx
      const windowStart = Math.max(0, absIdx - LOSS_WINDOW + 1);
      const window = history.slice(windowStart, absIdx + 1);
      const nullCount = window.filter((v) => v === null).length;
      const lossPct = Math.round((nullCount / window.length) * 100);

      return {
        time: timeLabel,
        latency: rtt !== null ? Math.round(rtt) : 0,
        packetloss: lossPct,
      };
    });
  }, [connectivity?.latency_history, connectivity?.history_interval_sec]);

  // Build the footer description from cached result
  const footerDescription = useMemo(() => {
    if (!cachedResult) {
      return t("speedtest.idle_description");
    }
    const dl = formatSpeed(cachedResult.download.bandwidth);
    const ul = formatSpeed(cachedResult.upload.bandwidth);
    const ping = cachedResult.ping.latency.toFixed(0);
    return (
      <div className="flex items-center gap-x-3">
        <p className="font-medium text-sm text-muted-foreground xl:mr-2 mr-0">
          {t("speedtest.result_label")}
        </p>
        <div className="flex items-center gap-x-0.5">
          <TbCircleArrowDownFilled className="text-info size-5" />
          <p>{dl} Mbps</p>
        </div>
        <div className="flex items-center gap-x-0.5">
          <TbCircleArrowUpFilled className="text-purple-500 size-5" />
          <p>{ul} Mbps</p>
        </div>
      </div>
    );
  }, [cachedResult, t]);

  return (
    <>
      <Card className="@container/card">
        <CardHeader className="-mb-4">
          <CardTitle className="text-lg font-semibold">
            {t("latency.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig}>
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <>
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                          style={
                            {
                              "--color-bg": `var(--color-${name})`,
                            } as React.CSSProperties
                          }
                        />
                        {name === "latency"
                          ? t("latency.chart_latency")
                          : name === "packetloss"
                            ? t("latency.chart_packetloss")
                            : name}
                        <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
                          {value}
                          <span className="font-normal text-muted-foreground">
                            {name === "latency" ? "ms" : "%"}
                          </span>
                        </div>
                      </>
                    )}
                  />
                }
              />
              <Line
                dataKey="latency"
                type="monotone"
                stroke="var(--color-latency)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                dataKey="packetloss"
                type="monotone"
                stroke="var(--color-packetloss)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
        <CardFooter>
          <div className="flex w-full items-start gap-2 text-sm">
            <div className="grid gap-2">
              <div className="flex items-center gap-2 leading-none font-medium">
                {t("speedtest.section_label")}
              </div>
              <div className="text-muted-foreground flex items-center gap-2 leading-none">
                <Button
                  variant="default"
                  size="icon-sm"
                  className="p-0.5 rounded-full"
                  aria-label={t("speedtest.start_button_aria")}
                  onClick={handleSpeedtestOpen}
                >
                  <TbPlayerPlayFilled className="size-4" />
                </Button>
                <span className="font-medium text-sm">
                  {footerDescription}
                </span>
              </div>
            </div>
          </div>
        </CardFooter>
      </Card>

      <SpeedtestDialog open={speedtestOpen} onOpenChange={handleDialogChange} />
    </>
  );
};

export default LiveLatencyComponent;

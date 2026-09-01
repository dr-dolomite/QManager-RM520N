"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BarChart, CartesianGrid, XAxis, Bar } from "recharts";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useLatencyHistory } from "@/hooks/use-latency-history";
import type { PingHistoryEntry } from "@/types/modem-status";
import type { PingEntry } from "./ping-entries-card";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DUR, EASE_STANDARD } from "@/lib/motion";

// =============================================================================
// Types
// =============================================================================

type ViewMode = "realtime" | "hourly" | "twelvehour" | "daily";

interface RealtimeDataPoint {
  timestamp: number;
  /** null = the ping was lost. NOT 0: a dropped probe is an absent reading, and
   *  zeroing it drew a blackout as a healthy flat line along the axis. */
  latency: number | null;
  packet_loss: number;
  /** false when the sample is a lost ping. Read by PingEntriesCard, which
   *  renders "Timeout" in the latency cell rather than a number — which is why
   *  `latency` may be null here without the table ever printing "null ms". */
  ok: boolean;
}

interface AggregatedDataPoint {
  timestamp: number;
  /** null when every ping in the bucket was lost — see ChartDataPoint. */
  latency: number | null;
  packet_loss: number;
  sampleCount: number;
}

interface ChartDataPoint {
  timestamp: number;
  /** null renders as a gap in the bar chart. Aggregated views never produce one:
   *  a bucket with no successful ping reports 100% loss and a null latency. */
  latency: number | null;
  packet_loss: number;
}

// =============================================================================
// Chart Config
// =============================================================================

const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--chart-3)",
  },
  packet_loss: {
    label: "Packet Loss",
    color: "var(--chart-6)",
  },
} satisfies ChartConfig;

const VIEW_INFO: Record<ViewMode, string> = {
  realtime:
    "Real-time ping results from the last 50 seconds. Each bar represents a single ping.",
  hourly: "Hourly averages of latency and packet loss over the last 24 hours.",
  twelvehour: "12-hour period averages of latency and packet loss.",
  daily: "Daily averages of latency and packet loss.",
};

const EMPTY_MESSAGES: Record<ViewMode, string> = {
  realtime: "No real-time data available.",
  hourly: "No hourly data available.",
  twelvehour: "No 12-hour data available.",
  daily: "No daily data available.",
};

/** Max entries shown in the chart and table for real-time view */
const REALTIME_LIMIT = 10;

// =============================================================================
// Helper Functions
// =============================================================================

// Timestamps are counted back from `now` using the LENGTH OF THIS ARRAY, never
// the connectivity payload's `history_size`. That field is a fixed capacity
// (60), not a measurement: while the ring buffer is short — which the ping
// daemon makes a RECURRING state, because it truncates the history on every
// probe-winner change — `historySize - i - 1` stamps the newest sample as
// though it were (60 - length) intervals old, stranding a fresh reading up to
// five minutes in the past. The last element of the array is the most recent
// sample by construction, so it belongs at `now`.
function buildRealtimeData(
  history: (number | null)[],
  intervalSec: number,
): RealtimeDataPoint[] {
  const now = Date.now();
  const len = history.length;
  return history.map((value, i) => {
    const timestamp = now - (len - i - 1) * intervalSec * 1000;
    if (value === null) {
      return { timestamp, latency: null, packet_loss: 100, ok: false };
    }
    return { timestamp, latency: value, packet_loss: 0, ok: true };
  });
}

function aggregateByBucket(
  entries: PingHistoryEntry[],
  bucketMs: number,
): AggregatedDataPoint[] {
  if (entries.length === 0) return [];

  const buckets = new Map<
    number,
    { sumLat: number; countLat: number; countNull: number; total: number }
  >();

  for (const entry of entries) {
    const ts = entry.ts * 1000;
    const bucketStart = Math.floor(ts / bucketMs) * bucketMs;

    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { sumLat: 0, countLat: 0, countNull: 0, total: 0 };
      buckets.set(bucketStart, bucket);
    }

    bucket.total++;
    if (entry.lat === null) {
      bucket.countNull++;
    } else {
      bucket.sumLat += entry.lat;
      bucket.countLat++;
    }
  }

  const result: AggregatedDataPoint[] = [];
  for (const [timestamp, bucket] of buckets) {
    result.push({
      timestamp,
      // A bucket in which every ping was lost has no latency to report. It
      // reports null (a gap) rather than 0, for the same reason the realtime
      // series does — and its packet_loss below is already 100, so the outage
      // is stated, not merely missing.
      latency:
        bucket.countLat > 0
          ? Math.round((bucket.sumLat / bucket.countLat) * 10) / 10
          : null,
      packet_loss:
        bucket.total > 0
          ? Math.round((bucket.countNull / bucket.total) * 100 * 10) / 10
          : 0,
      sampleCount: bucket.total,
    });
  }

  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function computeTotals(data: ChartDataPoint[]): {
  latency: number;
  packet_loss: number;
} {
  if (data.length === 0) return { latency: 0, packet_loss: 0 };

  // Gaps are excluded from the latency mean rather than counted as zero: a
  // window half of which timed out averages the readings it HAS, and the
  // packet-loss figure beside it is what reports the other half. Averaging in
  // zeros would pull the headline number down precisely when the link is worst.
  const readings = data.filter(
    (d): d is ChartDataPoint & { latency: number } => d.latency !== null,
  );
  const sumLat = readings.reduce((acc, d) => acc + d.latency, 0);
  const sumLoss = data.reduce((acc, d) => acc + d.packet_loss, 0);

  return {
    latency:
      readings.length > 0
        ? Math.round((sumLat / readings.length) * 10) / 10
        : 0,
    packet_loss: Math.round((sumLoss / data.length) * 10) / 10,
  };
}

// =============================================================================
// Hook: useLatencyMonitoring
// =============================================================================
// Exposes table entries + metadata so the parent can pass them to PingEntriesCard.

/** Headline figures above the chart. `packet_loss` is null when the poller has
 *  not yet measured one — the ring buffer is shorter than the window a loss
 *  ratio needs, so there is no percentage to state and "0%" would be a lie. */
export interface LatencyTotals {
  latency: number;
  packet_loss: number | null;
}

export interface LatencyMonitoringData {
  entries: PingEntry[];
  emptyMessage: string;
  isRealtime: boolean;
}

export function useLatencyMonitoring() {
  const [viewMode, setViewMode] = useState<ViewMode>("realtime");

  const { data: modemStatus } = useModemStatus({ pollInterval: 5000 });
  const { data: pingHistory } = useLatencyHistory({
    enabled: viewMode !== "realtime",
  });

  const realtimeData = useMemo<RealtimeDataPoint[]>(() => {
    if (!modemStatus?.connectivity) return [];
    const { latency_history, history_interval_sec } = modemStatus.connectivity;
    if (!latency_history || latency_history.length === 0) return [];
    return buildRealtimeData(latency_history, history_interval_sec);
  }, [modemStatus?.connectivity]);

  const hourlyData = useMemo(
    () => aggregateByBucket(pingHistory, 3_600_000),
    [pingHistory],
  );
  const twelveHourData = useMemo(
    () => aggregateByBucket(pingHistory, 43_200_000),
    [pingHistory],
  );
  const dailyData = useMemo(
    () => aggregateByBucket(pingHistory, 86_400_000),
    [pingHistory],
  );

  const chartData = useMemo<ChartDataPoint[]>(() => {
    switch (viewMode) {
      case "realtime":
        return realtimeData.slice(-REALTIME_LIMIT).map((d) => ({
          timestamp: d.timestamp,
          latency: d.latency,
          packet_loss: d.packet_loss,
        }));
      case "hourly":
        return hourlyData;
      case "twelvehour":
        return twelveHourData;
      case "daily":
        return dailyData;
      default:
        return [];
    }
  }, [viewMode, realtimeData, hourlyData, twelveHourData, dailyData]);

  const total = useMemo<LatencyTotals>(() => {
    if (viewMode === "realtime" && modemStatus?.connectivity) {
      return {
        latency: modemStatus.connectivity.avg_latency_ms ?? 0,
        packet_loss: modemStatus.connectivity.packet_loss_pct,
      };
    }
    return computeTotals(chartData);
  }, [viewMode, modemStatus?.connectivity, chartData]);

  // Build table entries with uniform PingEntry shape
  const tableData = useMemo<LatencyMonitoringData>(() => {
    const isRealtime = viewMode === "realtime";

    let entries: PingEntry[];
    if (isRealtime) {
      // Take the most recent N entries
      // The table prints "Timeout" for these rows (ok === false), so the 0 is
      // never rendered; it exists only to satisfy PingEntry's numeric latency.
      entries = realtimeData.slice(-REALTIME_LIMIT).map((d) => ({
        ...d,
        latency: d.latency ?? 0,
      }));
    } else {
      const source =
        viewMode === "hourly"
          ? hourlyData
          : viewMode === "twelvehour"
            ? twelveHourData
            : dailyData;
      entries = source.map((d) => ({
        timestamp: d.timestamp,
        // `ok` is what PingEntriesCard reads to print "Timeout" instead of a
        // number, and it only consults it in the realtime view — so an
        // all-lost aggregate bucket has to carry a printable latency here.
        latency: d.latency ?? 0,
        packet_loss: d.packet_loss,
        ok: d.latency !== null,
      }));
    }

    return {
      entries,
      emptyMessage: EMPTY_MESSAGES[viewMode],
      isRealtime,
    };
  }, [viewMode, realtimeData, hourlyData, twelveHourData, dailyData]);

  return { viewMode, setViewMode, chartData, total, tableData };
}

// =============================================================================
// Chart Card Component
// =============================================================================

interface LatencyMonitoringCardProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  chartData: ChartDataPoint[];
  total: LatencyTotals;
}

const LatencyMonitoringCard = ({
  viewMode,
  setViewMode,
  chartData,
  total,
}: LatencyMonitoringCardProps) => {
  const [activeChart, setActiveChart] = useState<"latency" | "packet_loss">(
    "latency",
  );

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:py-6">
          <CardTitle>Internet Quality Monitor</CardTitle>
          <CardDescription>{VIEW_INFO[viewMode]}</CardDescription>
        </div>
        <div className="flex">
          {(["latency", "packet_loss"] as const).map((key) => {
            // An unmeasured figure prints an em dash, never a rounded null.
            // `total[key]` is nullable for packet_loss, so both the animation
            // key and the label have to survive it — a bare .toLocaleString()
            // here would throw and take the whole page with it.
            const value = total[key];
            const label =
              value === null
                ? "—"
                : `${value.toLocaleString()}${key === "latency" ? "ms" : "%"}`;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={activeChart === key}
                aria-label={`Show ${chartConfig[key].label} chart`}
                data-active={activeChart === key}
                className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6"
                onClick={() => setActiveChart(key)}
              >
                <span className="text-muted-foreground text-xs">
                  {chartConfig[key].label}
                </span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={label}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
                    className="text-base leading-none font-bold sm:text-3xl tabular-nums"
                  >
                    {label}
                  </motion.span>
                </AnimatePresence>
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:p-6">
        <Tabs
          defaultValue="realtime"
          onValueChange={(value) => setViewMode(value as ViewMode)}
        >
          <TabsList>
            <TabsTrigger value="realtime">Real Time</TabsTrigger>
            <TabsTrigger value="hourly">Hourly</TabsTrigger>
            <TabsTrigger value="twelvehour">12 Hours</TabsTrigger>
            <TabsTrigger value="daily">Daily</TabsTrigger>
          </TabsList>
        </Tabs>
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full mt-4"
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
              tickFormatter={(value) => {
                const date = new Date(value);
                if (viewMode === "realtime") {
                  return date.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                } else if (viewMode === "hourly" || viewMode === "twelvehour") {
                  return date.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                  });
                } else {
                  return date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                }
              }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="min-w-[180px] w-auto"
                  labelFormatter={(_value, payload) => {
                    const ts = payload?.[0]?.payload?.timestamp;
                    if (!ts) return "";
                    if (viewMode === "daily") {
                      return new Date(ts).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });
                    }
                    return new Date(ts).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }}
                />
              }
            />
            <Bar
              dataKey={activeChart}
              fill={`var(--color-${activeChart})`}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

export default LatencyMonitoringCard;

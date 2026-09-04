"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ActivityIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LATENCY_THRESHOLDS } from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHART,
  CROSSFADE_STACK,
  NOTICE,
  NOTICE_GLYPH,
  SEGMENT,
} from "./shapes";
import {
  VIEW_MODES,
  type LatencySample,
  type ViewMode,
} from "./use-latency-monitoring";

/** Both plots carry these, so their plot areas start and end on the same x. */
const PLOT_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;

/** The `good` ceiling, read from the shared table rather than restated. */
const GOOD_CEILING_MS = LATENCY_THRESHOLDS.good;

const RANGE_LABEL_KEY = {
  realtime: "latencyMonitor.range.realtime",
  hourly: "latencyMonitor.range.hourly",
  twelvehour: "latencyMonitor.range.twelvehour",
  daily: "latencyMonitor.range.daily",
} satisfies Record<ViewMode, string>;

const DESCRIPTION_KEY = {
  realtime: "latencyMonitor.chart.description_realtime",
  hourly: "latencyMonitor.chart.description_hourly",
  twelvehour: "latencyMonitor.chart.description_twelvehour",
  daily: "latencyMonitor.chart.description_daily",
} satisfies Record<ViewMode, string>;

const pad = (value: number) => String(value).padStart(2, "0");

/** Realtime ticks count seconds; aggregate ticks name the bucket they open. */
function formatTick(value: number, mode: ViewMode): string {
  const at = new Date(value);
  if (mode === "realtime")
    return `${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  if (mode === "daily")
    return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${pad(at.getHours())}:00`;
}

/** The window edges the description names, and the tooltip's own label. */
function formatBoundary(value: number, mode: ViewMode): string {
  const at = new Date(value);
  const day = at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  if (mode === "daily") return day;
  if (mode === "realtime")
    return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  return `${day} ${pad(at.getHours())}:00`;
}

/**
 * Recharts calls this for every point, so everything but the newest non-null
 * sample returns an empty group. `key` is a plain field on its props object.
 */
type SeriesDotProps = {
  key?: string;
  cx?: number;
  cy?: number;
  index?: number;
};

function newestDotRenderer(lastIndex: number) {
  return function renderDot(props: SeriesDotProps) {
    const { key, cx, cy, index } = props;
    if (index !== lastIndex || cx === undefined || cy === undefined) {
      return <g key={key} />;
    }
    return (
      <circle key={key} cx={cx} cy={cy} r={4.5} fill="var(--color-latency)" />
    );
  };
}

/** One axis rail beside one plot, at whichever pinned height it mirrors. */
function PlotSkeleton({ height, ticks }: { height: string; ticks: number }) {
  return (
    <div className={cn("flex gap-2.5", height)}>
      <div
        className="flex h-full flex-col justify-between py-1"
        style={{ width: CHART.AXIS_W }}
      >
        {Array.from({ length: ticks }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-full rounded-inline" />
        ))}
      </div>
      <Skeleton className="h-full flex-1 rounded-tile" />
    </div>
  );
}

/** Both plot heights, both axis rails and the legend row, from the shapes. */
function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <PlotSkeleton height={CHART.PLOT_H} ticks={4} />
      <PlotSkeleton height={CHART.LOSS_H} ticks={2} />
      <div className={CHART.LEGEND}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-20 rounded-pill" />
        ))}
      </div>
    </div>
  );
}

export interface RoundTripCardProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  /** Every sample in the window, oldest first, UNCAPPED. */
  samples: LatencySample[];
  /** `connectivity.history_interval_sec` in the realtime view, else null. */
  intervalSec: number | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function RoundTripCard({
  viewMode,
  setViewMode,
  samples,
  intervalSec,
  isLoading,
  error,
  onRetry,
}: RoundTripCardProps) {
  const { t } = useTranslation("dashboard");

  // SVG defs ids are document-global, and React's generated id carries colons
  // that are not valid in an id reference.
  const instanceId = useId().replace(/:/g, "");
  const latencyFillId = `${instanceId}-latency`;
  const lossFillId = `${instanceId}-loss`;

  const drawIn = useChartDrawIn(viewMode);
  const seriesMotion = useChartSeriesMotion();

  // One frame with a zero-length transition, so the travelling pill is simply
  // already under the active range rather than sliding in from nowhere.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // These KEYS are load-bearing: shadcn emits `--color-<key>` from exactly
  // these strings and the strokes, stops and swatches read them back.
  const chartConfig = useMemo(
    () =>
      ({
        latency: {
          label: t("latencyMonitor.chart.legend_latency"),
          color: "var(--primary)",
        },
        loss: {
          label: t("latencyMonitor.chart.legend_loss"),
          color: "var(--destructive)",
        },
        spread: {
          label: t("latencyMonitor.chart.legend_spread"),
          color: "var(--primary)",
        },
      }) satisfies ChartConfig,
    [t],
  );

  const isRealtime = viewMode === "realtime";
  const hasSamples = samples.length > 0;
  const hasSpread = !isRealtime && samples.some((s) => s.spread !== null);

  const lastLatencyIndex = useMemo(() => {
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].latency !== null) return i;
    }
    return -1;
  }, [samples]);

  // With every probe lost there is no RTT scale, so the guide has nothing to
  // place itself against and recharts renders it at NaN.
  const hasReading = lastLatencyIndex >= 0;

  const description = (() => {
    if (isLoading) return t("latencyMonitor.chart.description_loading");
    if (error && !hasSamples)
      return t("latencyMonitor.chart.description_unreadable");
    if (!hasSamples) return t("latencyMonitor.chart.description_empty");
    if (isRealtime) {
      return t(DESCRIPTION_KEY.realtime, {
        count: samples.length,
        // An unknown cadence is an em dash, never a fabricated number.
        seconds: intervalSec ?? t("latencyMonitor.unmeasured"),
      });
    }
    return t(DESCRIPTION_KEY[viewMode], {
      count: samples.length,
      from: formatBoundary(samples[0].timestamp, viewMode),
      to: formatBoundary(samples[samples.length - 1].timestamp, viewMode),
    });
  })();

  const tooltipLabel = (
    items: readonly { payload?: { timestamp?: number } }[] | undefined,
  ) => {
    const stamp = items?.[0]?.payload?.timestamp;
    return typeof stamp === "number" ? formatBoundary(stamp, viewMode) : "";
  };

  const tooltipRow = (value: React.ReactNode, name: string, unit: string) => (
    <>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-pill"
        style={{ backgroundColor: `var(--color-${name})` }}
      />
      {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
      <span className="text-foreground ml-auto flex items-baseline gap-0.5 font-medium tabular-nums">
        {value}
        <span className="text-on-surface-variant font-normal">{unit}</span>
      </span>
    </>
  );

  const rangeSwitcher = (
    <>
      <ToggleGroup
        type="single"
        value={viewMode}
        onValueChange={(value) => value && setViewMode(value as ViewMode)}
        spacing={1}
        aria-label={t("latencyMonitor.range.aria")}
        className={SEGMENT.TRACK}
      >
        {VIEW_MODES.map((mode) => (
          <ToggleGroupItem key={mode} value={mode} className={SEGMENT.ITEM}>
            {/* One fill on a shared, instance-scoped `layoutId`, so it travels
                between segments instead of two fills cross-fading. */}
            {viewMode === mode && (
              <motion.span
                layoutId={`${instanceId}-range`}
                className={SEGMENT.INDICATOR}
                transition={settled ? transitionStandard : { duration: 0 }}
                aria-hidden
              />
            )}
            <span className={SEGMENT.LABEL}>{t(RANGE_LABEL_KEY[mode])}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select
        value={viewMode}
        onValueChange={(value) => setViewMode(value as ViewMode)}
      >
        <SelectTrigger
          size="sm"
          aria-label={t("latencyMonitor.range.aria")}
          className={SEGMENT.SELECT_TRIGGER}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={SEGMENT.SELECT_CONTENT}>
          {VIEW_MODES.map((mode) => (
            <SelectItem key={mode} value={mode} className={SEGMENT.SELECT_ITEM}>
              {t(RANGE_LABEL_KEY[mode])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  const legend = (
    <div className={CHART.LEGEND}>
      <span className={CHART.LEGEND_ENTRY}>
        <span aria-hidden className={cn(CHART.LEGEND_SWATCH, "bg-primary")} />
        {t("latencyMonitor.chart.legend_latency")}
      </span>
      <span className={CHART.LEGEND_ENTRY}>
        <span
          aria-hidden
          className={cn(CHART.LEGEND_SWATCH, "bg-destructive")}
        />
        {t("latencyMonitor.chart.legend_loss")}
      </span>
      {hasSpread ? (
        <span className={CHART.LEGEND_ENTRY}>
          <span aria-hidden className={cn(CHART.LEGEND_BAND, "bg-primary")} />
          {t("latencyMonitor.chart.legend_spread")}
        </span>
      ) : null}
      {hasReading ? (
        <span className={CHART.LEGEND_ENTRY}>
          <span
            aria-hidden
            className={cn(CHART.LEGEND_SWATCH_DASH, "border-chart-threshold")}
          />
          {t("latencyMonitor.chart.legend_threshold", {
            value: `${GOOD_CEILING_MS} ${t("latencyMonitor.unit_ms")}`,
          })}
        </span>
      ) : null}
    </div>
  );

  const plots = (
    <div className="flex flex-col gap-4">
      <ChartContainer
        // A different range is a different chart, so the entrance replays.
        key={`${viewMode}-latency`}
        config={chartConfig}
        className={cn(drawIn, "aspect-auto w-full", CHART.PLOT_H, CHART.TICK_INK)}
      >
        <AreaChart accessibilityLayer data={samples} margin={PLOT_MARGIN}>
          <defs>
            <linearGradient id={latencyFillId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-latency)"
                stopOpacity={0.32}
              />
              <stop
                offset="55%"
                stopColor="var(--color-latency)"
                stopOpacity={0.1}
              />
              <stop
                offset="100%"
                stopColor="var(--color-latency)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          {/* Hidden here and drawn once under the loss plot, so one set of
              ticks reads for both. It still fixes the shared x domain. */}
          <XAxis dataKey="timestamp" hide />
          <YAxis
            width={CHART.AXIS_W}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          {hasReading ? (
            <ReferenceLine
              y={GOOD_CEILING_MS}
              stroke="var(--chart-threshold)"
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              ifOverflow="extendDomain"
            />
          ) : null}
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_label, items) => tooltipLabel(items)}
                formatter={(value, name) =>
                  tooltipRow(value, `${name}`, t("latencyMonitor.unit_ms"))
                }
              />
            }
          />
          {/* Behind the line, and only where a bucket actually carries one:
              the realtime ring buffer has no spread to draw. */}
          {hasSpread ? (
            <Area
              dataKey="spread"
              type="monotone"
              stroke="none"
              fill="var(--color-spread)"
              fillOpacity={0.16}
              dot={false}
              connectNulls={false}
              tooltipType="none"
              {...seriesMotion}
              pathLength={1}
            />
          ) : null}
          <Area
            dataKey="latency"
            type="monotone"
            stroke="var(--color-latency)"
            strokeWidth={2}
            fill={`url(#${latencyFillId})`}
            // A lost probe is an ABSENT reading; the path must break there.
            connectNulls={false}
            dot={isRealtime ? newestDotRenderer(lastLatencyIndex) : false}
            {...seriesMotion}
            pathLength={1}
          />
        </AreaChart>
      </ChartContainer>

      <div className="flex flex-col gap-1">
        <span className="text-on-surface-variant text-xs font-medium">
          {t("latencyMonitor.chart.loss_label")}
        </span>
        <ChartContainer
          key={`${viewMode}-loss`}
          config={chartConfig}
          className={cn(
            drawIn,
            "aspect-auto w-full",
            CHART.LOSS_H,
            CHART.TICK_INK,
          )}
        >
          <AreaChart accessibilityLayer data={samples} margin={PLOT_MARGIN}>
            <defs>
              <linearGradient id={lossFillId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-loss)"
                  stopOpacity={0.32}
                />
                <stop
                  offset="55%"
                  stopColor="var(--color-loss)"
                  stopOpacity={0.1}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-loss)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={32}
              height={22}
              tickFormatter={(value) => formatTick(value, viewMode)}
            />
            {/* Same rail width as the plot above: that is what keeps the two
                plot areas horizontally aligned. */}
            <YAxis
              width={CHART.AXIS_W}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, 100]}
              ticks={[0, 100]}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, items) => tooltipLabel(items)}
                  formatter={(value, name) =>
                    tooltipRow(value, `${name}`, t("latencyMonitor.unit_pct"))
                  }
                />
              }
            />
            <Area
              dataKey="loss"
              type="monotone"
              stroke="var(--color-loss)"
              strokeWidth={2}
              fill={`url(#${lossFillId})`}
              connectNulls={false}
              dot={false}
              {...seriesMotion}
              pathLength={1}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      {legend}
    </div>
  );

  // `isLoading` is already resolved per view by the hook, so the realtime view
  // cannot sit on a skeleton that never resolves.
  const body = isLoading ? (
    <ChartSkeleton />
  ) : error && !hasSamples ? (
    <ConditionBlock
      tone="destructive"
      icon={TriangleAlertIcon}
      title={t("latencyMonitor.error.title")}
      description={t("latencyMonitor.error.description", { message: error })}
      actionLabel={t("latencyMonitor.error.retry")}
      onAction={onRetry}
      actionIcon={RefreshCwIcon}
    />
  ) : !hasSamples ? (
    <ConditionBlock
      tone="muted"
      icon={ActivityIcon}
      title={t("latencyMonitor.empty.title")}
      description={t("latencyMonitor.empty.description")}
    />
  ) : (
    plots
  );

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("latencyMonitor.chart.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{description}</CardDescription>
        <CardAction>{rangeSwitcher}</CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {/* A stale chart beats a blank card: with points in hand the failure is
            a notice above the plots, never a replacement for them. */}
        {error && hasSamples ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {t("latencyMonitor.notice.stale", { message: error })}
          </div>
        ) : null}

        <div className={CROSSFADE_STACK}>{body}</div>
      </CardContent>
    </Card>
  );
}

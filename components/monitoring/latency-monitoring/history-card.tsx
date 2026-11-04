"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import {
  ActivityIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

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
} from "@/components/ui/chart";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  ConnectivityStatus,
  PingHistoryEntry,
} from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  HISTORY_RANGES,
  axisMs,
  deriveHistory,
  formatPct,
  hhmm,
  latencyTone,
  lossTone,
  msParts,
  msText,
  cutsFrom,
  timeTicks,
  type Cuts,
  type HistoryPoint,
  type HistoryRange,
  type HistoryView,
  type Tone,
  type UnitLabels,
} from "./derive";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_FILL,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHART,
  CROSSFADE_STACK,
  EYEBROW,
  EYEBROW_H,
  FIGS,
  ALERT_INK,
  HEADER_ACTIONS,
  NOTICE,
  NOTICE_GLYPH,
} from "./shapes";

const RANGE_LABEL_KEY = {
  "1h": "latencyMonitor.range.h1",
  "6h": "latencyMonitor.range.h6",
  "24h": "latencyMonitor.range.h24",
} satisfies Record<HistoryRange, string>;

const PLOT_MARGIN = { top: 10, right: 18, bottom: 0, left: 0 } as const;
const X_TICK_INTERVALS = 4;

interface CaretDotProps {
  key?: string;
  cx?: number;
  cy?: number;
  payload?: HistoryPoint;
}

/** An average past the plot's top is drawn there, with a caret saying so. */
function renderCaret(domainMax: number) {
  return function CaretDot({ key, cx, cy, payload }: CaretDotProps) {
    if (cx === undefined || cy === undefined || !payload || payload.avg === null || payload.avg <= domainMax) {
      return <g key={key} />;
    }
    return (
      <path
        key={key}
        d={`M${cx - 4},${cy - 3}L${cx + 4},${cy - 3}L${cx},${cy - 9}Z`}
        className="fill-on-surface-variant"
      />
    );
  };
}

interface ReadoutProps extends TooltipProps<ValueType, NameType> {
  units: UnitLabels;
}

function Readout({ active, payload, units }: ReadoutProps) {
  const { t } = useTranslation("dashboard");
  const point = payload?.[0]?.payload as HistoryPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className={CHART.TOOLTIP}>
      <span className="font-semibold">{hhmm(point.ts)}</span>
      <span className={CHART.TOOLTIP_ROW}>
        <span className={CHART.TOOLTIP_KEY}>{t("latencyMonitor.history.average")}</span>
        {point.avg === null ? t("latencyMonitor.now.no_reply") : msText(point.avg, units)}
      </span>
      {point.worst !== null ? (
        <span className={CHART.TOOLTIP_ROW}>
          <span className={CHART.TOOLTIP_KEY}>{t("latencyMonitor.history.worst")}</span>
          {msText(point.worst, units)}
        </span>
      ) : null}
      <span className={CHART.TOOLTIP_ROW}>
        <span className={CHART.TOOLTIP_KEY}>{t("latencyMonitor.history.loss")}</span>
        {t("latencyMonitor.history.loss_count", { lost: point.failed, total: point.total })}
      </span>
    </div>
  );
}

interface FigureProps {
  label: string;
  value: string;
  unit: string;
  tone: Tone;
}

function Figure({ label, value, unit, tone }: FigureProps) {
  const { t } = useTranslation("dashboard");
  return (
    <div className={FIGS.FIG}>
      <span className={cn(EYEBROW, EYEBROW_H)}>{label}</span>
      <span className={cn(FIGS.VALUE, FIGS.VALUE_H)}>
        {tone !== "ok" ? (
          <TriangleAlertIcon
            role="img"
            aria-label={t("latencyMonitor.history.attention")}
            className={cn(FIGS.ALERT, ALERT_INK[tone])}
          />
        ) : null}
        <span className="truncate">
          {value}
          {unit ? <small className={FIGS.UNIT}>{unit}</small> : null}
        </span>
      </span>
    </div>
  );
}

interface HistoryPlotProps {
  view: HistoryView;
  cuts: Cuts;
  range: HistoryRange;
  units: UnitLabels;
}

/** One mounted chart per range, so each draws in once and the swap crossfades. */
function HistoryPlot({ view, cuts, range, units }: HistoryPlotProps) {
  const { t } = useTranslation("dashboard");
  const drawIn = useChartDrawIn();
  const seriesMotion = useChartSeriesMotion();
  const dash = t("latencyMonitor.unmeasured");

  const config = useMemo(
    () =>
      ({
        average: {
          label: t("latencyMonitor.history.legend_average"),
          color: "var(--primary)",
        },
      }) satisfies ChartConfig,
    [t],
  );

  const typical = view.typical === null ? null : msParts(view.typical);
  const worst = view.worst === null ? null : msParts(view.worst);

  return (
    <div className="flex h-full flex-col gap-5">
      <div className={FIGS.ROOT}>
        <Figure
          label={t("latencyMonitor.history.typical")}
          value={typical?.value ?? dash}
          unit={typical ? units[typical.unit] : ""}
          tone={view.typical === null ? "ok" : latencyTone(view.typical, cuts)}
        />
        <Figure
          label={t("latencyMonitor.history.worst")}
          value={worst?.value ?? dash}
          unit={worst ? units[worst.unit] : ""}
          tone={view.worst === null ? "ok" : latencyTone(view.worst, cuts)}
        />
        <Figure
          label={t("latencyMonitor.history.loss")}
          value={formatPct(view.lossPct)}
          unit={t("latencyMonitor.unit_pct")}
          tone={lossTone(view.lossPct, cuts)}
        />
      </div>

      <div
        className={CHART.AREA}
        role="img"
        aria-label={t("latencyMonitor.history.chart_aria", {
          range: t(RANGE_LABEL_KEY[range]),
        })}
      >
        <ChartContainer
          config={config}
          className={cn(CHART.FILL, CHART.TICK_INK, drawIn)}
        >
          <LineChart data={view.points} margin={PLOT_MARGIN}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={[view.startMs, view.endMs]}
              ticks={timeTicks(view.startMs, view.endMs, X_TICK_INTERVALS)}
              tickFormatter={hhmm}
              interval={0}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              height={CHART.X_AXIS_H}
            />
            <YAxis
              domain={[0, view.domainMax]}
              ticks={view.ticks}
              tickFormatter={(v: number) => axisMs(v, t("latencyMonitor.unit_s"))}
              allowDataOverflow
              width={CHART.AXIS_W}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ReferenceLine
              y={cuts.latencyMs}
              stroke="var(--chart-threshold)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <ChartTooltip
              cursor={{ stroke: "var(--on-surface-variant)", strokeOpacity: 0.6 }}
              content={<Readout units={units} />}
            />
            <Line
              dataKey="plot"
              type="monotone"
              stroke="var(--color-average)"
              strokeWidth={2}
              connectNulls={false}
              dot={renderCaret(view.domainMax)}
              activeDot={{ r: 4, fill: "var(--color-average)" }}
              {...seriesMotion}
              pathLength={1}
            />
          </LineChart>
        </ChartContainer>
      </div>

      <div className={CHART.LEGEND}>
        <span className={CHART.LEGEND_ENTRY}>
          <span aria-hidden className={CHART.LEGEND_SWATCH} />
          {t("latencyMonitor.history.legend_average")}
        </span>
        <span className={CHART.LEGEND_ENTRY}>
          <span aria-hidden className={CHART.LEGEND_DASH} />
          {t("latencyMonitor.history.legend_limit")}
        </span>
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="flex h-full flex-col gap-5" aria-hidden>
      <div className={FIGS.ROOT}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={FIGS.FIG}>
            <Skeleton className={cn(EYEBROW_H, "w-16 rounded-inline")} />
            <Skeleton className={cn(FIGS.VALUE_H, "w-20 rounded-inline")} />
          </div>
        ))}
      </div>
      <div className={CHART.AREA}>
        <Skeleton className="absolute inset-0 rounded-tile" />
      </div>
      <div className={CHART.LEGEND}>
        <Skeleton className={cn(CHART.LEGEND_H, "w-20 rounded-pill")} />
        <Skeleton className={cn(CHART.LEGEND_H, "w-16 rounded-pill")} />
      </div>
    </div>
  );
}

export interface HistoryCardProps {
  connectivity: ConnectivityStatus | null;
  history: PingHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function HistoryCard({
  connectivity,
  history,
  isLoading,
  error,
  onRetry,
}: HistoryCardProps) {
  const { t } = useTranslation("dashboard");
  const [range, setRange] = useState<HistoryRange>("1h");

  const latencyCut = connectivity?.thresholds?.latency_ms;
  const lossCut = connectivity?.thresholds?.loss_pct;
  const cuts = useMemo(() => cutsFrom(latencyCut, lossCut), [latencyCut, lossCut]);
  const view = useMemo(() => deriveHistory(history, range, cuts), [history, range, cuts]);

  const units: UnitLabels = {
    ms: t("latencyMonitor.unit_ms"),
    s: t("latencyMonitor.unit_s"),
  };

  const options = HISTORY_RANGES.map((r) => ({
    value: r,
    label: t(RANGE_LABEL_KEY[r]),
    numeric: true,
  }));

  const body = isLoading ? (
    <HistorySkeleton />
  ) : error && history.length === 0 ? (
    <ConditionBlock
      tone="destructive"
      icon={TriangleAlertIcon}
      title={t("latencyMonitor.history.error_title")}
      description={t("latencyMonitor.history.error_description")}
      actionLabel={t("latencyMonitor.retry")}
      onAction={onRetry}
      actionIcon={RotateCwIcon}
    />
  ) : !view ? (
    <ConditionBlock
      tone="muted"
      icon={ActivityIcon}
      title={t("latencyMonitor.history.empty_title")}
      description={t("latencyMonitor.history.empty_description")}
    />
  ) : (
    <AnimatePresence initial={false}>
      <motion.div
        key={range}
        className="h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transitionStandard}
      >
        <HistoryPlot view={view} cuts={cuts} range={range} units={units} />
      </motion.div>
    </AnimatePresence>
  );

  return (
    <Card className={cn(CARD_SHELL, CARD_FILL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("latencyMonitor.history.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("latencyMonitor.history.description")}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          <SegmentedField
            value={range}
            onValueChange={setRange}
            options={options}
            ariaLabel={t("latencyMonitor.history.range_aria")}
            breakpoint="never"
            glyph={() => null}
          />
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {error && history.length > 0 ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {t("latencyMonitor.notice_stale")}
          </div>
        ) : null}
        <div className={cn(CROSSFADE_STACK, "flex-1")}>{body}</div>
      </CardContent>
    </Card>
  );
}

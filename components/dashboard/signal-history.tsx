"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
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
import { transitionStandard } from "@/lib/motion";
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { useSignalHistory } from "@/hooks/use-signal-history";
import type { SignalChartPoint } from "@/hooks/use-signal-history";

// =============================================================================
// Signal History — retarget to the Dashboard Final mock (card at lines 330-361)
// =============================================================================
// Shape notes that are not obvious from the JSX:
//
//  * The card shell is the dashboard's shared idiom (`rounded-card`, borderless,
//    whisper shadow) at the mock's 24px/28px padding and 16px column gap.
//  * The plot is pinned at the SAME height in every branch — loaded, loading,
//    empty and error. There is zero layout jump across the handoff today and
//    that is the one thing this card already got right; it stays true.
//  * Colour comes only from role tokens. The two radio families are one hue
//    each: 5G/NR on `--chart-nr` (primary family) and 4G/LTE on `--chart-lte`
//    (Carrier Violet). The legacy `--chart-1`/`--chart-3` pair this card used
//    before is byte-identical in light and dark mode AND sits in one hue
//    family, so the chart neither themed nor separated its two series by
//    anything but lightness.
// =============================================================================

/** Mock: `background:var(--surf); border-radius:36px; padding:24px 28px; gap:16px`. */
const CARD_SHELL =
  "@container/card gap-4 rounded-card border-0 px-7 py-6 shadow-[var(--shadow-whisper)]";

/**
 * Total height reserved for the chart block, identical in every branch.
 *
 * The mock's plot is 190px; the x-axis captions and the legend live outside it
 * there and INSIDE the recharts surface here, which is what the extra 60px pays
 * for. Change this and the skeleton's geometry below has to move with it.
 */
const CHART_H = "h-[250px]";

/** Mock: the 34px mono y-axis rail to the left of the plot. */
const AXIS_W = 34;

/**
 * Padding (in the metric's own unit — dBm/dB) added above and below the data
 * range for the YAxis `domain` below. Shared with the Area `baseValue`
 * calculation so the fill's bottom edge and the axis's actual floor are the
 * SAME line — see the long comment on `baseValue` for why a mismatch here
 * silently turns a filled area into a thin line with a gap under it.
 */
const Y_AXIS_PAD = 5;

/** The three metrics, in the mock's order. `labelKey` wires up locale strings
 *  that shipped months ago and were never read (the switcher was hardcoded). */
const SIGNAL_TYPES = [
  { id: "rsrp", labelKey: "signal_history.rsrp_label" },
  { id: "rsrq", labelKey: "signal_history.rsrq_label" },
  { id: "sinr", labelKey: "signal_history.sinr_label" },
] as const;

/**
 * Newest-point marker (mock: `<circle r="5.5">` at the trailing edge of each
 * series). Recharts calls this for every point, so everything but the series'
 * last non-null sample returns an empty group.
 *
 * Typed against recharts' `AreaDot`, whose function form takes `(props: any)`
 * — a narrower parameter type is assignable to it, so this stays `any`-free.
 * The incoming `key` is a plain field on recharts' props object, not React's
 * reserved prop, so it has to be forwarded by hand.
 */
type SeriesDotProps = {
  key?: string;
  cx?: number;
  cy?: number;
  index?: number;
  value?: number | number[];
};

function newestDotRenderer(color: string, lastIndex: number) {
  return function renderDot(props: SeriesDotProps) {
    const { key, cx, cy, index, value } = props;
    if (
      index !== lastIndex ||
      cx === undefined ||
      cy === undefined ||
      value === undefined ||
      value === null
    ) {
      return <g key={key} />;
    }
    return <circle key={key} cx={cx} cy={cy} r={5.5} fill={color} />;
  };
}

/**
 * Skeleton (Skeleton-Mirror Rule): the y-axis rail, the plot, the x-axis
 * caption row and the legend row — the loaded geometry, at the loaded height.
 */
function ChartSkeleton() {
  return (
    <div className={CHART_H} aria-hidden="true">
      <div className="flex gap-2.5">
        <div
          className="flex h-[190px] flex-col justify-between py-1"
          style={{ width: AXIS_W }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-2.5 w-full rounded-inline" />
          ))}
        </div>
        <Skeleton className="h-[190px] flex-1 rounded-tile" />
      </div>
      <div className="mt-3 flex justify-between pl-11">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-9 rounded-inline" />
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-5">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-12 rounded-pill" />
        ))}
      </div>
    </div>
  );
}

export function SignalHistoryComponent() {
  const { t } = useTranslation("dashboard");
  const gradientId = useId();
  const [signalType, setSignalType] = useState<string>("rsrp");
  const { chartData, isLoading, error } = useSignalHistory();
  const id4G = `${gradientId}-fill4G`;
  const id5G = `${gradientId}-fill5G`;

  /**
   * Nav-indicator guard (Motion Guide recipe 02, and the sidebar's
   * `data-settling` trick in another form): the travelling pill must not slide
   * in from nowhere on first paint. One frame with a zero-length transition and
   * it is simply already under RSRP.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The two chart clocks — see hooks/use-chart-motion.ts. Both are called up
  // here, above the loading/error/empty early returns below, because hooks
  // cannot sit behind a conditional.
  //
  // `drawIn` takes `signalType` as its reset key: the ChartContainer carries
  // `key={signalType}`, so switching metric really does remount the chart and
  // the entrance should play again — but this component does NOT remount, so
  // without the key the hook would stay retired from first paint onward and the
  // switch would be silent. `seriesMotion` is the poll-to-poll morph, which
  // works only because `drawIn` retires.
  const drawIn = useChartDrawIn(signalType);
  const seriesMotion = useChartSeriesMotion();

  /**
   * Built here rather than at module scope because the legend labels are now
   * translated. The KEYS are load-bearing and must not be renamed: shadcn's
   * `ChartStyle` emits `--color-<key>` from exactly these strings and
   * `getDataKeys()` reads them back as raw template literals, so a rename
   * silently kills strokes, gradients and tooltip swatches with no type error.
   */
  const chartConfig = useMemo(
    () =>
      ({
        rsrp4G: { label: t("signal_history.legend_lte"), color: "var(--chart-lte)" },
        rsrp5G: { label: t("signal_history.legend_nr"), color: "var(--chart-nr)" },
        rsrq4G: { label: t("signal_history.legend_lte"), color: "var(--chart-lte)" },
        rsrq5G: { label: t("signal_history.legend_nr"), color: "var(--chart-nr)" },
        sinr4G: { label: t("signal_history.legend_lte"), color: "var(--chart-lte)" },
        sinr5G: { label: t("signal_history.legend_nr"), color: "var(--chart-nr)" },
      }) satisfies ChartConfig,
    [t],
  );

  const getDataKeys = () => {
    switch (signalType) {
      case "rsrq":
        return {
          key4G: "rsrq4G",
          key5G: "rsrq5G",
          unit: "dB",
          label: t("signal_history.rsrq_label"),
        };
      case "sinr":
        return {
          key4G: "sinr4G",
          key5G: "sinr5G",
          unit: "dB",
          label: t("signal_history.sinr_label"),
        };
      case "rsrp":
      default:
        return {
          key4G: "rsrp4G",
          key5G: "rsrp5G",
          unit: "dBm",
          label: t("signal_history.rsrp_label"),
        };
    }
  };

  const { key4G, key5G, unit, label } = getDataKeys();

  // Calculate the min value for the current signal type to use as baseline, so
  // the fill anchors at the data floor rather than at zero (RSRP is negative).
  //
  // MUST match the YAxis `domain` floor below (`dataMin - Y_AXIS_PAD`), not the
  // bare data minimum. Recharts' own default for an *unset* `baseValue` (see
  // `Area.getBaseValue` in recharts source) derives it FROM the resolved axis
  // domain, so an Area with no baseValue prop always paints down to the true
  // plot floor — that's why Live Latency's identical gradient reads as a filled
  // area. Here we pass an explicit NUMBER, which recharts uses verbatim with no
  // reference to the axis domain at all. Passing the bare min (dataMin) left the
  // fill's bottom edge sitting `Y_AXIS_PAD` units ABOVE the actual axis floor —
  // a permanent blank band under the fill on narrow-banded metrics (RSRP/RSRQ/
  // SINR barely move), which is what made a real area chart read as a thin line
  // with a faint shadow instead of a filled region anchored to the bottom.
  const getBaseValue = () => {
    if (chartData.length === 0) return 0;
    const values = chartData
      .flatMap((d) => [
        d[key4G as keyof SignalChartPoint] as number | null,
        d[key5G as keyof SignalChartPoint] as number | null,
      ])
      .filter((v): v is number => v !== null);
    if (values.length === 0) return 0;
    return Math.min(...values);
  };

  const baseValue = getBaseValue() - Y_AXIS_PAD;

  /** Index of the newest non-null sample per series — where the mock's filled
   *  trailing dot belongs. A series with no 5G leg on the last sample must not
   *  get a dot parked on top of the gap. */
  const lastIndexOf = (key: string) => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if ((chartData[i][key as keyof SignalChartPoint] as number | null) !== null) {
        return i;
      }
    }
    return -1;
  };

  // ── Header ────────────────────────────────────────────────────────────────
  // The segmented pill (mock) above 540px, the Select below it. Both are bound
  // to the same `signalType`, and the deselect-to-empty guard stays.
  const header = (
    <CardHeader className="px-0">
      <CardTitle className="text-2xl font-semibold tracking-[-0.02em] @[250px]/card:text-3xl">
        {t("signal_history.title")}
      </CardTitle>
      <CardAction>
        {/* Track: `--surf2` at pill radius with 4px padding and a 4px gap
            (`spacing={1}`), exactly the mock. `spacing` also steers the
            ToggleGroup's own square-corner rules away from the segments. */}
        <ToggleGroup
          type="single"
          value={signalType}
          onValueChange={(value) => value && setSignalType(value)}
          spacing={1}
          className="hidden rounded-pill bg-surface-container p-1 @[540px]/card:flex"
        >
          {SIGNAL_TYPES.map((type) => (
            <ToggleGroupItem
              key={type.id}
              value={type.id}
              className="relative h-auto rounded-pill px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-transparent hover:text-on-surface data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground"
            >
              {/* Recipe 02: the active pill TRAVELS. One `motion.div` rendered
                  inside whichever segment is active, sharing a layoutId, so
                  motion tweens the box between the two positions instead of
                  cross-fading two fills. `layoutId` is instance-scoped via
                  `useId` — two of these cards on one page must not share an
                  indicator. */}
              {signalType === type.id && (
                <motion.span
                  layoutId={`${gradientId}-segment`}
                  className="absolute inset-0 rounded-pill bg-primary"
                  transition={settled ? transitionStandard : { duration: 0 }}
                  aria-hidden="true"
                />
              )}
              {/* Guide: inactive labels sit at .62 opacity and the active one at
                  full. Here that reading is carried by the role pair instead —
                  `on-surface-variant` vs the primary fill's own ink — which is
                  the Container-Pair Rule and survives both themes. */}
              <span className="relative">{t(type.labelKey)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={signalType} onValueChange={setSignalType}>
          <SelectTrigger
            className="flex w-32 rounded-pill **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[540px]/card:hidden"
            size="sm"
            aria-label={t("signal_history.select_aria")}
          >
            <SelectValue placeholder={t("signal_history.rsrp_label")} />
          </SelectTrigger>
          <SelectContent className="rounded-tile">
            {SIGNAL_TYPES.map((type) => (
              <SelectItem
                key={type.id}
                value={type.id}
                className="rounded-field"
              >
                {t(type.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardAction>
    </CardHeader>
  );

  const footer = (
    <CardFooter className="flex-col items-start gap-0.5 px-0">
      {/* The mock sets 13px here and 11px on the axis rail. Both are
          surface-scoped exceptions in DESIGN.md (the banner's and the
          sidebar's), not general ramp steps, so this card follows the Recent
          Activities precedent and stays on `text-sm`/`text-xs`. */}
      <span className="text-sm font-semibold text-on-surface">
        {t("signal_history.trend_heading", { metric: label, unit })}
      </span>
      <span className="text-xs text-on-surface-variant">
        {t("signal_history.fluctuation_note")}
      </span>
    </CardFooter>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  // Skeleton rather than a line of centred text, and the copy that used to be
  // that text becomes the live announcement instead of vanishing.
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className="px-0">
          <span role="status" className="sr-only">
            {t("signal_history.loading_message")}
          </span>
          <ChartSkeleton />
        </CardContent>
        {footer}
      </Card>
    );
  }

  // ── Error with nothing to fall back on ────────────────────────────────────
  // The hook has always exposed `error` and this card has never rendered it, so
  // a failed fetch was indistinguishable from "no data yet" — reassuring, and
  // wrong. A dead endpoint and an expired session both surface here, which is
  // why the message carries the status rather than a generic line.
  if (error && chartData.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className="px-0">
          <div
            role="alert"
            className={`${CHART_H} flex flex-col justify-center gap-1 rounded-tile bg-destructive-container px-5 text-on-destructive-container`}
          >
            <span className="text-sm font-semibold">
              {t("signal_history.error_title")}
            </span>
            <span className="text-sm leading-5 font-medium">
              {t("signal_history.error_description", { message: error })}
            </span>
          </div>
        </CardContent>
        {footer}
      </Card>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  // The chart's own geometry, greyed, with the honest explanation over it: the
  // backend genuinely has nothing yet and will inside ~10s.
  if (chartData.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className="relative px-0">
          <ChartSkeleton />
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-on-surface-variant">
            {t("signal_history.no_data_message")}
          </p>
        </CardContent>
        {footer}
      </Card>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className="px-0">
        {/* A stale chart beats a blank card: with points in hand the error is a
            notice above the plot, not a replacement for it. */}
        {error && (
          <div
            role="alert"
            className="mb-3 rounded-tile bg-destructive-container px-3.5 py-2 text-xs leading-4 font-medium text-on-destructive-container"
          >
            {t("signal_history.error_description", { message: error })}
          </div>
        )}

        {/* The one thing the visual chart cannot say to a screen reader. */}
        <p className="sr-only">
          {t("signal_history.chart_description", { signal_type: label })}
        </p>

        <ChartContainer
          // Recipe 16 (chart draw-in). `.chart-draw` reaches recharts' own
          // emitted classes: the stroke unwinds its dash over `standard` and
          // the fill follows it 80ms later, line leading, area trailing.
          // `drawIn` resolves to that class for the length of the entrance and
          // to `""` afterwards, so the series below are free to animate their
          // poll updates without the entrance replaying on each one.
          //
          // `key={signalType}` is deliberate. Switching metric only changes a
          // `dataKey` — a prop change, not a remount — so the draw would never
          // re-fire and the switch would be silent. A different metric is a
          // different chart, which is the correct reading of "first paint only".
          key={signalType}
          config={chartConfig}
          className={`${drawIn} aspect-auto w-full ${CHART_H} [&_.recharts-cartesian-axis-tick_text]:fill-on-surface-variant [&_.recharts-cartesian-axis-tick_text]:tabular-nums [&_.recharts-cartesian-axis-tick_text]:text-xs [&_.recharts-cartesian-axis-tick_text]:font-medium`}
        >
          {/* `accessibilityLayer` is recharts' opt-in for a keyboard-reachable
              plot: arrow keys walk the samples and the tooltip is announced.
              Without it this chart is inert to anyone not using a mouse, which
              on the one card whose entire content IS the chart means the card
              has nothing to offer them. Live Latency already sets it; this was
              the only chart in the product still missing it. */}
          <AreaChart accessibilityLayer data={chartData}>
            <defs>
              {/* Mock gradient: 0.32 at the top, 0.10 at 55%, transparent at
                  the floor — a fill that fades out rather than banding. */}
              <linearGradient id={id4G} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${key4G})`} stopOpacity={0.32} />
                <stop offset="55%" stopColor={`var(--color-${key4G})`} stopOpacity={0.1} />
                <stop offset="100%" stopColor={`var(--color-${key4G})`} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={id5G} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${key5G})`} stopOpacity={0.32} />
                <stop offset="55%" stopColor={`var(--color-${key5G})`} stopOpacity={0.1} />
                <stop offset="100%" stopColor={`var(--color-${key5G})`} stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Mock: horizontal rules only, on the outline token. */}
            <CartesianGrid vertical={false} stroke="var(--outline)" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <YAxis
              width={AXIS_W}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}`}
              // Recharts RELATIVE-domain strings, not numbers: RSRP is negative
              // and its usable range moves with the band, so a fixed numeric
              // domain would flatten or clip the trace depending on the cell.
              // `Y_AXIS_PAD` here MUST equal the padding subtracted in
              // `baseValue` above, or the Area's fill floor drifts away from
              // this axis's actual floor again.
              domain={[`dataMin - ${Y_AXIS_PAD}`, `dataMax + ${Y_AXIS_PAD}`]}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => `${value}`}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey={key4G}
              type="monotone"
              fill={`url(#${id4G})`}
              stroke={`var(--color-${key4G})`}
              strokeWidth={2.5}
              baseValue={baseValue}
              // A null means there was no leg on that sample. The area must
              // BREAK there; interpolating across the gap would invent signal.
              connectNulls={false}
              dot={newestDotRenderer(`var(--color-${key4G})`, lastIndexOf(key4G))}
              // `seriesMotion` is what makes the trace MOVE when a poll lands
              // instead of teleporting: recharts interpolates each point from
              // its previous plot position to its new one, and nothing outside
              // recharts can do that — it is the only party that knows where a
              // point sits in plot space. It had been off entirely, which is
              // why the chart looked static between polls.
              //
              // Recharts' own default timing is NOT restored with it: the
              // 1500ms `ease` it ships is 3.75x the project's 400ms ceiling on
              // a curve from no design system, so the hook pins `standard` on
              // `--ease-standard` and handles reduced motion itself (recharts
              // animates through react-smooth, which `MotionConfig` cannot
              // reach). This is only safe because the entrance class above now
              // retires — recharts remounts this series on every data change,
              // so a permanent `.chart-draw` would replay the draw each poll.
              {...seriesMotion}
              // Normalises the path to one user unit so `.chart-draw`'s
              // `stroke-dasharray: 1` covers the whole line at any card width.
              pathLength={1}
            />
            <Area
              dataKey={key5G}
              type="monotone"
              fill={`url(#${id5G})`}
              stroke={`var(--color-${key5G})`}
              strokeWidth={3}
              baseValue={baseValue}
              connectNulls={false}
              dot={newestDotRenderer(`var(--color-${key5G})`, lastIndexOf(key5G))}
              {...seriesMotion}
              pathLength={1}
            />
            <ChartLegend
              content={
                <ChartLegendContent className="justify-start gap-5 text-xs font-medium text-on-surface-variant" />
              }
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
      {footer}
    </Card>
  );
}

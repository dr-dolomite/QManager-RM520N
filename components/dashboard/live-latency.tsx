"use client";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid } from "recharts";

import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";

import { cn } from "@/lib/utils";
import { DUR } from "@/lib/motion";
import {
  ABSENT,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  CLOCK_TICK_MS,
  LANE,
  ROW,
  VALUE_CLASS,
} from "./shapes";
import { PillRow } from "./pill-row";
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { useSpeedtest, type SpeedtestPhase } from "@/hooks/use-speedtest";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
import { Tag } from "@/components/ui/tag";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickingValue } from "@/components/ui/ticking-value";
import { SpeedtestDialog } from "./speedtest-dialog";
import { formatSpeed, type SpeedtestProgressLine } from "@/types/speedtest";

import type { ConnectivityStatus } from "@/types/modem-status";

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

/**
 * One constant for the plot box, consumed by the chart, the skeleton and the
 * empty state alike — floor-plus-grow rather than a fixed height.
 *
 * In the design mock this card sits beside two other naturally-equal-height
 * columns, so a fixed 150px plot never left slack. In the real dashboard grid
 * this card is a row-mate of Device Metrics (which is taller — seven metric
 * rows), so the card stretches to match and all of that slack used to collect
 * as dead space between the plot and the Speed Test tile. `flex-1` lets the
 * plot claim that slack instead, while the tile stays pinned to the bottom
 * with `mt-auto`.
 *
 * `min-h-[150px]` rather than no floor at all, for two reasons that still
 * apply. `ChartContainer`'s base class is `aspect-video`, so an unpinned
 * chart's height is a function of the card's width and changes as the
 * dashboard grid reflows — `aspect-auto` (applied at the call site) defeats
 * that, but only once the container HAS a height to report. And recharts'
 * `ResponsiveContainer` renders NOTHING until it has measured its parent, so a
 * zero-height parent on the first frame makes the card pop when the
 * measurement lands. `min-h-[150px]` guarantees a measurable height on that
 * first frame even before the flex parent has resolved how much slack there
 * is to hand out, discharging the same obligation the old fixed height did.
 */
const CHART_BOX = "min-h-[150px] flex-1";

// =============================================================================
// Speed Test row
// =============================================================================
//
// This was an 88px tile with two tonal figure chips. It is a 40px `PillRow`
// now, in the SAME form Device Metrics uses for Data Used.
//
// The reason is not the 48px. Both are a DOWN/UP PAIR and they are the only
// two on the surface, so drawing them in two different shapes meant a user who
// learned one had not learned the other. The row form also invents nothing:
// Data Used already puts a control in the label cell (the counter reset) and
// the signal cards already put a bar inline in a 40px row, which is exactly
// the two things this needs.
//
// The big result is not lost, it moves to where it belongs -- `SpeedtestDialog`
// is the detail view and already renders it in full.

/**
 * Past this, a result's age is read as a broken clock rather than an old test.
 *
 * The modem stamps the result with its own clock and the browser supplies
 * `now`, so this subtracts two machines. On a device that has not reached NTP
 * (the RTC starts at the epoch) a naive diff renders "20454 d ago" — a number
 * that is not merely wrong but actively misleading about whether the reading
 * below it can be trusted. A year is comfortably past any legitimate cached
 * result and comfortably short of an unsynced clock.
 */
const ABSURD_AGE_SEC = 365 * 86400;

/** Unix-seconds now, refreshed on its own clock. */
function useNowSec(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      CLOCK_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Locale-aware relative time for the cached result's ISO-8601 stamp.
 *
 * Local rather than shared with Recent Activities' copy on purpose, and worth
 * naming because a third private clock helper is normally a smell: that one
 * takes UNIX SECONDS from the poller and keys the `activities.time.*` subtree,
 * this one takes an ISO STRING from the Ookla payload and keys
 * `speedtest.time_*`. Neither is exported, and hoisting one into a shared
 * module is a change to files this card does not own. The two things that
 * actually matter — one clock reading in, and a defensive clamp — are mirrored
 * exactly.
 *
 * `nowSec` is a parameter rather than a second `Date.now()` here so the label
 * can never straddle a threshold that some other part of the render already
 * decided on the other side of.
 */
function useSpeedtestTimeAgo() {
  const { t } = useTranslation("dashboard");
  return useCallback(
    (iso: string, nowSec: number): string | null => {
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return null;

      // A negative diff is a browser clock behind the modem's; an enormous one
      // is a modem that never synced. Both collapse to "just now" — vague, but
      // the only honest thing a broken clock supports saying.
      const diff = nowSec - Math.floor(ms / 1000);
      if (diff < 60 || diff > ABSURD_AGE_SEC) return t("speedtest.time_just_now");
      if (diff < 3600)
        return t("speedtest.time_minutes_ago", { count: Math.floor(diff / 60) });
      if (diff < 86400)
        return t("speedtest.time_hours_ago", { count: Math.floor(diff / 3600) });
      return t("speedtest.time_days_ago", { count: Math.floor(diff / 86400) });
    },
    [t],
  );
}

/**
 * Which measurement the run is on, as the user reads it.
 *
 * `initializing` deliberately has no entry: the run is genuinely between
 * measurements there, and naming it "Latency" a beat before latency starts is
 * the same lie the dialog's ping floor exists to prevent. It falls back to the
 * generic "Running" label instead.
 */
const PHASE_LABEL_KEY: Partial<Record<SpeedtestPhase, string>> = {
  ping: "speedtest.step_latency",
  download: "speedtest.step_download",
  upload: "speedtest.step_upload",
};

/**
 * The one figure the running tile prints, pulled from whichever branch of the
 * progress union is live.
 *
 * Returns null while the run has no measurement to report — a placeholder is
 * drawn in that slot rather than a zero, because "0.00 Mbps" is a claim about
 * the connection and "still connecting" is not.
 */
function liveReading(
  phase: SpeedtestPhase,
  p: SpeedtestProgressLine | null,
): { value: string; unitKey: string } | null {
  if (!p) return null;
  if (phase === "download" && p.type === "download")
    return { value: formatSpeed(p.download.bandwidth), unitKey: "speedtest.unit_mbps" };
  if (phase === "upload" && p.type === "upload")
    return { value: formatSpeed(p.upload.bandwidth), unitKey: "speedtest.unit_mbps" };
  if (phase === "ping" && p.type === "ping")
    return { value: p.ping.latency.toFixed(1), unitKey: "speedtest.unit_ms" };
  return null;
}

interface LiveLatencyComponentProps {
  connectivity: ConnectivityStatus | null;
  isLoading: boolean;
}

/**
 * The chart's two series.
 *
 * The keys are load-bearing and must stay `latency` / `packetloss`: shadcn's
 * `ChartStyle` injects a `--color-<key>` custom property per entry, and both the
 * strokes and the tooltip swatch read those back as raw template strings
 * (`var(--color-${name})`). Renaming a key breaks all three at runtime with no
 * TypeScript error to catch it.
 *
 * The colours were `--chart-1` / `--chart-2`, which are byte-identical in the
 * light and dark blocks of globals.css — the chart did not theme at all. The two
 * role tokens below do.
 *
 * 2026-08-16: packet loss was `--lte`, i.e. the 4G LTE identity hue, on a
 * series that has nothing to do with which radio is attached — a user who
 * learned violet = LTE on the CA strip read a violet trace here and had to
 * unlearn it. It is now the neutral ink. That is deliberate rather than a
 * placeholder: packet loss has no direction (so neither Downlink Rose nor
 * Uplink Cyan fits) and no radio (so neither identity hue does), and painting
 * it from the functional ramp would make a healthy 0% line permanently red —
 * "reports, never alarms" cuts against a fault-coloured series that is drawn
 * even when nothing is wrong. Latency keeps `--primary` as the surface's one
 * brand-weight data series.
 */
const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--primary)",
  },
  packetloss: {
    label: "Packetloss",
    color: "var(--on-surface-variant)",
  },
} satisfies ChartConfig;

/**
 * The header chip's tone, derived from what we actually know rather than from an
 * invented latency-quality threshold. The backend owns latency thresholds (the
 * Connection Quality presets that feed `high_latency`), and duplicating a number
 * here would let the card disagree with the alert that fires beside it.
 *
 * So the chip reports REACHABILITY, which this component holds first-hand: a
 * reading means the last probe came back, no reading means it timed out, and no
 * connectivity object at all means we have nothing to say.
 *
 * Distinct glyph per tone is mandatory, not decorative: `success-container` and
 * the other role containers sit within ~1.03:1 of each other, so colour alone
 * does not separate these states for a deuteranopic reader.
 */
function chipTone(connectivity: ConnectivityStatus | null): {
  variant: BadgeVariant;
  glyph: MaterialSymbolName;
} {
  if (!connectivity) return { variant: "muted", glyph: "do_not_disturb_on" };
  if (connectivity.latency_ms === null)
    return { variant: "destructive", glyph: "cancel" };
  return { variant: "success", glyph: "check_circle" };
}

/**
 * Extracted so the loading branch and the crossfade overlay render the SAME
 * geometry from one definition (the Skeleton-Mirror Rule). Two copies would
 * drift, and a drifted skeleton turns the handoff from a fade into a jump.
 *
 * Every block mirrors a real element: the title and chip row, the description
 * line, the floor-plus-grow plot, the legend, and the Speed Test row at
 * `ROW.HEIGHT` — the same constant `ROW.ROOT` resolves to, so the row and its
 * placeholder cannot drift apart the way the tile and its 88px stand-in could.
 */
function LiveLatencySkeleton() {
  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="ml-auto h-7 w-24 rounded-pill" />
      </div>
      {/* Two bars in their own stack rather than two children of this one:
          the description's lines sit on their own 22.75px line box, not on the
          card's 14px group gap. */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className={cn("w-full rounded-field", CHART_BOX)} />
      <div className="flex items-center gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className={cn("mt-auto w-full rounded-pill", ROW.HEIGHT)} />
    </div>
  );
}

/** Legend swatch: a 12x3 pill bar, matching the mock's key. */
function LegendEntry({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("h-[3px] w-3 rounded-pill", className)}
      />
      {label}
    </span>
  );
}

const LiveLatencyComponent = ({
  connectivity,
  isLoading,
}: LiveLatencyComponentProps) => {
  const { t } = useTranslation("dashboard");
  const [speedtestOpen, setSpeedtestOpen] = useState(false);

  // `watch: true` is the whole third state. The tile used to fire a one-shot
  // fetch on mount and another on dialog close, which meant a run started in
  // another tab — or from another device on the LAN — was invisible here until
  // something happened to re-open the dialog. The hook now owns the cadence:
  // a 10s heartbeat while idle, escalating itself to 500ms once a run appears
  // and dropping back when it ends. The status endpoint took an flock for
  // exactly this reason, so the dialog mounting its own instance alongside this
  // one is expected rather than tolerated.
  const {
    phase,
    progress,
    currentProgress,
    result: cachedResult,
    isRunning,
  } = useSpeedtest({ watch: true });

  const nowSec = useNowSec();
  const timeAgo = useSpeedtestTimeAgo();

  // Gradient ids are per-instance. A literal string id would collide the moment
  // two of these cards shared a document — SVG ids live in one flat namespace
  // per document, and `url(#id)` resolves to whichever painted first. The colons
  // React puts in a `useId` are stripped for the same reason `ChartContainer`
  // strips them: they are legal in an id but awkward inside a `url()` reference.
  const gradientId = useId().replace(/:/g, "");
  const latencyFill = `${gradientId}-latency`;
  const lossFill = `${gradientId}-loss`;

  // The two chart clocks — see hooks/use-chart-motion.ts. `drawIn` is the CSS
  // entrance and retires itself once it has run; `seriesMotion` is the ongoing
  // poll-to-poll morph, which only works BECAUSE the entrance retires.
  const drawIn = useChartDrawIn();
  const seriesMotion = useChartSeriesMotion();

  const handleSpeedtestOpen = useCallback(() => {
    setSpeedtestOpen(true);
  }, []);

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
        // A lost ping is an ABSENT reading, not a fast one. Coercing it to 0
        // drew a total blackout as a healthy flat line pinned to the floor of
        // the plot. recharts breaks the path on a null datum and skips its dot,
        // which is the honest shape: a gap where nothing was measured. The
        // packet-loss series beside it still rises, so the outage stays visible
        // rather than merely missing.
        latency: rtt !== null ? Math.round(rtt) : null,
        packetloss: lossPct,
      };
    });
  }, [connectivity?.latency_history, connectivity?.history_interval_sec]);

  const lastIndex = chartData.length - 1;

  // Skeleton handoff (Motion Guide recipe 03). The overlay lives for exactly one
  // `quick` and then unmounts; nothing downstream depends on it, so a missed
  // timer degrades to a plain instant swap rather than a stuck skeleton.
  const [handoff, setHandoff] = useState(false);
  const wasLoading = useRef(isLoading);
  useEffect(() => {
    const landed = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!landed) return;

    setHandoff(true);
    const id = window.setTimeout(() => setHandoff(false), DUR.quick * 1000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  const tone = chipTone(connectivity);
  const latencyMs = connectivity?.latency_ms ?? null;
  const hasReading = latencyMs !== null;

  // CardHeader + CardAction rather than a hand-rolled flex row with `ml-auto`.
  // The header grid already reserves a right-hand column the moment a
  // `data-slot="card-action"` child appears, which is the layout this was
  // rebuilding by hand, and `CardAction`'s `self-start justify-self-end` is
  // what top-aligns a chip against a single-line title. Recent Activities —
  // this card's row-mate — ships a chip in exactly this slot, so matching it
  // keeps the three cards in the row structurally identical instead of one of
  // them arriving at the same pixels by a different route.
  const header = (
    <CardHeader className="px-0">
      <CardTitle className={CARD_TITLE}>{t("latency.title")}</CardTitle>
      {/* An explicit ink class because the primitive hardcodes a retired one.
          Unlike Device Metrics', this description IS skeletoned: that card
          renders its header outside the crossfade, so its title and
          description are on screen from the first frame; here the whole body
          swaps, and a header line with no placeholder would pop in. */}
      <CardDescription className={CARD_DESC}>
        {t("latency.description")}
      </CardDescription>
      <CardAction>
      {/* No `transition-colors` utility here on purpose: `Badge` writes its own
          two-clock transition longhand (fill + ink on `standard`, focus ring on
          `quick`), and a utility would re-declare transition-property and drop
          the ring's separate clock. */}
      <Badge
        variant={tone.variant}
        className="gap-1.5 px-3 py-1.5 text-xs font-semibold"
      >
        {/* The sr-only name stays OUTSIDE the swap on purpose. It is the chip's
            stable accessible label, not part of the statement that changes, and
            `popLayout` keeps the outgoing and incoming spans in the DOM together
            for the length of the crossfade — inside, a screen reader would meet
            "Current latency" twice for a full `quick` (360ms) on every tone change. */}
        <span className="sr-only">{t("latency.current_label")}</span>
        {/* The chip's LABEL crossfades (Motion Guide recipe 05) and its numeric
            reading TICKS (recipe 06) — two different gestures for two different
            things.

            Two bugs lived here. The block hand-rolled `AnimatePresence` +
            `motion.span`, duplicating `SwapLabel`; and the GLYPH sat outside it,
            so it snapped in one frame while the fill morphed over `standard` — the
            motion half of the colour-blindness contract, since the glyph is the
            only channel separating these tones in greyscale. The key was also
            coarser than the tone it reports: `hasReading` cannot distinguish
            muted-with-no-connectivity from success, so a variant change with a
            reading present animated nothing. Keying on the variant AND the
            reading covers both, and still does not fire on an ordinary poll —
            that movement belongs to `TickingValue`. */}
        {/* The `gap-1.5` moves onto the swapping span with the glyph: it is now
            the glyph-to-label gap, and the Badge's own gap no longer has two
            in-flow children to separate. */}
        <SwapLabel swapKey={`${tone.variant}-${hasReading}`} className="gap-1.5">
          {/* Explicit `size={12}`: MaterialSymbol carries its size as an inline
              fontSize, and the swap wrapper puts the glyph a level deeper than
              Badge's `[&>svg]` selector reaches. */}
          <MaterialSymbol name={tone.glyph} size={12} filled />
          {hasReading ? (
            <TickingValue value={latencyMs}>
              {latencyMs} {t("latency.unit_ms")}
            </TickingValue>
          ) : (
            t("latency.no_reading")
          )}
        </SwapLabel>
        </Badge>
      </CardAction>
    </CardHeader>
  );

  const chart =
    chartData.length === 0 ? (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-field bg-surface-container px-6 text-center",
          CHART_BOX,
        )}
      >
        <MaterialSymbol name="timeline" size={24} className="text-on-surface-variant" />
        <p className="text-xs font-medium text-on-surface-variant text-pretty">
          {t("latency.empty_description")}
        </p>
      </div>
    ) : (
      // `drawIn` is the entrance (Motion Guide recipe 16) — the keyframes live
      // in globals.css and reach recharts' own emitted classes. It resolves to
      // `chart-draw` for the length of that entrance and to `""` afterwards,
      // which is what lets the series below animate their POLL updates:
      // recharts remounts each series on every data change, so a permanent
      // entrance class would re-fire the draw on every poll instead of once.
      // The hook carries the full explanation.
      <ChartContainer
        config={chartConfig}
        className={cn(drawIn, "aspect-auto w-full", CHART_BOX)}
      >
        <AreaChart
          accessibilityLayer
          data={chartData}
          margin={{
            left: 12,
            right: 12,
          }}
        >
          <defs>
            <linearGradient id={latencyFill} x1="0" y1="0" x2="0" y2="1">
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
            <linearGradient id={lossFill} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-packetloss)"
                stopOpacity={0.32}
              />
              <stop
                offset="55%"
                stopColor="var(--color-packetloss)"
                stopOpacity={0.1}
              />
              <stop
                offset="100%"
                stopColor="var(--color-packetloss)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
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
                    <div className="ml-auto flex items-baseline gap-0.5 font-medium tabular-nums text-foreground">
                      {value}
                      <span className="font-normal text-on-surface-variant">
                        {name === "latency" ? "ms" : "%"}
                      </span>
                    </div>
                  </>
                )}
              />
            }
          />
          {/* Packet loss is drawn first so latency — the series the card is
              named for — sits on top of it.

              `seriesMotion` on both is what makes the trace MOVE between polls
              rather than teleport. Recharts interpolates each point from its
              previous plot position to its new one, which nothing outside
              recharts can do — it is the only party that knows where a point
              sits in plot space. It had been switched off entirely, which is
              why the chart looked static: `chartData` is rebuilt on every poll
              and the path's `d` was simply rewritten in one frame.

              Switching it back on is safe now only because the entrance class
              retires itself (see `drawIn` above). What is NOT restored is
              recharts' default timing: the 1500ms `ease` it ships is almost 2x the
              project's 800ms motion ceiling, on a curve from no design system,
              so the hook pins `standard` (600ms) on `--ease-standard`. Reduced
              motion is handled in the hook too — recharts animates through
              react-smooth, a separate engine `MotionConfig` cannot reach.

              `pathLength={1}` normalises each path to one user unit so the
              `stroke-dasharray: 1` in `.chart-draw` is a single dash covering
              the whole line at any card width. The mock's hardcoded
              `stroke-dasharray="2400"` against a real ~400-700px path would
              spend most of its 600ms invisible and then snap. */}
          <Area
            dataKey="packetloss"
            type="monotone"
            stroke="var(--color-packetloss)"
            strokeWidth={2.5}
            fill={`url(#${lossFill})`}
            dot={false}
            {...seriesMotion}
            pathLength={1}
          />
          <Area
            dataKey="latency"
            type="monotone"
            stroke="var(--color-latency)"
            strokeWidth={2.5}
            fill={`url(#${latencyFill})`}
            // A filled dot on the newest point only, marking "you are here".
            // Rendered through the dot renderer rather than a ReferenceDot so it
            // tracks the series' own computed geometry.
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === lastIndex &&
              props.cx !== undefined &&
              props.cy !== undefined ? (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={4.5}
                  fill="var(--color-latency)"
                />
              ) : (
                <g />
              )
            }
            {...seriesMotion}
            pathLength={1}
          />
        </AreaChart>
      </ChartContainer>
    );

  const legend = (
    <div className="flex items-center gap-4 text-xs font-medium text-on-surface-variant">
      <LegendEntry className="bg-primary" label={t("latency.chart_latency")} />
      <LegendEntry
        className="bg-on-surface-variant"
        label={t("latency.chart_packetloss")}
      />
    </div>
  );

  // --- Speed Test row --------------------------------------------------------
  // Three states off one data source: running (a run is in flight, wherever it
  // was started from), cached (a previous result to report), and never-run.
  // They share one 40px `PillRow`, so switching between them changes what the
  // value cell says and never the height of the card.

  const reading = liveReading(phase, currentProgress);
  const phaseLabelKey = PHASE_LABEL_KEY[phase];
  const runLabel = phaseLabelKey
    ? t(phaseLabelKey)
    : t("speedtest.tile_running_label");
  // 0–1 WITHIN the current phase, not across the run — the meter refills as
  // each measurement starts, which is what the phase caption beside it says is
  // happening. Clamped because the bar is drawn from it directly and a stray
  // value out of the CLI would otherwise overshoot its own track.
  const progressPct = Math.min(100, Math.max(0, progress * 100));
  const agoLabel = cachedResult ? timeAgo(cachedResult.timestamp, nowSec) : null;

  const speedtestRow = (
    <PillRow
      label={
        <>
          <span className="truncate">{t("speedtest.section_label")}</span>
          {/* The play control lives in the LABEL cell, which is the whole
              reason `PillRow.label` is a node rather than a string — Data Used
              puts its counter reset in the same position, with the same
              `size-5 rounded-pill` ghost treatment. The 34px filled disc the
              tile used was the affordance for an 88px block; at row scale a
              second filled disc would outweigh the reading beside it. */}
          <Button
            variant="ghost"
            size="icon"
            className="size-5 rounded-pill text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            aria-label={t("speedtest.start_button_aria")}
            onClick={handleSpeedtestOpen}
          >
            <MaterialSymbol name="play_arrow" size={14} filled />
          </Button>
        </>
      }
    >
      {isRunning ? (
        <>
          {/* The live dot is the sanctioned `animate-live-ping` idiom (a disc
              expanding past its anchor and fading), not a fourth hand-rolled
              loop. It is gated on a genuinely live run, which is the whole
              condition the One-Loop Rule asks for. */}
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
            <span aria-hidden className="relative inline-flex size-[7px] shrink-0">
              <span className="absolute inset-0 rounded-pill bg-primary animate-live-ping" />
              <span className="relative size-[7px] rounded-pill bg-primary" />
            </span>
            {/* The phase caption drops out at the same width the reading age
                does, and for the same reason: below it the row would start
                truncating "Speed Test" instead. The dot, the figure and the
                meter still say a run is in flight, and the caption survives
                for assistive tech as the meter's own label. */}
            <span className="hidden @[350px]/card:inline">{runLabel}</span>
          </span>
          {/* Machine voice, and deliberately NOT wrapped in `TickingValue`.
              That tick is a 1.4s gesture tuned for the ~3s dashboard poll; at
              the speedtest's 500ms live cadence it would never finish before
              the next value arrived and would read as a strobe. The number
              simply lands on the poll tick.

              `ABSENT` rather than a zero while the run has no measurement yet:
              "0.00 Mbps" is a claim about the connection and "still
              connecting" is not. */}
          <span className={cn(VALUE_CLASS, "flex items-baseline gap-1")}>
            {reading ? reading.value : ABSENT}
            {reading ? (
              <span className="text-xs font-semibold text-on-surface-variant">
                {t(reading.unitKey)}
              </span>
            ) : null}
          </span>
          {/* The shared meter at the surface's inline-lane width. The bespoke
              bar this replaces was 6px on a `bg-white/45` track — a hardcoded
              white with an alpha, which does not theme and was compensating
              for a mismatched pair rather than fixing it.

              No thresholds: progress is not a quality reading, so there is no
              value at which it should turn amber. `Infinity` says that
              outright, where a 101 would read as a number someone chose. */}
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
            aria-label={runLabel}
            className={LANE}
          >
            <MetricBar
              value={progressPct}
              max={100}
              warnAt={Number.POSITIVE_INFINITY}
              dangerAt={Number.POSITIVE_INFINITY}
              track="surface-container-high"
            />
          </span>
        </>
      ) : cachedResult ? (
        <>
          <span className="sr-only">{t("speedtest.result_label")}</span>
          {/* Provenance first, then the measurement. The age is metadata ABOUT
              a reading rather than a verdict on one, so it is a `Tag` and not
              a `Badge` (the Two-Form Rule). It is the first casualty when the
              row runs out of width and it is the one thing that may not go:
              a result with no age is a result claiming to be current.

              350px is measured, not chosen: the full row needs 346px of the
              card's content box, and a three-column card holds 389px at 1440
              and 283px at 1120. So the Tag rides the three-column layout down
              to about 1290px and drops out below it, where the alternative
              would be squeezing the two figures. `h-5` pins it to the row's
              own 20px line box — the Tag's natural 22px grew the row to 42 and
              broke the skeleton's mirror. */}
          {agoLabel ? (
            <Tag
              variant="neutral"
              className="hidden h-5 @[350px]/card:inline-flex"
            >
              {agoLabel}
            </Tag>
          ) : null}
          {/* The identical glyph-plus-ink pair Data Used draws, deliberately.
              These are the only two down/up pairs on the surface, and the
              direction hues are the axis they share — Downlink Rose and Uplink
              Cyan on their `-on-surface` inks, on the row's own container.

              The unit stays screen-reader-only, which is the tile's own
              decision carried over: the two figures sit adjacent and share it
              by eye, while each is still announced as its own reading. Printing
              it twice was measured and costs 76px — with it visible the full
              row needs 390px against the 389px a three-column card actually
              has, so the age Tag beside it would be gated out at every desktop
              width. Two words of duplicated unit are not worth a reading that
              cannot say how old it is. */}
          <span className={cn(VALUE_CLASS, "flex items-center gap-1")}>
            <MaterialSymbol
              name="arrow_circle_down"
              size={20}
              filled
              className="shrink-0 text-downlink-on-surface"
            />
            <span className="sr-only">{t("speedtest.result_download")}</span>
            {formatSpeed(cachedResult.download.bandwidth)}
            <span className="sr-only"> {t("speedtest.unit_mbps")}</span>
          </span>
          <span className={cn(VALUE_CLASS, "flex items-center gap-1")}>
            <MaterialSymbol
              name="arrow_circle_up"
              size={20}
              filled
              className="shrink-0 text-uplink-on-surface"
            />
            <span className="sr-only">{t("speedtest.result_upload")}</span>
            {formatSpeed(cachedResult.upload.bandwidth)}
            <span className="sr-only"> {t("speedtest.unit_mbps")}</span>
          </span>
        </>
      ) : (
        // Never run. The play control beside the label is the affordance, so
        // the sentence the tile carried has no reader left — the row is
        // self-evident at a glance in a way an 88px empty block was not.
        <span className={cn(VALUE_CLASS, "text-on-surface-variant")}>
          {ABSENT}
        </span>
      )}
    </PillRow>
  );

  const body = isLoading ? (
    <LiveLatencySkeleton />
  ) : (
    <>
      {header}
      {chart}
      {legend}
      {speedtestRow}
    </>
  );

  return (
    <>
      <Card className={CARD_SHELL}>
        {/* The skeleton crossfade is an OVERLAY on top of the real content, not
            a sibling beside it. Stacked as siblings the card would size to the
            taller of the two for the length of the fade and then collapse, so
            the handoff would end in a jolt; as an overlay the real content owns
            the height from its first frame and the crossfade contributes zero
            layout shift.

            No `h-full` on the Card itself — the dashboard grid equalises this
            row with `h-full *:data-[slot=card]:h-full`, so the Card must stay a
            direct child and must not pin its own height. */}
        <div className="relative flex flex-1 flex-col">
          <div
            className={cn(
              "flex flex-1 flex-col gap-3.5",
              handoff && "ca-content-in",
            )}
          >
            {body}
          </div>
          {handoff && (
            <div
              aria-hidden
              className="ca-skeleton-out pointer-events-none absolute inset-0"
            >
              <LiveLatencySkeleton />
            </div>
          )}
        </div>
      </Card>

      {/* No refetch-on-close handler any more: the tile's own `watch` poll is
          already the source of truth for both the run and its result, so the
          dialog closing needs to do nothing but close. */}
      <SpeedtestDialog open={speedtestOpen} onOpenChange={setSpeedtestOpen} />
    </>
  );
};

export default LiveLatencyComponent;

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

import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { DUR } from "@/lib/motion";
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  formatSpeed,
  type SpeedtestFinalResult,
  type SpeedtestStatusResponse,
} from "@/types/speedtest";

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

const CGI_BASE = "/cgi-bin/quecmanager/at_cmd";

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

// Byte-identical to the shells in device-metrics.tsx and recent-activities.tsx,
// because those two are this card's row-mates and three cards sharing a grid
// row have to share a shell. Four things were out of step and each is worth
// naming, since a parallel rewrite is exactly where this drift comes from:
//
//   `@container/latency` -> `@container/card`. Harmless today only because
//   this file happens to use no container queries; the moment one is added as
//   `@[540px]/card:` it matches nothing and fails silently, with no error to
//   find. Every other card in the product names this container `card`.
//
//   `gap-3.5`/`px-7` -> `gap-4`/`px-6`. The mock specifies 26px padding, which
//   has no step on the scale; rounding down matches the row, rounding up did
//   not. Signal History keeps px-7 because its mock value really is 28px and
//   it sits alone in a full-width row with nothing to align to.
//
//   `h-full` restored. The parent grid already forces it via
//   `*:data-[slot=card]:h-full`, so this is redundant rather than load-bearing
//   — but it is redundant in all three siblings, and a shell that differs from
//   its neighbours reads as intent.
const CARD_SHELL =
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

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
 * role tokens below do. `--lte` rather than `--secondary` for packet loss:
 * shipped `--secondary` is a NEUTRAL (it backs progress tracks), so the intended
 * Carrier Violet would have rendered grey.
 */
const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--primary)",
  },
  packetloss: {
    label: "Packetloss",
    color: "var(--lte)",
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
 * Every block mirrors a real element: the title and chip row, the floor-plus-
 * grow plot, the legend, and the Speed Test tile at its natural 88px (12px
 * padding twice, a 20px label, a 10px gap and the 34px action row).
 */
function LiveLatencySkeleton() {
  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="ml-auto h-7 w-24 rounded-pill" />
      </div>
      <Skeleton className={cn("w-full rounded-field", CHART_BOX)} />
      <div className="flex items-center gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-auto h-[88px] w-full rounded-tile" />
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
  const [cachedResult, setCachedResult] = useState<SpeedtestFinalResult | null>(
    null,
  );

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
      <CardTitle className="text-lg font-semibold">
        {t("latency.title")}
      </CardTitle>
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
            "Current latency" twice for 180ms on every tone change. */}
        <span className="sr-only">{t("latency.current_label")}</span>
        {/* The chip's LABEL crossfades (Motion Guide recipe 05) and its numeric
            reading TICKS (recipe 06) — two different gestures for two different
            things.

            Two bugs lived here. The block hand-rolled `AnimatePresence` +
            `motion.span`, duplicating `SwapLabel`; and the GLYPH sat outside it,
            so it snapped in one frame while the fill morphed over 300ms — the
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
            <TickingValue value={latencyMs} className="font-mono">
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
              recharts' default timing: the 1500ms `ease` it ships is 3.75x the
              project's 400ms motion ceiling on a curve from no design system,
              so the hook pins `standard` (300ms) on `--ease-standard`. Reduced
              motion is handled in the hook too — recharts animates through
              react-smooth, a separate engine `MotionConfig` cannot reach.

              `pathLength={1}` normalises each path to one user unit so the
              `stroke-dasharray: 1` in `.chart-draw` is a single dash covering
              the whole line at any card width. The mock's hardcoded
              `stroke-dasharray="2400"` against a real ~400-700px path would
              spend most of its 300ms invisible and then snap. */}
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
      <LegendEntry className="bg-lte" label={t("latency.chart_packetloss")} />
    </div>
  );

  const speedtestTile = (
    <div className="mt-auto flex flex-col gap-2.5 rounded-tile bg-surface-container px-4 py-3">
      {/* The mock sets this label and the two figures at 13px. That step is a
          surface-scoped exception in DESIGN.md (banners), not part of the ramp,
          so they take `text-sm` — the same call Recent Activities made when it
          was retargeted from the same mock family. */}
      <span className="text-sm font-semibold">
        {t("speedtest.section_label")}
      </span>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {/* Hover is one tone step plus a 1px lift on `quick` (Motion Guide
            recipe 08); the focus ring comes from the Button base and runs on its
            own `quick` clock. */}
        <Button
          variant="default"
          size="icon"
          className="rounded-pill duration-(--duration-quick) ease-out hover:-translate-y-px"
          aria-label={t("speedtest.start_button_aria")}
          onClick={handleSpeedtestOpen}
        >
          <MaterialSymbol name="play_arrow" size={16} filled />
        </Button>
        {cachedResult ? (
          <>
            <span className="text-xs font-medium text-on-surface-variant">
              {t("speedtest.result_label")}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
              <MaterialSymbol
                name="arrow_circle_down"
                size={16}
                filled
                className="shrink-0 text-primary"
              />
              <span className="sr-only">{t("speedtest.result_download")}</span>
              {formatSpeed(cachedResult.download.bandwidth)}
              {/* The unit is printed once, on the upload figure below, because
                  the two readings sit adjacent and share it — the mock's own
                  compact idiom ("412 / 68 Mbps"), and repeating "Mbps" twice in
                  a tile this size reads as noise.

                  That works only for the EYE, though. Each figure carries its
                  own sr-only label, so the two are announced as separate
                  readings and a screen reader would hear "Download 412" with no
                  unit at all while the upload beside it got one. The unit is
                  therefore repeated here for assistive tech only: same
                  information to both audiences, each in the form that suits
                  it. */}
              <span className="sr-only"> {t("speedtest.unit_mbps")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
              <MaterialSymbol
                name="arrow_circle_up"
                size={16}
                filled
                className="shrink-0 text-uplink"
              />
              <span className="sr-only">{t("speedtest.result_upload")}</span>
              {formatSpeed(cachedResult.upload.bandwidth)}{" "}
              {t("speedtest.unit_mbps")}
            </span>
          </>
        ) : (
          <p className="text-xs font-medium text-on-surface-variant text-pretty">
            {t("speedtest.idle_description")}
          </p>
        )}
      </div>
    </div>
  );

  const body = isLoading ? (
    <LiveLatencySkeleton />
  ) : (
    <>
      {header}
      {chart}
      {legend}
      {speedtestTile}
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

      <SpeedtestDialog open={speedtestOpen} onOpenChange={handleDialogChange} />
    </>
  );
};

export default LiveLatencyComponent;

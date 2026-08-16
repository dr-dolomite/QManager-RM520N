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
import { useChartDrawIn, useChartSeriesMotion } from "@/hooks/use-chart-motion";
import { useSpeedtest, type SpeedtestPhase } from "@/hooks/use-speedtest";
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

// =============================================================================
// Speed Test tile
// =============================================================================

/**
 * The tile's resting height, shared by the tile itself and by the skeleton that
 * stands in for it (the Skeleton-Mirror Rule). The card runs a skeleton→content
 * CROSSFADE, so both are on screen together during the handoff — a drifted
 * number here is not a rounding detail, it is a visible jump at the moment the
 * real content lands.
 *
 * 88px is measured from the markup below, and every one of the three tile
 * states is built to land on it:
 *
 *   12px  py-3 top
 *   20px  header row (`text-sm` label / its `leading-5` line box)
 *   10px  gap-2.5
 *   34px  action row — the comp pins the play disc AND the running spinner disc
 *         at 34px, and the running state's stacked column is tuned to the same
 *         34px (a 22px value line + a 6px gap + the 6px meter) rather than being
 *         allowed to find its own height. The cached state's two figure chips
 *         are 30px, so the disc governs there too.
 *   12px  py-3 bottom
 *
 * It is a MIN-height, not a fixed one: the idle state's sentence can wrap on a
 * narrow card and must be allowed to, and a growing tile is far better than a
 * clipped one. What it must never do is change height when the tile switches
 * BETWEEN states, which is why the three bodies are matched rather than left to
 * their intrinsic sizes.
 *
 * Note the shipped value was already 88 while the real tile measured 90 — the
 * play button was inheriting Button's `size-9` (36px) instead of the comp's 34.
 * Pinning the disc closes that 2px gap rather than papering over it.
 */
const SPEEDTEST_TILE_H = "min-h-[88px]";

/**
 * How often the tile re-reads the wall clock, independent of the status poll.
 *
 * The relative timestamp ("14 min ago") is a function of TIME, not of the
 * payload, so it cannot be left to re-evaluate only when a fetch lands. In
 * `watch` mode the status endpoint is polled every 10s but returns a
 * byte-identical cached result each time, so React bails out of the re-render
 * and the label would sit frozen at whatever it said when the result first
 * arrived. Same reasoning, same 30s cadence, as Recent Activities.
 */
const CLOCK_TICK_MS = 30_000;

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

/**
 * One cached figure, as a filled tonal pill.
 *
 * The fill is the colour contract, not decoration: one hue per measurement,
 * held from this tile through the dialog to the result — download is primary
 * blue, upload is Carrier Violet. (Upload used to be drawn in Uplink Cyan here,
 * which left the dialog's latency reading with no hue of its own; cyan is now
 * latency's, everywhere.) These are IDENTITY fills under DESIGN.md's
 * Identity-Chip Rule — they say WHICH measurement, never how good it was — so
 * each one also carries a direction glyph and the reading is machine voice.
 */
function SpeedtestFigure({
  glyph,
  className,
  srLabel,
  value,
  unit,
}: {
  glyph: MaterialSymbolName;
  className: string;
  srLabel: string;
  value: string;
  unit: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill py-[5px] pl-2 pr-[11px] text-sm font-semibold tabular-nums",
        className,
      )}
    >
      <MaterialSymbol name={glyph} size={15} className="shrink-0" />
      <span className="sr-only">{srLabel}</span>
      {value}
      {/* The unit is printed for assistive tech only. The two chips sit
          adjacent and share it by eye — the mock's compact idiom — but each is
          announced as its own reading, so a screen reader would otherwise hear
          a bare number. */}
      <span className="sr-only"> {unit}</span>
    </span>
  );
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
 * Every block mirrors a real element: the title and chip row, the floor-plus-
 * grow plot, the legend, and the Speed Test tile at `SPEEDTEST_TILE_H`.
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
      <Skeleton
        className={cn("mt-auto w-full rounded-tile", SPEEDTEST_TILE_H)}
      />
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
      <LegendEntry
        className="bg-on-surface-variant"
        label={t("latency.chart_packetloss")}
      />
    </div>
  );

  // --- Speed Test tile -------------------------------------------------------
  // Three states off one data source: running (a run is in flight, wherever it
  // was started from), cached (a previous result to report), and idle (neither).
  // They share a header row and a 34px action row so switching between them is
  // a colour and content change, never a reflow of the card.

  const reading = liveReading(phase, currentProgress);
  const phaseLabelKey = PHASE_LABEL_KEY[phase];
  // 0–1 WITHIN the current phase, not across the run — the meter refills as
  // each measurement starts, which is what the phase caption above it says is
  // happening. Clamped because the bar is drawn from it directly and a stray
  // value out of the CLI would otherwise overshoot its own track.
  const progressPct = Math.min(100, Math.max(0, progress * 100));
  const agoLabel = cachedResult ? timeAgo(cachedResult.timestamp, nowSec) : null;

  const playButton = (
    // Hover is one tone step plus a 1px lift on `quick` (Motion Guide recipe
    // 08); the focus ring comes from the Button base and runs on its own
    // `quick` clock. `size-[34px]` overrides the `icon` size's 36px so the disc
    // matches the running state's spinner disc exactly — see SPEEDTEST_TILE_H.
    <Button
      variant="default"
      size="icon"
      className="size-[34px] shrink-0 rounded-pill duration-(--duration-quick) ease-out hover:-translate-y-px"
      aria-label={t("speedtest.start_button_aria")}
      onClick={handleSpeedtestOpen}
    >
      <MaterialSymbol name="play_arrow" size={20} filled />
    </Button>
  );

  const speedtestTile = (
    <div
      className={cn(
        // The container fill IS the state, so it moves on `emphasized` (400ms)
        // like every other container morph in the product — a tile going blue
        // is the same class of gesture as a chip changing tone, not a hover.
        "mt-auto flex flex-col gap-2.5 rounded-tile px-4 py-3 transition-colors duration-(--duration-emphasized) ease-emphasized motion-reduce:transition-none",
        SPEEDTEST_TILE_H,
        isRunning
          ? "bg-primary-container text-on-primary-container"
          : "bg-surface-container",
      )}
    >
      <div className="flex items-center gap-2">
        {/* The mock sets this label and the two figures at 13px. That step is a
            surface-scoped exception in DESIGN.md (banners), not part of the
            ramp, so they take `text-sm` — the same call Recent Activities made
            when it was retargeted from the same mock family. */}
        <span className="text-sm font-semibold">
          {t("speedtest.section_label")}
        </span>
        {/* The phase name is prose, not a numeric slot, so it snaps to the ramp
            at `text-xs` rather than taking the comp's literal 11px — the same
            call the label above made with the comp's 13px. The numeric slots
            below are the documented exception, not this. */}
        {isRunning ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold">
            {/* The live dot is the sanctioned `animate-live-ping` idiom (a disc
                expanding past its anchor and fading), not a fourth hand-rolled
                loop. It is gated on a genuinely live run, which is the whole
                condition the One-Loop Rule asks for. */}
            <span aria-hidden className="relative inline-flex size-[7px] shrink-0">
              <span className="absolute inset-0 rounded-pill bg-primary animate-live-ping" />
              <span className="relative size-[7px] rounded-pill bg-primary" />
            </span>
            {phaseLabelKey
              ? t(phaseLabelKey)
              : t("speedtest.tile_running_label")}
          </span>
        ) : agoLabel ? (
          <span className="ml-auto text-[11px] tabular-nums text-on-surface-variant">
            {agoLabel}
          </span>
        ) : null}
      </div>

      {isRunning ? (
        <div className="flex min-h-[34px] items-center gap-2.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-pill bg-primary text-primary-foreground">
            {/* `animate-spin` at the comp's 1.1s, the same explicit-duration
                idiom the login button uses. A spinner is a busy signal rather
                than decoration, which is why it is not gated on reduced
                motion. */}
            <MaterialSymbol
              name="progress_activity"
              size={19}
              className="animate-spin [animation-duration:1100ms]"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {/* Machine voice, and deliberately NOT wrapped in `TickingValue`.
                That tick is a 700ms dip tuned for the ~3s dashboard poll; at
                the speedtest's 500ms live cadence it would never finish before
                the next value arrived and would read as a strobe. The number
                simply lands on the poll tick. */}
            {/* The 17px figure and its 11px unit are deliberately off the text
                ramp: DESIGN.md's Numeric step is "600, sized to slot,
                tabular-nums" for live values, and this slot is sized to the
                34px action row so the tile keeps its height across all three
                states. Do not "correct" these to text-base/text-xs — that
                would reflow the tile and break the skeleton mirror. */}
            <span className="flex items-baseline gap-1 leading-[22px]">
              <span className="text-[17px] font-semibold tabular-nums">
                {reading ? reading.value : "—"}
              </span>
              {reading ? (
                <span className="text-[11px] font-semibold opacity-75">
                  {t(reading.unitKey)}
                </span>
              ) : null}
            </span>
            {/* Bespoke rather than the shared Progress primitive: this bar is
                6px on a coloured container with a translucent track, and it is
                driven by `scaleX` rather than `width` because width animation
                is reserved for the Carrier Aggregation strip, where the width
                genuinely IS the data. */}
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPct)}
              aria-label={
                phaseLabelKey
                  ? t(phaseLabelKey)
                  : t("speedtest.tile_running_label")
              }
              className="block h-1.5 overflow-hidden rounded-pill bg-white/45"
            >
              <span
                aria-hidden
                className="block h-full origin-left rounded-pill bg-primary transition-transform duration-(--duration-standard) ease-standard motion-reduce:transition-none"
                style={{ transform: `scaleX(${progressPct / 100})` }}
              />
            </span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[34px] items-center gap-2.5">
          {playButton}
          {cachedResult ? (
            <span className="ml-auto inline-flex items-center gap-2.5">
              <span className="sr-only">{t("speedtest.result_label")}</span>
              <SpeedtestFigure
                glyph="arrow_downward"
                className="bg-downlink-container text-on-downlink-container"
                srLabel={t("speedtest.result_download")}
                value={formatSpeed(cachedResult.download.bandwidth)}
                unit={t("speedtest.unit_mbps")}
              />
              <SpeedtestFigure
                glyph="arrow_upward"
                className="bg-uplink-container text-on-uplink-container"
                srLabel={t("speedtest.result_upload")}
                value={formatSpeed(cachedResult.upload.bandwidth)}
                unit={t("speedtest.unit_mbps")}
              />
            </span>
          ) : (
            <p className="text-xs font-medium leading-[1.45] text-on-surface-variant text-pretty">
              {t("speedtest.idle_description")}
            </p>
          )}
        </div>
      )}
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

      {/* No refetch-on-close handler any more: the tile's own `watch` poll is
          already the source of truth for both the run and its result, so the
          dialog closing needs to do nothing but close. */}
      <SpeedtestDialog open={speedtestOpen} onOpenChange={setSpeedtestOpen} />
    </>
  );
};

export default LiveLatencyComponent;

"use client";

import React, { useCallback, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
import { HintIcon } from "@/components/ui/hint-icon";
import { Tag } from "@/components/ui/tag";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";

import type {
  DataUsedBlock,
  DeviceStatus,
  LteStatus,
  NrStatus,
} from "@/types/modem-status";
import {
  formatBytes,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
import { useUnitPreferences } from "@/hooks/use-system-settings";
import { useDataUsedReset } from "@/hooks/use-data-used";
import { useSpeedtest, type SpeedtestPhase } from "@/hooks/use-speedtest";
import { formatSpeed, type SpeedtestProgressLine } from "@/types/speedtest";
import { DUR, EASE_QUICK, staggerRows, staggerRowItem } from "@/lib/motion";
import {
  ABSENT,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  DIRECTION,
  FIGURE,
  METER_H,
  SPEEDTEST,
  VALUE_CLASS,
} from "./shapes";
import { PillRow } from "./pill-row";
import { SpeedtestDialog } from "./speedtest-dialog";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  /** `.data_used` from the shared status payload (no separate poll) */
  dataUsed: Omit<DataUsedBlock, "stale"> | null;
  isLoading: boolean;
  /**
   * Whether the last poll actually reached the modem.
   *
   * Spelled exactly as device-status.tsx and network-status.tsx spell it, and
   * for the same reason: the status hook deliberately keeps the previous
   * snapshot on a failed fetch, so a card reading only `deviceData` sees a
   * full, plausible payload during an outage and cannot tell it is looking at
   * a photograph.
   */
  modemReachable: boolean;
}

// --- Warning thresholds ---
const TEMP_WARN = 60; // °C
const TEMP_DANGER = 75; // °C
const CPU_WARN = 70; // percentage
const CPU_DANGER = 90; // percentage

/** `initializing` has no entry on purpose: it falls back to the generic label. */
const PHASE_LABEL_KEY: Partial<Record<SpeedtestPhase, string>> = {
  ping: "speedtest.step_latency",
  download: "speedtest.step_download",
  upload: "speedtest.step_upload",
};

/** Tile figure: a 4-digit Mbps drops its decimal so three figures fit a phone-width card. */
function tileSpeed(bytesPerSec: number): string {
  const s = formatSpeed(bytesPerSec);
  return Number(s) >= 1000 ? String(Math.round(Number(s))) : s;
}

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

/** One speed-test figure; a null `value` (never run) draws ABSENT with no unit.
 *  Direction ink sits on the glyph only; the numeral stays neutral. */
function SpeedFigure({
  glyph,
  glyphClass,
  label,
  value,
  text,
  unit,
}: {
  glyph: MaterialSymbolName;
  glyphClass: string;
  label: string;
  value: number | null;
  text: string;
  unit: string;
}) {
  return (
    <div className={FIGURE.ROOT}>
      <span className={FIGURE.LABEL}>
        {/* A phone-width card cannot fit three glyph-led labels; the word stays.
            `!` because the unlayered .material-symbol display outranks utilities. */}
        <MaterialSymbol
          name={glyph}
          size={14}
          filled
          className={cn(glyphClass, "@max-sm/card:hidden!")}
        />
        {label}
      </span>
      <span className={cn(FIGURE.VALUE, "@max-sm/card:text-base")}>
        {value === null ? (
          ABSENT
        ) : (
          <>
            <TickingValue value={value}>{text}</TickingValue>
            <span className={FIGURE.UNIT}>{unit}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** One meter group: a label/value row over an 8px track. */
function MeterRow({
  label,
  children,
  bar,
}: {
  label: string;
  /** The value cell — already wrapped in its own `TickingValue`. */
  children: React.ReactNode;
  /**
   * The track. ALWAYS a `MetricBar`, never `null` — a bar with no reading
   * takes `value={null}` and draws the empty track (DESIGN.md > Quality bars).
   *
   * This prop used to accept `null` and fall back to an invisible spacer that
   * held the height and drew nothing. That is a THIRD spelling of absence: an
   * empty track says "no reading", a blank gap says "no meter". Introducing
   * the canonical one for the unreachable branch and leaving the old one
   * beside it would have put both in the same slot on the same card.
   */
  bar: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-on-surface-variant">
          {label}
        </span>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
      {bar}
    </motion.div>
  );
}

/**
 * Skeleton (Skeleton-Mirror Rule): three meter groups, the Data Used and Cell
 * Distance pills, and the pinned speed-test tile, at the loaded body's heights.
 */
function MetricsSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className={cn(METER_H, "w-full rounded-pill")} />
        </div>
      ))}
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-pill" />
      ))}
      <div className="mt-auto">
        <Skeleton className={cn(SPEEDTEST.TILE_H, "w-full rounded-tile")} />
      </div>
    </div>
  );
}

const DeviceMetricsComponent = ({
  deviceData,
  lteData,
  nrData,
  dataUsed,
  isLoading,
  modemReachable,
}: DeviceMetricsComponentProps) => {
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");
  const unitPrefs = useUnitPreferences();
  const temp = deviceData?.temperature ?? null;
  const cpu = deviceData?.cpu_usage ?? null;
  const memUsed = deviceData?.memory_used_mb ?? 0;
  const memTotal = deviceData?.memory_total_mb ?? 0;

  // Same spelling as device-status.tsx and network-status.tsx, so the cards on
  // this surface cannot disagree about what "unreachable" means.
  const unreachable = !modemReachable;

  // The chip may not fire off a photograph: a temperature we cannot re-read is
  // not evidence the modem is still hot, and a warning nobody can refresh is
  // worse than no warning at all.
  const isTempHigh = !unreachable && temp !== null && temp >= TEMP_WARN;
  // CPU is /proc/stat on the box serving this page, so its chip is not gated.
  const isCpuHigh = cpu !== null && cpu >= CPU_WARN;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  // The data counter rides the status poll; only its reset is its own request.
  const { isResetting, resetCounter } = useDataUsedReset();

  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleResetConfirm = useCallback(async () => {
    const ok = await resetCounter();
    if (ok) {
      toast.success(t("metrics.reset_success"));
    } else {
      toast.error(t("metrics.reset_error"));
    }
    setResetDialogOpen(false);
  }, [resetCounter, t]);

  const [speedtestOpen, setSpeedtestOpen] = useState(false);
  // One watching instance: a run started elsewhere shows up here too.
  const {
    phase,
    progress,
    currentProgress,
    result: cachedResult,
    isRunning,
  } = useSpeedtest({ watch: true });
  // The run/idle crossfade is for a swap the user watches; a card that mounts
  // already running rides the page cascade, so `swapped` waits for a real change.
  const [prevRunning, setPrevRunning] = useState(isRunning);
  const [swapped, setSwapped] = useState(false);
  if (prevRunning !== isRunning) {
    setPrevRunning(isRunning);
    setSwapped(true);
  }
  const runControlLabel = t(
    isRunning ? "speedtest.view_running" : "speedtest.run_short",
  );
  const reading = liveReading(phase, currentProgress);
  const phaseLabelKey = PHASE_LABEL_KEY[phase];
  const runLabel = phaseLabelKey
    ? t(phaseLabelKey)
    : t("speedtest.tile_running_label");
  const progressPct = Math.min(100, Math.max(0, progress * 100));

  // Skeleton handoff (Motion Guide recipe 11): the overlay lives for one
  // `quick` and then unmounts. Nothing downstream depends on it, so a missed
  // timer degrades to an ordinary instant swap rather than a stuck skeleton.
  const [handoff, setHandoff] = useState(false);
  const wasLoading = React.useRef(isLoading);
  React.useEffect(() => {
    const landed = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!landed) return;

    setHandoff(true);
    const id = window.setTimeout(() => setHandoff(false), DUR.quick * 1000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  // WHERE THE UNREACHABLE GATE STOPS, and it stops in the middle of this card
  // because `modem_reachable` means exactly one thing: the last AT command
  // timed out. It is not a verdict on the machine serving the page.
  //
  // GATED — read over AT, and free to have changed since. Temperature is
  // AT+QTEMP; both distances derive from the serving cell's timing advance.
  // When the poll fails the poller parses nothing and the PREVIOUS value
  // survives, so what is on screen is a photograph. Step 03 made this same
  // call for the two uptimes.
  //
  // NOT GATED — CPU (/proc/stat) and memory (/proc/meminfo) are measured
  // locally and are still fresh; the poller reads them unconditionally,
  // before it ever talks to the modem. Blanking them would be inventing an outage this
  // box is not having. The data counter below is cumulative and monotone: a
  // byte total cannot become WRONG while we are not looking, only incomplete.
  //
  // ABSENT rather than the formatters' own "-": both return a hyphen-minus for
  // a null reading, which beside a column of figures reads as a minus sign
  // with its digits missing. The formatters are shared with other routes, so
  // the sentinel is chosen here rather than changed there.
  const tempValue =
    unreachable || temp === null
      ? ABSENT
      : formatTemperature(temp, unitPrefs?.tempUnit);
  const cpuValue = cpu !== null ? `${cpu}%` : ABSENT;
  const memValue = memTotal > 0 ? `${memUsed} MB / ${memTotal} MB` : ABSENT;

  const lteKm = calculateLteDistance(lteData?.ta ?? null);
  const nrKm = calculateNrDistance(nrData?.ta ?? null);
  const lteDistance =
    unreachable || lteKm === null
      ? ABSENT
      : formatDistance(lteKm, unitPrefs?.distanceUnit);
  const nrDistance =
    unreachable || nrKm === null
      ? ABSENT
      : formatDistance(nrKm, unitPrefs?.distanceUnit);

  const body = isLoading ? (
    <MetricsSkeleton />
  ) : (
    // One tick cascade for the whole body, and the card's reading order is
    // already the cascade order: the four meters top-to-bottom, then the Data
    // Used pill whose rx/tx pair sits side by side and so reads left-to-right,
    // then the cell-distance pair, then the speed-test figures. `TickGroup` sorts
    // the live DOM nodes rather than a declared index, so it needs no axis flag
    // — and rows that hold their value this poll never enter the ranking, which
    // is why one group over eleven figures cannot run long.
    //
    // Wrapping the `motion.div` from outside is deliberate but also safe from
    // inside: `TickGroup` publishes its own React context and never touches
    // `MotionContext`, and motion/react resolves a child's parent through
    // `useContext(MotionContext)`, so an intervening plain provider is
    // transparent to `staggerRows` -> `staggerRowItem` propagation.
    <TickGroup>
      <motion.div
        className="flex flex-1 flex-col gap-3.5"
        // Variants only, no initial/animate: this cascade INHERITS the
        // page-wide clock in home-component.tsx. Declaring its own would
        // detach it and start a second clock, which is the defect the
        // single-cascade step retired.
        variants={staggerRows}
      >
        {/* ── Modem Temperature ─────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.modem_temperature")}
          bar={
            <MetricBar
              value={unreachable ? null : temp}
              max={100}
              warnAt={TEMP_WARN}
              dangerAt={TEMP_DANGER}
              // A cool modem is good news, not merely not-yet-bad — so the
              // meter reads green below the warn line and still escalates to
              // amber and red above it.
              baseTone="success"
              track="surface-container-high"
              index={0}
            />
          }
        >
          {isTempHigh && (
            // The glyph inherits the chip's `on-warning-container` ink. It used
            // to carry `text-warning`, which repainted it in the SOLID role
            // colour on a container fill — the Container-Pair Rule's most common
            // failure. No `transition-colors` here either: `badge.tsx` writes its
            // own two-clock longhand and the utility would clobber it.
            <Badge variant="warning">
              <MaterialSymbol name="warning" size={12} filled />
              {t("metrics.high_temp_warning")}
            </Badge>
          )}
          <span className={VALUE_CLASS}>
            <TickingValue value={temp}>{tempValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── CPU Usage ─────────────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.cpu_usage")}
          bar={
            <MetricBar
              value={cpu}
              max={100}
              warnAt={CPU_WARN}
              dangerAt={CPU_DANGER}
              track="surface-container-high"
              index={1}
            />
          }
        >
          {isCpuHigh && (
            <Badge variant="warning">
              <MaterialSymbol name="warning" size={12} filled />
              {t("metrics.high_cpu_warning")}
            </Badge>
          )}
          <span className={VALUE_CLASS}>
            <TickingValue value={cpu}>{cpuValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── Memory Usage ──────────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.memory_usage")}
          bar={
            <MetricBar
              value={memTotal > 0 ? memPct : null}
              max={100}
              warnAt={70}
              dangerAt={90}
              track="surface-container-high"
              index={2}
            />
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={memUsed}>{memValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── Data Used (cumulative counter from AT+QGDCNT/QGDNRCNT) ────── */}
        <PillRow
          label={
            <>
              <span className="truncate">{t("metrics.data_used_label")}</span>
              <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    aria-label={t("metrics.reset_counter_aria")}
                    disabled={isResetting}
                  >
                    <MaterialSymbol name="restart_alt" size={14} />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("metrics.reset_confirm_title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("metrics.reset_confirm_desc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetConfirm}>
                      {t("metrics.reset_confirm_button")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          }
        >
          {/* Down/up are the one place a solid role colour is right on a
              container: they are accent GLYPHS, not text, and the figure beside
              each keeps the container's ink. Both take the `-on-surface`
              variant, which is the tinted-ink token sized for a plain card.

              Download used to be `text-primary` here — the 5G NR identity hue
              on a figure that counts every byte the modem has received on any
              radio. It is Downlink Rose now, and this tile is the one place in
              the product that was already half-right: upload has been Uplink
              Cyan here all along while the speedtest dialog and the AMBR chips
              painted it Carrier Violet. All three agree now. */}
          <span className={cn(VALUE_CLASS, "flex items-center gap-1")}>
            <MaterialSymbol
              name="arrow_circle_down"
              size={20}
              filled
              className="shrink-0 text-downlink-on-surface"
            />
            <TickingValue value={dataUsed?.accumulated_rx_bytes ?? 0}>
              {formatBytes(dataUsed?.accumulated_rx_bytes ?? 0)}
            </TickingValue>
          </span>
          <span className={cn(VALUE_CLASS, "flex items-center gap-1")}>
            <MaterialSymbol
              name="arrow_circle_up"
              size={20}
              filled
              className="shrink-0 text-uplink-on-surface"
            />
            <TickingValue value={dataUsed?.accumulated_tx_bytes ?? 0}>
              {formatBytes(dataUsed?.accumulated_tx_bytes ?? 0)}
            </TickingValue>
          </span>
        </PillRow>

        {/* ── Cell Distance: one row for both legs, each led by its identity
            Tag; one tip covers both timing-advance caveats. ──────────────── */}
        <PillRow
          label={
            <>
              <span className="truncate @max-sm/card:hidden">
                {t("metrics.cell_distance")}
              </span>
              <span className="hidden truncate @max-sm/card:inline">
                {t("metrics.cell_distance_short")}
              </span>
              <HintIcon label={t("metrics.cell_distance")}>
                <span className="block">
                  {!unreachable && lteData?.ta
                    ? t("metrics.lte_distance_tooltip", { ta: lteData.ta })
                    : t("metrics.ta_unavailable")}
                </span>
                <span className="mt-1 block">
                  {!unreachable && nrData?.ta
                    ? t("metrics.nr_distance_tooltip", { ta: nrData.ta })
                    : t("metrics.ta_unavailable")}
                </span>
              </HintIcon>
            </>
          }
        >
          <span className="inline-flex items-center gap-3 @max-sm/card:gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Tag variant="lte" className="py-0 @max-sm/card:px-1.5">
                LTE
              </Tag>
              <span className={VALUE_CLASS}>
                <TickingValue value={lteDistance}>{lteDistance}</TickingValue>
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Tag variant="nr" className="py-0 @max-sm/card:px-1.5">
                NR
              </Tag>
              <span className={VALUE_CLASS}>
                <TickingValue value={nrDistance}>{nrDistance}</TickingValue>
              </span>
            </span>
          </span>
        </PillRow>

        {/* ── Speed Test: one pinned tile, run control first. A run starting
            or finishing crossfades on `quick` and moves nothing. ─────────── */}
        <motion.div variants={staggerRowItem} className="mt-auto">
          <div className={SPEEDTEST.TILE}>
            <div className="flex h-full items-center gap-8 @max-sm/card:gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-lg"
                    className="shrink-0"
                    aria-label={runControlLabel}
                    onClick={() => setSpeedtestOpen(true)}
                  >
                    <motion.span
                      key={isRunning ? "view" : "run"}
                      className="inline-flex"
                      initial={swapped ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: DUR.quick, ease: EASE_QUICK }}
                    >
                      <MaterialSymbol
                        name={isRunning ? "visibility" : "play_arrow"}
                        size={20}
                        filled
                      />
                    </motion.span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{runControlLabel}</TooltipContent>
              </Tooltip>

              <motion.div
                key={isRunning ? "running" : "idle"}
                className="min-w-0 flex-1"
                initial={swapped ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              >
                {isRunning ? (
                  <div className="flex flex-col justify-center gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex min-w-0 items-center gap-2 text-[13px]/5 font-semibold text-on-surface-variant">
                        <span aria-hidden className="relative inline-flex size-[7px] shrink-0">
                          <span className="absolute inset-0 rounded-pill bg-primary animate-live-ping" />
                          <span className="relative size-[7px] rounded-pill bg-primary" />
                        </span>
                        <span className="truncate">{runLabel}</span>
                      </span>
                      {/* No TickingValue: the 500ms run cadence would never let the tick finish. */}
                      <span className={FIGURE.VALUE}>
                        {reading ? reading.value : ABSENT}
                        {reading ? (
                          <span className={FIGURE.UNIT}>{t(reading.unitKey)}</span>
                        ) : null}
                      </span>
                    </div>
                    <span
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progressPct)}
                      aria-label={runLabel}
                      className="block"
                    >
                      <MetricBar
                        value={progressPct}
                        max={100}
                        warnAt={Number.POSITIVE_INFINITY}
                        dangerAt={Number.POSITIVE_INFINITY}
                        track="surface-container-high"
                      />
                    </span>
                  </div>
                ) : (
                  <div className={SPEEDTEST.FIGS}>
                    <SpeedFigure
                      glyph={DIRECTION.DOWN.ICON}
                      glyphClass={DIRECTION.DOWN.CLASS}
                      label={t("speedtest.result_download")}
                      value={cachedResult?.download.bandwidth ?? null}
                      text={cachedResult ? tileSpeed(cachedResult.download.bandwidth) : ""}
                      unit={t("speedtest.unit_mbps")}
                    />
                    <SpeedFigure
                      glyph={DIRECTION.UP.ICON}
                      glyphClass={DIRECTION.UP.CLASS}
                      label={t("speedtest.result_upload")}
                      value={cachedResult?.upload.bandwidth ?? null}
                      text={cachedResult ? tileSpeed(cachedResult.upload.bandwidth) : ""}
                      unit={t("speedtest.unit_mbps")}
                    />
                    <SpeedFigure
                      glyph="network_ping"
                      glyphClass="shrink-0 text-on-surface-variant"
                      label={t("speedtest.result_ping")}
                      value={cachedResult ? Math.round(cachedResult.ping.latency) : null}
                      text={cachedResult ? String(Math.round(cachedResult.ping.latency)) : ""}
                      unit={t("speedtest.unit_ms")}
                    />
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </TickGroup>
  );

  return (
    <>
      <Card className={CARD_SHELL}>
        {/* CardHeader with its own padding cancelled, because CARD_SHELL already
            carries px-6. Structurally identical to the loaded/skeleton titles in
            recent-activities.tsx and signal-status-card.tsx — this card has no
            CardAction today, but keeping the header slot means the grid column
            for one is already reserved, and a reviewer diffing the dashboard
            cards does not find this one built differently for no reason. */}
        <CardHeader className="px-0">
          <CardTitle className={cn(CARD_TITLE, "tabular-nums")}>
            {t("metrics.title")}
          </CardTitle>
          {/* An explicit ink class because the primitive hardcodes a retired
              one. Not skeletoned: both lines are constants and neither was ever
              unknown, so a placeholder here would withhold the one thing that
              could orient a reader while the rows fill in. */}
          <CardDescription className={CARD_DESC}>
            {t("metrics.description")}
          </CardDescription>
        </CardHeader>

        {/* Recipe 11's overlay construction: the skeleton fades out ON TOP of the
            real content rather than beside it, so the real body owns the card's
            height from its first frame and the crossfade contributes zero layout
            shift. Pure opacity, no movement. */}
        <div className="relative flex flex-1 flex-col">
          <div className={cn("flex flex-1 flex-col", handoff && "ca-content-in")}>
            {body}
          </div>
          {handoff && (
            <div
              aria-hidden
              className="ca-skeleton-out pointer-events-none absolute inset-0 [&>*]:h-full"
            >
              <MetricsSkeleton />
            </div>
          )}
        </div>
      </Card>
      <SpeedtestDialog open={speedtestOpen} onOpenChange={setSpeedtestOpen} />
    </>
  );
};

export default DeviceMetricsComponent;

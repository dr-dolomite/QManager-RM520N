"use client";

import React, { useCallback, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
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

import type { DeviceStatus, LteStatus, NrStatus } from "@/types/modem-status";
import {
  formatBytes,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
import { useUnitPreferences } from "@/hooks/use-system-settings";
import { useDataUsed } from "@/hooks/use-data-used";
import { useModemSubsys } from "@/hooks/use-modem-subsys";
import { DUR, staggerRows, staggerRowItem } from "@/lib/motion";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  isLoading: boolean;
}

// --- Warning thresholds ---
const TEMP_WARN = 60; // °C
const TEMP_DANGER = 75; // °C
const CPU_WARN = 70; // percentage
const CPU_DANGER = 90; // percentage

/** Card shell, identical to its two grid siblings so the row reads as one
 *  object. No fixed height: the dashboard grid stretches all three via
 *  `h-full *:data-[slot=card]:h-full`, which requires the Card to stay the
 *  DIRECT child of its wrapper — hence the skeleton overlay lives inside the
 *  card rather than around it. */
const CARD_SHELL =
  // gap-4, not the mock's literal 14px. This is the gap between the card's
  // title and its body, and it is the one measurement that reads ACROSS the
  // three cards sharing this grid row — recent-activities.tsx already ships
  // gap-4, so 14px here would set this card 2px out of step with the card
  // beside it to gain fidelity nobody can see. The 14px inner rhythm between
  // metric groups is kept below, where the mock's value is doing real work.
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

/** Meter track height, shared by the loaded bar and its skeleton slot so the
 *  handoff moves nothing. Mirrors `MetricBar size="md"`. */
const METER_H = "h-2";

/**
 * Recipe 12, the focus ring, for the two bare tooltip triggers (the reset
 * control is a `Button`, which already carries the project ring).
 *
 * `focus-visible:transition-shadow` rather than a base `transition-shadow` is
 * the guide's "focus is never animated AWAY" clause spelled in CSS: a
 * transition is read off the state being moved TO, so on blur the element
 * reverts to a base with no transition and the ring simply stops existing.
 */
const FOCUS_RING =
  "rounded-pill outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:transition-shadow focus-visible:duration-(--duration-quick) focus-visible:ease-quick";

/** One meter group: a label/value row over an 8px track. */
function MeterRow({
  label,
  children,
  bar,
}: {
  label: string;
  /** The value cell — already wrapped in its own `TickingValue`. */
  children: React.ReactNode;
  /** `null` when the datum is absent; the slot still reserves its height. */
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
      {/* An absent bar leaves its track height behind rather than collapsing
          the group, so a modem that reports no temperature does not shorten
          the card — and does not desync it from the skeleton above. */}
      {bar ?? <div className={METER_H} aria-hidden />}
    </motion.div>
  );
}

/** One pill row: label left, machine-voice value right, on a tonal container. */
function PillRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={staggerRowItem}
      className="flex items-center justify-between gap-3 rounded-pill bg-surface-container px-4 py-2.5"
    >
      {/* Container-Pair Rule: text on `surface-container` takes that
          container's own ink, never a solid role colour. */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-on-surface-variant">
        {label}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </motion.div>
  );
}

const VALUE_CLASS = "text-sm font-semibold text-on-surface";

/**
 * Skeleton (Skeleton-Mirror Rule): four meter groups and three pills, i.e. the
 * exact seven-row geometry of the loaded body at the exact same heights.
 *
 * It used to draw TEN generic rows for a body of seven, so the card lost height
 * the instant data landed and dragged its grid siblings with it.
 */
function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className={cn(METER_H, "w-full rounded-pill")} />
        </div>
      ))}
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-pill" />
      ))}
    </div>
  );
}

const DeviceMetricsComponent = ({
  deviceData,
  lteData,
  nrData,
  isLoading,
}: DeviceMetricsComponentProps) => {
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");
  const unitPrefs = useUnitPreferences();
  const temp = deviceData?.temperature ?? null;
  const cpu = deviceData?.cpu_usage ?? null;
  const memUsed = deviceData?.memory_used_mb ?? 0;
  const memTotal = deviceData?.memory_total_mb ?? 0;

  const isTempHigh = temp !== null && temp >= TEMP_WARN;
  const isCpuHigh = cpu !== null && cpu >= CPU_WARN;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  // Persistent data-usage counter — polled independently at 2 s cadence
  const { data: dataUsed, isResetting, resetCounter } = useDataUsed();

  // /usrdata partition usage — sourced from the poller cache via modem-subsys
  const { data: subsysData } = useModemSubsys();
  const storageTotalKb = subsysData?.storage?.total_kb ?? 0;
  const storageUsedKb = subsysData?.storage?.used_kb ?? 0;
  const storagePct =
    storageTotalKb > 0 ? (storageUsedKb / storageTotalKb) * 100 : 0;

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

  const tempValue = formatTemperature(temp, unitPrefs?.tempUnit);
  const cpuValue = cpu !== null ? `${cpu}%` : "-";
  const memValue = memTotal > 0 ? `${memUsed} MB / ${memTotal} MB` : "-";
  const storageValue =
    storageTotalKb > 0
      ? `${formatBytes(storageUsedKb * 1024)} / ${formatBytes(storageTotalKb * 1024)}`
      : "-";
  const lteDistance = formatDistance(
    calculateLteDistance(lteData?.ta ?? null),
    unitPrefs?.distanceUnit,
  );
  const nrDistance = formatDistance(
    calculateNrDistance(nrData?.ta ?? null),
    unitPrefs?.distanceUnit,
  );

  const body = isLoading ? (
    <MetricsSkeleton />
  ) : (
    // One tick cascade for the whole body, and the card's reading order is
    // already the cascade order: the four meters top-to-bottom, then the Data
    // Used pill whose rx/tx pair sits side by side and so reads left-to-right,
    // then the two distance rows. `TickGroup` sorts the live DOM nodes rather
    // than a declared index, so it needs no axis flag to switch between the
    // two — and rows that hold their value this poll never enter the ranking,
    // which is why one group over eight figures cannot run long.
    //
    // Wrapping the `motion.div` from outside is deliberate but also safe from
    // inside: `TickGroup` publishes its own React context and never touches
    // `MotionContext`, and motion/react resolves a child's parent through
    // `useContext(MotionContext)`, so an intervening plain provider is
    // transparent to `staggerRows` -> `staggerRowItem` propagation.
    <TickGroup>
      <motion.div
        className="flex flex-col gap-3.5"
        variants={staggerRows}
        initial="hidden"
        animate="visible"
      >
        {/* ── Modem Temperature ─────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.modem_temperature")}
          bar={
            temp !== null ? (
              <MetricBar
                value={temp}
                max={100}
                warnAt={TEMP_WARN}
                dangerAt={TEMP_DANGER}
                // A cool modem is good news, not merely not-yet-bad — so the
                // meter reads green below the warn line and still escalates to
                // amber and red above it.
                baseTone="success"
                size="md"
                track="surface-container-high"
                index={0}
              />
            ) : null
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
            cpu !== null ? (
              <MetricBar
                value={cpu}
                max={100}
                warnAt={CPU_WARN}
                dangerAt={CPU_DANGER}
                size="md"
                track="surface-container-high"
                index={1}
              />
            ) : null
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
            memTotal > 0 ? (
              <MetricBar
                value={memPct}
                max={100}
                warnAt={70}
                dangerAt={90}
                size="md"
                track="surface-container-high"
                index={2}
              />
            ) : null
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={memUsed}>{memValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── Storage (/usrdata partition) ──────────────────────────────── */}
        <MeterRow
          label={t("metrics.storage_label")}
          bar={
            storageTotalKb > 0 ? (
              <MetricBar
                value={storagePct}
                max={100}
                warnAt={80}
                dangerAt={95}
                size="md"
                track="surface-container-high"
                index={3}
              />
            ) : null
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={storageUsedKb}>{storageValue}</TickingValue>
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
                    className="size-5 rounded-pill text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
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

        {/* ── LTE Cell Distance ─────────────────────────────────────────── */}
        <PillRow
          label={
            <>
              <span className="truncate">{t("metrics.lte_cell_distance")}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn("inline-flex shrink-0", FOCUS_RING)}
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <MaterialSymbol name="info" size={16} filled />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {lteData?.ta ? (
                    <p>{t("metrics.lte_distance_tooltip", { ta: lteData.ta })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </>
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={lteDistance}>{lteDistance}</TickingValue>
          </span>
        </PillRow>

        {/* ── NR Cell Distance ──────────────────────────────────────────── */}
        <PillRow
          label={
            <>
              <span className="truncate">{t("metrics.nr_cell_distance")}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn("inline-flex shrink-0", FOCUS_RING)}
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <MaterialSymbol name="info" size={16} filled />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {nrData?.ta ? (
                    <p>{t("metrics.nr_distance_tooltip", { ta: nrData.ta })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </>
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={nrDistance}>{nrDistance}</TickingValue>
          </span>
        </PillRow>
      </motion.div>
    </TickGroup>
  );

  return (
    <Card className={CARD_SHELL}>
      {/* CardHeader with its own padding cancelled, because CARD_SHELL already
          carries px-6. Structurally identical to the loaded/skeleton titles in
          recent-activities.tsx and signal-status-card.tsx — this card has no
          CardAction today, but keeping the header slot means the grid column
          for one is already reserved, and a reviewer diffing the dashboard
          cards does not find this one built differently for no reason. */}
      <CardHeader className="px-0">
        <CardTitle className="text-lg font-semibold tabular-nums">
          {t("metrics.title")}
        </CardTitle>
      </CardHeader>

      {/* Recipe 11's overlay construction: the skeleton fades out ON TOP of the
          real content rather than beside it, so the real body owns the card's
          height from its first frame and the crossfade contributes zero layout
          shift. Pure opacity, no movement. */}
      <div className="relative">
        <div className={cn(handoff && "ca-content-in")}>{body}</div>
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
  );
};

export default DeviceMetricsComponent;

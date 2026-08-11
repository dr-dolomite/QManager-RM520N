"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { transitionMeterFill, transitionStandard } from "@/lib/motion";
import {
  getSignalQuality,
  signalToProgress,
  type SignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";
import type { PublicOverviewBand } from "@/types/public-overview";

import {
  BAND_METRICS,
  BAND_METRIC_THRESHOLDS,
  isNrBand,
  minusSign,
  qualityTone,
  TONE_CLASSES,
  type BandMetric,
  type TranslateFn,
} from "./tone";

// The row geometry, shared with the skeleton so the handoff is a pure crossfade
// with zero layout shift (Motion Guide recipe 03).
const CHIP_W = "w-[2.625rem]"; // 42px
const METER_H = "h-[0.4375rem]"; // 7px
const VALUE_W = "w-[4.125rem]"; // 66px
export const ROW_GAP = "gap-[0.6875rem]"; // 11px
export const ROW_STACK_GAP = "gap-[0.5625rem]"; // 9px
export const BAND_ROW_SHAPE = { CHIP_W, METER_H, VALUE_W } as const;

// =============================================================================
// SegmentedMetricToggle
// =============================================================================
// Motion Guide recipe 09/02: the active pill TRAVELS. One motion.span rendered
// inside whichever segment is active, sharing a layoutId, so motion tweens the
// box between positions instead of cross-fading two fills. The layoutId is
// instance-scoped via `useId`, and the `settled` guard is what stops the pill
// sliding in from nowhere on first paint.
// =============================================================================

export function SegmentedMetricToggle({
  value,
  onChange,
  t,
}: {
  value: BandMetric;
  onChange: (metric: BandMetric) => void;
  t: TranslateFn;
}) {
  const instanceId = useId();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role="group"
      aria-label={t("overview.metrics.toggle_aria")}
      className="bg-surface-container flex flex-none gap-[0.1875rem] rounded-pill p-[0.1875rem]"
    >
      {BAND_METRICS.map((metric) => {
        const active = metric === value;
        return (
          <button
            key={metric}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(metric)}
            className={cn(
              // 11px, not the comp's 10px — same floor as EYEBROW_CLASS.
              "relative rounded-pill px-[0.6875rem] py-[0.3125rem] text-[0.6875rem] font-semibold tracking-[0.06em] uppercase",
              "transition-colors duration-[var(--duration-quick)] ease-out",
              "focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none",
              active ? "text-primary-foreground" : "text-on-surface-variant",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${instanceId}-metric-pill`}
                className="bg-primary absolute inset-0 rounded-pill"
                transition={settled ? transitionStandard : { duration: 0 }}
                aria-hidden="true"
              />
            )}
            {/* Inactive labels read by role pair — `on-surface-variant` vs the
                primary fill's own ink — not by opacity. Container-Pair Rule. */}
            <span className="relative">{t(`overview.metrics.${metric}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Meter
// =============================================================================
// Recipe 07: scaleX from 0 on FIRST PAINT ONLY, 40ms apart. A poll-driven
// retarget settles on the everyday curve — never a re-grow from zero, and never
// an animated `width`.

const STAGGER_SECONDS = 0.04;

function QualityMeter({
  percent,
  barClass,
  entranceIndex,
}: {
  percent: number;
  barClass: string;
  /** Stagger slot for the first-paint fill, or null once the card is painted. */
  entranceIndex: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const firstPaint = entranceIndex != null && !reduceMotion;

  return (
    <div
      className={cn(
        "bg-surface-container-high min-w-0 flex-1 overflow-hidden rounded-pill",
        METER_H,
      )}
    >
      <motion.div
        className={cn(
          "h-full origin-left rounded-pill",
          "transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
          barClass,
        )}
        initial={firstPaint ? { scaleX: 0 } : false}
        animate={{ scaleX: percent / 100 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : firstPaint
              ? { ...transitionMeterFill, delay: entranceIndex * STAGGER_SECONDS }
              : transitionStandard
        }
      />
    </div>
  );
}

// =============================================================================
// BandRow
// =============================================================================

export function BandRow({
  band,
  reachable,
  metric,
  t,
  entranceIndex,
}: {
  band: PublicOverviewBand;
  reachable: boolean;
  metric: BandMetric;
  t: TranslateFn;
  entranceIndex: number | null;
}) {
  const value = metric === "rsrp" ? band.rsrp : band.sinr;
  const thresholds = BAND_METRIC_THRESHOLDS[metric];
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const percent = reachable ? signalToProgress(value, thresholds) : 0;
  const { text: textClass, bar: barClass } =
    TONE_CLASSES[qualityTone(quality, reachable)];

  return (
    <div className={cn("flex items-center", ROW_GAP)}>
      {/* IDENTITY chip — which radio this carrier is, never how healthy it is. */}
      <span
        className={cn(
          "flex-none rounded-pill py-1 text-center font-mono text-[0.6875rem] font-semibold",
          CHIP_W,
          isNrBand(band.band)
            ? "bg-primary-container text-on-primary-container"
            : "bg-lte-container text-on-lte-container",
        )}
      >
        {band.band}
      </span>
      <QualityMeter
        percent={percent}
        barClass={barClass}
        entranceIndex={entranceIndex}
      />
      {/* QUALITY value — tinted by this carrier's own reading, not the aggregate. */}
      <span
        className={cn(
          "flex-none text-right text-xs font-semibold tabular-nums",
          "transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
          VALUE_W,
          textClass,
        )}
      >
        {value != null
          ? t(`overview.metrics.${metric}_value`, {
              [metric]: minusSign(value),
            })
          : t("overview.field.empty")}
      </span>
    </div>
  );
}

/**
 * Aggregate fallback row — shown when the poller reports no carrier components
 * (e.g. an attach in progress), so the selected metric is never simply dropped.
 * Same anatomy, with a neutral metric label where the identity chip sits: there
 * is no single radio to name here, so the slot must not claim one.
 */
export function AggregateBandRow({
  label,
  value,
  unit,
  thresholds,
  reachable,
  entranceIndex,
}: {
  label: string;
  value: number | null;
  unit: string;
  thresholds: SignalThresholds;
  reachable: boolean;
  entranceIndex: number | null;
}) {
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const percent = reachable ? signalToProgress(value, thresholds) : 0;
  const { text: textClass, bar: barClass } =
    TONE_CLASSES[qualityTone(quality, reachable)];

  return (
    <div className={cn("flex items-center", ROW_GAP)}>
      <span
        className={cn(
          "bg-surface-container-high text-on-surface-variant flex-none rounded-pill py-1 text-center font-mono text-[0.6875rem] font-semibold",
          CHIP_W,
        )}
      >
        {label}
      </span>
      <QualityMeter
        percent={percent}
        barClass={barClass}
        entranceIndex={entranceIndex}
      />
      <span
        className={cn(
          "flex-none text-right text-xs font-semibold tabular-nums",
          VALUE_W,
          textClass,
        )}
      >
        {value != null ? `${minusSign(value)} ${unit}` : "—"}
      </span>
    </div>
  );
}

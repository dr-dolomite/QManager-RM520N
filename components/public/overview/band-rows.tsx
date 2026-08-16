"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { transitionMeterFill, transitionStandard } from "@/lib/motion";
import {
  getSignalQuality,
  normalizeMetricValue,
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
  qualityBarClass,
  qualityValueClass,
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
  /**
   * Fill length, or `null` for "no reading" — which renders the TRACK ALONE,
   * with no fill element at all. Not the same as `0`: a zero-length ramp-tinted
   * bar says "we measured something terrible", and this state is "we measured
   * nothing" (DESIGN.md > Quality bars). Arrives paired with a `null`
   * `barClass`, because it is the same absence seen from the colour side.
   */
  percent: number | null;
  barClass: string | null;
  /** Stagger slot for the first-paint fill, or null once the card is painted. */
  entranceIndex: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const firstPaint = entranceIndex != null && !reduceMotion;
  const hasReading = percent != null && barClass != null;

  return (
    <div
      className={cn(
        "bg-surface-container-high min-w-0 flex-1 overflow-hidden rounded-pill",
        METER_H,
      )}
    >
      {hasReading && (
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
                ? {
                    ...transitionMeterFill,
                    delay: entranceIndex * STAGGER_SECONDS,
                  }
                : transitionStandard
          }
        />
      )}
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
  // `overview.sh:48` forwards `carrier_components[].sinr` verbatim, which on an
  // LTE carrier is AT+QCAINFO's RAW RSSNR field — 251 where the real SINR is
  // 8 dB. `getSignalQuality()` now refuses to rate that, but the printed number
  // and the meter read `value` directly, so the boundary has to be here too or
  // the splash keeps showing the lie in two of its three channels.
  const value = normalizeMetricValue(
    metric === "rsrp" ? band.rsrp : band.sinr,
    metric,
  );
  const thresholds = BAND_METRIC_THRESHOLDS[metric];
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const textClass = qualityValueClass(quality, reachable);
  // Colour and length are decided ONCE, together: the bar is drawn exactly when
  // the ramp has a stop to draw it in. Deriving the percentage independently is
  // how an unread carrier ends up with a zero-length tinted fill.
  const barClass = qualityBarClass(quality, reachable);
  const percent = barClass != null ? signalToProgress(value, thresholds) : null;

  return (
    <div className={cn("flex items-center", ROW_GAP)}>
      {/* IDENTITY tag — which radio this carrier is, never how healthy it is.
          The Two-Form Rule: identity is ink and outline, never a large tinted
          container block, so this is a `Tag` and not a filled `Badge`. The
          11px step is the pre-auth scale's eyebrow and does not travel to the
          app scale — it must survive the merge with `Tag`'s own `text-xs`. */}
      <Tag
        variant={isNrBand(band.band) ? "nr" : "lte"}
        className={cn(
          "flex-none rounded-pill px-0 py-1 font-mono text-[0.6875rem] font-semibold",
          CHIP_W,
        )}
      >
        {band.band}
      </Tag>
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
        {/* Adjacent ramp stops sit deliberately BELOW the 0.05 CVD separation
            floor — bar length is what tells them apart, and length is not a
            channel a screen reader has. The word is the ramp's non-visual half,
            so a tinted figure without it is a bug, not a nicety. Only rendered
            where the tint is a ramp stop: an untinted "—" has no verdict to
            announce. */}
        {barClass != null && (
          <span className="sr-only"> {t(`overview.quality.${quality}`)}</span>
        )}
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
  t,
}: {
  label: string;
  value: number | null;
  unit: string;
  thresholds: SignalThresholds;
  reachable: boolean;
  entranceIndex: number | null;
  t: TranslateFn;
}) {
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const textClass = qualityValueClass(quality, reachable);
  const barClass = qualityBarClass(quality, reachable);
  const percent = barClass != null ? signalToProgress(value, thresholds) : null;

  return (
    <div className={cn("flex items-center", ROW_GAP)}>
      {/* `neutral`, not a filled chip: this sits in the SAME slot as the
          per-band identity tags above it, and once those became outlines a
          lone filled pill in the column read as a different kind of thing
          rather than as the aggregate of the same thing. It is metadata with
          no honest hue, which is exactly what the neutral tag is for. */}
      <Tag
        variant="neutral"
        className={cn(
          "flex-none px-0 py-1 text-center font-mono text-[0.6875rem] font-semibold",
          CHIP_W,
        )}
      >
        {label}
      </Tag>
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
        {barClass != null && (
          <span className="sr-only"> {t(`overview.quality.${quality}`)}</span>
        )}
      </span>
    </div>
  );
}

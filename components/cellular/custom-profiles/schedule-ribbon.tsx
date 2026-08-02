"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { motion, type Variants } from "motion/react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { DUR, EASE_EMPHASIZED, staggerRows } from "@/lib/motion";
import {
  buildDayTimeline,
  formatMinute,
  type TimelineSegment,
} from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";
import type { ConnectionScenario } from "@/types/connection-scenario";
import type { ScenarioSchedule } from "@/types/sim-profile";

import { resolveScenarioIcon } from "./connection-scenarios/scenario-icons";
import {
  MACHINE_VALUE,
  RIBBON_MINI,
  RIBBON_SEGMENT_IDLE,
  RIBBON_SEGMENT_LIVE,
  RIBBON_SHAPE,
} from "./shapes";

// =============================================================================
// The 24-hour schedule ribbon
// =============================================================================
// Two renderings of one dataset. `ScheduleRibbon` is the hero's labelled strip
// — glyph, scenario name, window, a needle at the current minute and an axis.
// `ScheduleMiniBar` is the 8px band a profile ROW carries: same segments, same
// proportions, no labels, no needle, no motion. The mini bar is a GLYPH for
// "this profile has a schedule and here is its shape", not a readable timeline,
// which is why it deliberately animates nothing.
//
// Both take `TimelineSegment[]` from `lib/schedule-timeline.ts` rather than a
// schedule, so neither can re-derive a block boundary its sibling disagrees
// with.
//
// MOTION. Segments arrive by `scaleX` from a left origin, never by `width`
// (`RIBBON_SHAPE.SEGMENT` carries the `origin-left`). A width animation is a
// per-frame layout pass on a CPU that is simultaneously carrying the user's
// traffic; the aggregation strip is the single sanctioned exception in the
// product and this is not it. The container declares no `initial`/`animate`,
// so it inherits `visible` from the hero's cascade — a nested container that
// declared its own would restart the sequence and desynchronise the card.
//
// ACCESSIBILITY. The strip is `role="img"` with an `aria-label` that says the
// schedule in words, and every segment is `aria-hidden`. A proportional band of
// colour is not information a screen reader can recover, and a sighted-only
// timeline is not an acceptable answer on a page whose whole subject is "what
// is my modem going to do at 18:00".
// =============================================================================

const MINUTES_PER_DAY = 24 * 60;

/**
 * Below this share of the day a segment cannot hold its label without the text
 * colliding with its own glyph, so it collapses to the glyph alone. The test is
 * on `flexBasis` — the segment's share of 1440 minutes — and NOT on a measured
 * DOM width: measuring would need a layout read on every resize, and the answer
 * would differ between the hero and a narrower future host for the same
 * schedule. A proportion is stable and needs no ref.
 */
const TIGHT_SEGMENT_RATIO = 0.08;

/**
 * The segment entrance. `staggerRows` (80ms) is the container step because
 * these are rows sharing one card, not cards on a page — and `emphasized` is
 * the duration because a band growing to full width is the longest journey
 * anything on this card makes. Transform + opacity only, so the global
 * `reducedMotion="user"` switch collapses it without a second definition here.
 */
const segmentVariants: Variants = {
  hidden: { opacity: 0, scaleX: 0 },
  visible: {
    opacity: 1,
    scaleX: 1,
    transition: { duration: DUR.emphasized, ease: EASE_EMPHASIZED },
  },
};

function scenarioName(
  scenarios: ConnectionScenario[],
  id: string,
  fallback: string,
): string {
  return scenarios.find((s) => s.id === id)?.name ?? fallback;
}

function scenarioGlyph(scenarios: ConnectionScenario[], id: string) {
  return resolveScenarioIcon(scenarios.find((s) => s.id === id)?.icon);
}

export interface ScheduleRibbonProps {
  /** The full day, from `buildDayTimeline`. Always totals 1440 minutes. */
  segments: TimelineSegment[];
  /** Where the needle sits, 0..100. */
  nowPercent: number;
  /** The needle's readout, already formatted ("13:42"). */
  nowLabel: string;
  /** Every known scenario, for name + glyph resolution. */
  scenarios: ConnectionScenario[];
  /** Renders the header's "Edit schedule" affordance when supplied. */
  onEditSchedule?: () => void;
}

export function ScheduleRibbon({
  segments,
  nowPercent,
  nowLabel,
  scenarios,
  onEditSchedule,
}: ScheduleRibbonProps) {
  const { t } = useTranslation("cellular");

  const unknownName = t("custom_profiles.hero.ribbon.unknown_scenario");

  // The spoken form of the strip: "Night Idle until 07:00, then Balanced until
  // 18:00, …". Built from the same segments the bands are drawn from, so the
  // two can never describe different days.
  const ariaLabel = React.useMemo(() => {
    if (segments.length === 0) {
      return t("custom_profiles.hero.ribbon.aria_empty");
    }
    const spoken = segments
      .map((seg) =>
        t("custom_profiles.hero.ribbon.aria_segment", {
          name: scenarioName(scenarios, seg.scenarioId, unknownName),
          end: formatMinute(seg.endMinute),
        }),
      )
      .join(t("custom_profiles.hero.ribbon.aria_join"));
    return t("custom_profiles.hero.ribbon.aria_label", { schedule: spoken });
  }, [segments, scenarios, unknownName, t]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-on-surface-variant min-w-0 truncate text-xs font-medium">
          {t("custom_profiles.hero.ribbon.title")}
        </span>
        {onEditSchedule ? (
          <button
            type="button"
            onClick={onEditSchedule}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring/50 inline-flex flex-none items-center gap-1.5 rounded-pill text-xs transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <MaterialSymbol name="edit_calendar" size={15} />
            {t("custom_profiles.hero.ribbon.edit")}
          </button>
        ) : null}
      </div>

      <motion.div
        role="img"
        aria-label={ariaLabel}
        variants={staggerRows}
        className={RIBBON_SHAPE.ROOT}
      >
        {segments.map((seg) => {
          const tight = seg.flexBasis / MINUTES_PER_DAY < TIGHT_SEGMENT_RATIO;
          const name = scenarioName(scenarios, seg.scenarioId, unknownName);
          return (
            <motion.div
              key={`${seg.startMinute}-${seg.scenarioId}`}
              aria-hidden="true"
              variants={segmentVariants}
              style={{ flexGrow: seg.flexBasis, flexBasis: 0, minWidth: 0 }}
              className={cn(
                tight ? RIBBON_SHAPE.SEGMENT_TIGHT : RIBBON_SHAPE.SEGMENT,
                seg.isLive ? RIBBON_SEGMENT_LIVE : RIBBON_SEGMENT_IDLE,
              )}
            >
              <MaterialSymbol
                name={scenarioGlyph(scenarios, seg.scenarioId)}
                size={17}
                filled={seg.isLive}
                className="flex-none"
              />
              {tight ? null : (
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "truncate text-xs",
                      seg.isLive ? "font-semibold" : "font-medium",
                    )}
                  >
                    {name}
                  </span>
                  <span
                    className={cn(
                      MACHINE_VALUE,
                      "truncate text-[0.6875rem] opacity-90",
                    )}
                  >
                    {formatMinute(seg.startMinute)}–{formatMinute(seg.endMinute)}
                  </span>
                </span>
              )}
            </motion.div>
          );
        })}

        <span
          aria-hidden="true"
          className={RIBBON_SHAPE.NEEDLE}
          style={{ left: `${nowPercent}%` }}
        />
        <span
          aria-hidden="true"
          className={cn(RIBBON_SHAPE.NEEDLE_LABEL, MACHINE_VALUE)}
          style={{ left: `${nowPercent}%` }}
        >
          {nowLabel}
        </span>
      </motion.div>

      <div aria-hidden="true" className={cn(RIBBON_SHAPE.AXIS, MACHINE_VALUE)}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

export interface ScheduleMiniBarProps {
  schedule: ScenarioSchedule;
  /** The binding's `default` — fills every minute no block covers. */
  fallbackScenarioId: string;
  now: Date;
  className?: string;
}

/**
 * The 8px condensed strip a profile row carries. No labels, no needle, no
 * animation — it is a shape, and a row list of ten of these all breathing at
 * once would be noise rather than choreography. It stays `aria-hidden` because
 * the row's own text line already states the schedule in words; announcing the
 * same fact twice is worse than not announcing the band at all.
 *
 * WHY THIS TAKES A SCHEDULE WHERE `ScheduleRibbon` TAKES SEGMENTS. The hero
 * needs `nowPercent` and the next-change answer out of the same
 * `buildDayTimeline` call it draws from, so passing it pre-built segments keeps
 * one call serving three consumers. A row needs nothing but the band, and every
 * row would otherwise repeat the identical three-line derivation at its own
 * call site — which is exactly how two callers end up disagreeing about where a
 * block starts. The derivation lives here instead, so the row cannot get it
 * wrong and the hero cannot pay for it twice.
 */
export function ScheduleMiniBar({
  schedule,
  fallbackScenarioId,
  now,
  className,
}: ScheduleMiniBarProps) {
  const { segments } = buildDayTimeline(schedule, fallbackScenarioId, now);

  return (
    <div aria-hidden="true" className={cn(RIBBON_MINI.ROOT, className)}>
      {segments.map((seg) => (
        <span
          key={`${seg.startMinute}-${seg.scenarioId}`}
          style={{ flexGrow: seg.flexBasis, flexBasis: 0, minWidth: 0 }}
          className={cn(
            RIBBON_MINI.SEGMENT,
            seg.isLive ? RIBBON_MINI.LIVE : RIBBON_MINI.IDLE,
          )}
        />
      ))}
    </div>
  );
}

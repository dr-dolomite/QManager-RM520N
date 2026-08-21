"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { motion, type Variants } from "motion/react";

import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_EMPHASIZED, staggerRows } from "@/lib/motion";
import {
  buildDayTimeline,
  formatMinute,
  nextScenarioChange,
  type TimelineSegment,
} from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";
import type { ConnectionScenario } from "@/types/connection-scenario";
import type { ScenarioSchedule, SimProfile } from "@/types/sim-profile";

import { resolveScenarioIcon } from "./connection-scenarios/scenario-icons";
import {
  LIVE_DOT,
  PILL_ACTION_SM,
  PROFILE_CARD_PEER,
  PROFILE_PAD,
  RIBBON_MINI,
  RIBBON_SEGMENT_IDLE,
  RIBBON_SEGMENT_LIVE,
  RIBBON_SHAPE,
  TODAY_ARMED,
  TODAY_ARMED_OFF,
  TODAY_ARMED_ON,
  TODAY_HEAD,
  TODAY_SUMMARY,
  TODAY_SUMMARY_JOIN,
  TODAY_SUMMARY_NAME,
  TODAY_SUMMARY_TIME,
} from "./shapes";

// =============================================================================
// The Today strip — the 24-hour schedule as its own card
// =============================================================================
// Three renderings of one dataset.
//
//   `ScheduleTodayCard` — the PEER card that now sits directly under the hero:
//                         a summary sentence, an armed readout, the full-width
//                         ribbon and its axis.
//   `ScheduleRibbon`    — the track itself.
//   `ScheduleMiniBar`   — the 8px band a profile ROW carries: same segments,
//                         same proportions, no labels, no needle, no motion.
//
// All three take their geometry from `shapes.ts` and their data from
// `lib/schedule-timeline.ts`, so none of them can re-derive a block boundary
// its siblings disagree with.
//
// -----------------------------------------------------------------------------
// WHY THE STRIP LEFT THE HERO
// -----------------------------------------------------------------------------
// It used to be a band inside the hero card, sharing ~400px with three tiles
// and two buttons. At that width a 20-minute block is about eight pixels: a
// proportional graphic with no room to be proportional, under a floating time
// pill that covered the segment it was pointing at. Given the page's full
// width it finally answers the question the old layout never did — WHAT IS THE
// SHAPE OF TODAY — and DESIGN.md already sanctions the full-width proportional
// strip as a signature surface.
//
// It is a PEER card (`PROFILE_CARD_PEER`, 36px), NOT a second hero. A surface
// gets one anchor and the hero has it; `rounded-hero` is spent once per page.
//
// -----------------------------------------------------------------------------
// WHAT CHANGED IN THE TRACK
// -----------------------------------------------------------------------------
// ONE TRACK, GAPPED SEGMENTS. The track is a single `surface-container` pill
// with `overflow-hidden`; the segments sit inside it separated by a 3px gap
// through which the track shows. That gap is what separates two adjacent idle
// blocks, so the segments carry no radius of their own, no second tonal step
// and no hairline. Idle blocks do NOT alternate between two tonal steps — an
// alternating strip reads as data ("these two differ") when the only thing that
// differs is their position.
//
// THE LIVE SEGMENT IS THE ONE COLOURED OBJECT. `RIBBON_SEGMENT_LIVE` is now the
// strong FILL (`bg-primary`), up from the previous `primary-container`: at 52px
// against a neutral track the container pair was too quiet to find at a glance.
// Primary here does not describe the scenario — a scenario has no honest hue —
// it marks which block is running.
//
// THE NEEDLE LOST ITS LABEL. A floating pill reading "13:42" over a 52px track
// covered the segment it pointed at, and the head's summary sentence now says
// the time in words anyway. The needle keeps its cap dot and is hosted OUTSIDE
// the track, because the track's `overflow-hidden` (which is what clips the
// segments to the pill) would otherwise eat the needle's deliberate bleed.
//
// MOTION. Segments arrive by `scaleX` from a left origin, never by `width`
// (`RIBBON_SHAPE.SEGMENT` carries the `origin-left`). A width animation is a
// per-frame layout pass on a CPU that is simultaneously carrying the user's
// traffic.
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
 * would differ between hosts for the same schedule. A proportion is stable and
 * needs no ref.
 */
const TIGHT_SEGMENT_RATIO = 0.08;

/** The axis ticks, every three hours. Rendered `justify-between` under the track. */
const AXIS_TICKS = ["00", "03", "06", "09", "12", "15", "18", "21", "24"];

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

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

export interface ScheduleTodayCardProps {
  /** The profile in force. The card renders nothing without one. */
  profile: SimProfile;
  /** Every known scenario, for name + glyph resolution. */
  scenarios: ConnectionScenario[];
  /** One clock for the whole page, so needle and sentence cannot disagree. */
  now: Date;
  /** Renders the "Edit schedule" affordance when supplied. */
  onEditSchedule?: () => void;
}

/**
 * The Today strip.
 *
 * WHAT IT DOES WHEN THERE IS NO SCHEDULE. It still renders, and it still tells
 * the truth. `buildDayTimeline` falls back to the binding's `default` for every
 * minute no block covers, so an unscheduled profile produces exactly one
 * full-day segment — a legitimate, non-empty track showing one scenario running
 * from 00:00 to 24:00 — and the sentence above it reads "Balanced in force all
 * day" rather than naming a change that is not coming. The armed readout goes
 * to `TODAY_ARMED_OFF` and says so in WORDS as well as in ink, because a colour
 * difference alone is not a state.
 *
 * The card is omitted entirely only when no profile is active, which is the one
 * case where there is genuinely nothing true to say: the hero's empty state has
 * already reported that the modem is running whatever it was last configured
 * with by hand, and a schedule strip for a profile that is not running would be
 * a graphic about nothing.
 */
export function ScheduleTodayCard({
  profile,
  scenarios,
  now,
  onEditSchedule,
}: ScheduleTodayCardProps) {
  const { t } = useTranslation("cellular");

  const binding = profile.scenario;
  const schedule = binding.schedule;
  const armed = schedule.enabled && schedule.blocks.length > 0;

  const timeline = React.useMemo(
    () => buildDayTimeline(schedule, binding.default, now),
    [schedule, binding.default, now],
  );
  const nextChange = React.useMemo(
    () => nextScenarioChange(timeline.segments, timeline.nowMinute),
    [timeline],
  );

  const unknownName = t("custom_profiles.hero.ribbon.unknown_scenario");
  const liveSegment = timeline.segments.find((s) => s.isLive);
  const liveName = liveSegment
    ? scenarioName(scenarios, liveSegment.scenarioId, unknownName)
    : unknownName;
  const nextName = nextChange
    ? scenarioName(scenarios, nextChange.scenarioId, unknownName)
    : null;

  // ONE key per sentence, with placeholders — never five `t()` fragments
  // concatenated in source order, which is the construction that cannot survive
  // a language whose clause order differs from English. The TIME still gets its
  // own type treatment because the sentinel from `interpolation-slot` is sliced
  // back out AFTER i18next has interpolated, so the translator keeps full
  // control of word order and the figure keeps its weight.
  const summaryTail =
    nextChange && nextName
      ? withSlot(
          t("profiles.today.summary.until", {
            time: SLOT,
            next: nextName,
          }),
          <span className={TODAY_SUMMARY_TIME}>
            {formatMinute(nextChange.atMinute)}
          </span>,
        )
      : armed
        ? t("profiles.today.summary.rest_of_day")
        : t("profiles.today.summary.all_day");

  return (
    <Card className={PROFILE_CARD_PEER}>
      <CardHeader className={PROFILE_PAD}>
        <CardTitle className="text-xl">
          {t("custom_profiles.hero.ribbon.title")}
        </CardTitle>
        {onEditSchedule ? (
          <CardAction>
            <Button
              variant="ghost"
              className={PILL_ACTION_SM}
              onClick={onEditSchedule}
            >
              <MaterialSymbol name="edit_calendar" size={16} aria-hidden />
              {t("custom_profiles.hero.ribbon.edit")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className={cn(PROFILE_PAD, "flex flex-col gap-4")}>
        <div className={TODAY_HEAD}>
          <p className={TODAY_SUMMARY}>
            <span className={TODAY_SUMMARY_NAME}>{liveName}</span>
            <span className={TODAY_SUMMARY_JOIN}>{summaryTail}</span>
          </p>

          {/* INK layer on neutral ground, not a second filled chip: this is a
              small true statement about the schedule, and a chip here would put
              two competing status claims on one screen beside the hero's. */}
          <span
            className={cn(
              TODAY_ARMED,
              "ml-auto",
              armed ? TODAY_ARMED_ON : TODAY_ARMED_OFF,
            )}
          >
            <span className={LIVE_DOT.ROOT} aria-hidden>
              {/* The ping loops only while the schedule is actually armed. A
                  breathing dot beside "No schedule" would advertise work that
                  is not happening. */}
              {armed ? <span className={LIVE_DOT.RING} /> : null}
              <span className={LIVE_DOT.CORE} />
            </span>
            {armed
              ? t("profiles.today.armed")
              : t("profiles.today.not_armed")}
          </span>
        </div>

        <ScheduleRibbon
          segments={timeline.segments}
          nowPercent={timeline.nowPercent}
          scenarios={scenarios}
        />
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// The track
// -----------------------------------------------------------------------------

export interface ScheduleRibbonProps {
  /** The full day, from `buildDayTimeline`. Always totals 1440 minutes. */
  segments: TimelineSegment[];
  /** Where the needle sits, 0..100. */
  nowPercent: number;
  /** Every known scenario, for name + glyph resolution. */
  scenarios: ConnectionScenario[];
}

export function ScheduleRibbon({
  segments,
  nowPercent,
  scenarios,
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
    <div>
      {/* The needle's host. It has to sit OUTSIDE the track: the track's own
          `overflow-hidden` is what clips the segments to the pill, and it would
          equally clip the needle's `-top-1.5 -bottom-1.5` bleed and its cap. */}
      <div className="relative">
        {/* `initial`/`animate` are declared rather than inherited. This card is
            a sibling of the hero rather than a child of it, so there is no
            parent cascade to wait on — and a variants-only node whose parent
            was created in the same render pass never animates itself, which
            leaves every segment pinned at `scaleX: 0` and the track empty. */}
        <motion.div
          role="img"
          aria-label={ariaLabel}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
          className={RIBBON_SHAPE.TRACK}
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
                  size={18}
                  filled={seg.isLive}
                  className="flex-none"
                />
                {tight ? null : (
                  <span className={RIBBON_SHAPE.SEGMENT_LABEL}>{name}</span>
                )}
              </motion.div>
            );
          })}
        </motion.div>

        <span
          aria-hidden="true"
          className={RIBBON_SHAPE.NEEDLE}
          style={{ left: `${nowPercent}%` }}
        >
          <span className={RIBBON_SHAPE.NEEDLE_CAP} />
        </span>
      </div>

      <div
        aria-hidden="true"
        className={cn(RIBBON_SHAPE.AXIS, "tabular-nums")}
      >
        {AXIS_TICKS.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The Today card's loading state.
 *
 * Mirrors by IMPORTING the same shells the loaded card renders —
 * `PROFILE_CARD_PEER`, `PROFILE_PAD`, `TODAY_HEAD`, `RIBBON_SHAPE.TRACK`,
 * `RIBBON_SHAPE.AXIS` — so retuning the strip retunes its skeleton in the same
 * edit. The track placeholder is the track constant with `bg-accent` merged
 * over its fill, which keeps the 52px height and the pill radius exact rather
 * than restating either.
 */
export function ScheduleTodayCardSkeleton() {
  return (
    <Card className={PROFILE_CARD_PEER}>
      <CardHeader className={PROFILE_PAD}>
        <Skeleton className="h-5 w-40 rounded-pill" />
        <CardAction>
          <Skeleton className={cn(PILL_ACTION_SM, "w-32")} />
        </CardAction>
      </CardHeader>
      <CardContent className={cn(PROFILE_PAD, "flex flex-col gap-4")}>
        <div className={TODAY_HEAD}>
          <Skeleton className="h-5 w-72 rounded-pill" />
          <Skeleton className="ml-auto h-4 w-32 rounded-pill" />
        </div>
        <div>
          <Skeleton className={cn(RIBBON_SHAPE.TRACK, "bg-accent")} />
          <div className={cn(RIBBON_SHAPE.AXIS, "tabular-nums")}>
            {AXIS_TICKS.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// The row's condensed band
// -----------------------------------------------------------------------------

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
 * WHY THIS TAKES A SCHEDULE WHERE `ScheduleRibbon` TAKES SEGMENTS. The Today
 * card needs `nowPercent` and the next-change answer out of the same
 * `buildDayTimeline` call it draws from, so passing the ribbon pre-built
 * segments keeps one call serving three consumers. A row needs nothing but the
 * band, and every row would otherwise repeat the identical derivation at its
 * own call site — which is exactly how two callers end up disagreeing about
 * where a block starts.
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

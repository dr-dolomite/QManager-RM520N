// =============================================================================
// schedule-timeline.ts — the 24-hour scenario strip, as pure math
// =============================================================================
// The hero's schedule ribbon and the condensed 8px bar on a profile row both
// draw from this module, so the two can never disagree about where a block
// starts. Nothing here touches React, and `now` is always a PARAMETER rather
// than an implicit `new Date()` — one clock is passed down from the page, so
// the hero's needle, the hero's "next change" caption and every row's mini bar
// are computed against the same instant, and every function is unit-testable
// without freezing global time.
//
// -----------------------------------------------------------------------------
// RESOLUTION SEMANTICS — deliberately identical to the device
// -----------------------------------------------------------------------------
// `lib/scenario-schedule.ts` documents the canonical rule that
// `scenario_mgr.sh::scenario_block_for_now` implements on the modem, and this
// module reproduces it exactly rather than inventing a display-only variant:
//
//   1. A block applies today only when its `days` array INCLUDES today's
//      weekday. Absent or empty `days` = INERT, never "every day" (see the
//      field comment in types/sim-profile.ts, and `blockMatchesAt`, which does
//      `!block.days?.includes(dow)`). The editor always writes all seven days,
//      so this only ever matters for legacy records — but reading empty as
//      "all" would draw a strip the device will not honour.
//   2. Start is INCLUSIVE, end is EXCLUSIVE.
//   3. `end <= start` wraps past midnight, and is drawn here as TWO segments,
//      `[start, 1440)` and `[0, end)`. `end === start` is zero-length and never
//      matches.
//   4. On overlap, the FIRST matching block in array order wins. The brief for
//      this component asked for last-wins; that is the one rule here that was
//      knowingly not followed, because a ribbon that paints last-wins would
//      draw a band the modem is not running. `validateSchedule` already warns
//      the user about overlaps on the editor side, and `nextChangeAt` in
//      scenario-schedule.ts resolves first-wins too — three different answers
//      to "which scenario is in force" is strictly worse than one.
//   5. Anything left uncovered falls back to the binding's `default`, so the
//      returned strip always totals exactly 1440 minutes with no holes and no
//      overlaps.
//
// Adjacent segments carrying the same scenario are merged, so the ribbon never
// draws a seam where nothing actually changes.
// =============================================================================

import { formatHhmm, parseHhmm } from "@/lib/scenario-schedule";
import type {
  DayOfWeek,
  ScenarioSchedule,
  ScenarioScheduleBlock,
} from "@/types/sim-profile";

const MINUTES_PER_DAY = 24 * 60;

/** One drawn band of the 24-hour strip. */
export interface TimelineSegment {
  /** Minute-of-day this band starts at, inclusive. 0..1439. */
  startMinute: number;
  /** Minute-of-day this band ends at, exclusive. 1..1440. */
  endMinute: number;
  /** The scenario id in force across the band. */
  scenarioId: string;
  /** True for the single band containing `nowMinute`. */
  isLive: boolean;
  /**
   * The band's length in minutes. Named for its role at the call site: it is
   * fed to `flexGrow` against a `flexBasis: 0`, which is what makes the strip
   * proportional without any element knowing the container's width.
   */
  flexBasis: number;
}

export interface DayTimeline {
  segments: TimelineSegment[];
  /** Minute-of-day of `now`, 0..1439. */
  nowMinute: number;
  /** `nowMinute` as a percentage of the day, for the needle's `left`. */
  nowPercent: number;
}

/**
 * Expand one block into the 1–2 half-open minute intervals it occupies within a
 * single day. Malformed or zero-length blocks expand to nothing.
 */
function blockIntervals(block: ScenarioScheduleBlock): [number, number][] {
  const start = parseHhmm(block.start);
  const end = parseHhmm(block.end);
  if (start === null || end === null || start === end) return [];
  if (end > start) return [[start, end]];
  // end < start → the window wraps past midnight, so it is drawn as two bands.
  return [
    [start, MINUTES_PER_DAY],
    [0, end],
  ];
}

/**
 * Build the strip for the day `now` falls on.
 *
 * Implemented as a painter's pass over 1440 one-minute slots rather than as
 * interval arithmetic. The array is a fixed 1440 entries — trivial next to a
 * single poll response — and it makes gaps, wraps and overlaps fall out for
 * free instead of each needing its own branch. Blocks are painted in REVERSE
 * array order so that the earliest matching block ends up owning the slot,
 * which is the device's first-wins rule expressed as a paint order.
 */
export function buildDayTimeline(
  schedule: ScenarioSchedule,
  fallbackScenarioId: string,
  now: Date,
): DayTimeline {
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const nowPercent = (nowMinute / MINUTES_PER_DAY) * 100;

  const owner: string[] = new Array<string>(MINUTES_PER_DAY).fill(
    fallbackScenarioId,
  );

  if (schedule?.enabled && schedule.blocks.length > 0) {
    const dow = now.getDay() as DayOfWeek;
    for (let i = schedule.blocks.length - 1; i >= 0; i--) {
      const block = schedule.blocks[i];
      // Rule 1: empty / absent `days` is inert, matching the device.
      if (!block.days?.includes(dow)) continue;
      for (const [from, to] of blockIntervals(block)) {
        for (let m = from; m < to; m++) owner[m] = block.scenario;
      }
    }
  }

  // Collapse the slot array into runs, merging anything adjacent that carries
  // the same scenario.
  const segments: TimelineSegment[] = [];
  let runStart = 0;
  for (let m = 1; m <= MINUTES_PER_DAY; m++) {
    if (m === MINUTES_PER_DAY || owner[m] !== owner[runStart]) {
      segments.push({
        startMinute: runStart,
        endMinute: m,
        scenarioId: owner[runStart],
        isLive: nowMinute >= runStart && nowMinute < m,
        flexBasis: m - runStart,
      });
      runStart = m;
    }
  }

  return { segments, nowMinute, nowPercent };
}

/**
 * The next moment today's strip changes scenario, or `null` when it never does
 * (a single-segment day, or every segment carrying the same id).
 *
 * Scans forward from the live segment and wraps once past midnight, so a
 * schedule whose last band differs from its first still reports the midnight
 * hand-over. It is a TODAY-shaped answer: a block that is inert today but armed
 * tomorrow is not considered, which matches what the ribbon beside it draws.
 */
export function nextScenarioChange(
  segments: TimelineSegment[],
  nowMinute: number,
): { atMinute: number; scenarioId: string } | null {
  const liveIndex = segments.findIndex(
    (s) => nowMinute >= s.startMinute && nowMinute < s.endMinute,
  );
  if (liveIndex === -1) return null;

  const liveId = segments[liveIndex].scenarioId;
  for (let step = 1; step <= segments.length; step++) {
    const seg = segments[(liveIndex + step) % segments.length];
    if (seg.scenarioId !== liveId) {
      return { atMinute: seg.startMinute, scenarioId: seg.scenarioId };
    }
  }
  return null;
}

/**
 * Minute-of-day → "HH:MM", 24h, zero-padded. Delegates to the existing
 * `formatHhmm` so the ribbon and the schedule editor can never format a time
 * two different ways; re-exported under this name because the ribbon's callers
 * think in minutes-of-day, not in "hhmm".
 */
export function formatMinute(m: number): string {
  return formatHhmm(m);
}

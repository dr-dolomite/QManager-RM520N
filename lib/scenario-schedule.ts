// =============================================================================
// scenario-schedule.ts — Pure resolution logic for profile scenario schedules
// =============================================================================
// DISPLAY-ONLY. The on-device cron (qmanager_scenario_schedule) is authoritative
// for actually APPLYING scenarios. This module exists so the UI (locked badge +
// "next change at HH:MM" line) agrees with the device byte-for-behavior.
//
// CANONICAL RESOLUTION RULE (must match scenario_mgr.sh on the modem):
// For weekday `dow` (0=Sun..6=Sat, matches JS Date.getDay()) and minute-of-day m:
//   1. Consider only blocks whose `days` array includes `dow`.
//   2. A block matches if: s = start minutes, e = end minutes.
//        - e > s  → match when m >= s && m < e   (start INCLUSIVE, end EXCLUSIVE)
//        - e <= s → overnight wrap → match when m >= s || m < e
//   3. First matching block in array order wins ($hits[0]).
//   4. No block matches → schedule.default.
// =============================================================================

import type {
  ProfileScenarioBinding,
  ScenarioSchedule,
  ScenarioScheduleBlock,
  DayOfWeek,
} from "@/types/sim-profile";

const MINUTES_PER_DAY = 24 * 60;

/**
 * Parse "HH:MM" → minutes-of-day (0..1439). Returns null when malformed.
 */
export function parseHhmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Format minutes-of-day → "HH:MM" (24h, zero-padded). Wraps modulo a day.
 */
export function formatHhmm(minutes: number): string {
  const total = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * True if a single block is active at the given weekday + minute-of-day.
 * Mirrors rule steps 1–2. Malformed times never match.
 */
export function blockMatchesAt(
  block: ScenarioScheduleBlock,
  dow: DayOfWeek,
  minuteOfDay: number,
): boolean {
  if (!block.days?.includes(dow)) return false;
  const s = parseHhmm(block.start);
  const e = parseHhmm(block.end);
  if (s === null || e === null) return false;
  if (e > s) {
    return minuteOfDay >= s && minuteOfDay < e;
  }
  // e <= s → overnight wrap (or zero-length when e === s, which never matches)
  if (e === s) return false;
  return minuteOfDay >= s || minuteOfDay < e;
}

/**
 * Resolve the scenario id active at a given Date.
 * Returns schedule.default when no block matches (or schedule disabled).
 */
export function resolveScheduledScenario(
  now: Date,
  schedule: ScenarioSchedule,
  fallbackDefault: string,
): string {
  if (!schedule?.enabled) return fallbackDefault;
  const dow = now.getDay() as DayOfWeek;
  const m = now.getHours() * 60 + now.getMinutes();
  const hit = schedule.blocks.find((b) => blockMatchesAt(b, dow, m));
  return hit ? hit.scenario : fallbackDefault;
}

/**
 * Find the next minute-boundary (today or wrapping into following days) where
 * the resolved scenario id changes. Returns "HH:MM" of that boundary, or null
 * when the resolved scenario never changes within the next 7 days (e.g. empty
 * schedule, or a schedule that resolves to a single constant scenario).
 *
 * We scan minute-by-minute up to 7*1440 steps from `now`. The schedule is a
 * weekly cycle, so 7 days guarantees we either find a transition or prove the
 * value is constant.
 */
export function nextChangeAt(
  now: Date,
  schedule: ScenarioSchedule,
  fallbackDefault: string,
): string | null {
  if (!schedule?.enabled) return null;

  const startScenario = resolveScheduledScenario(now, schedule, fallbackDefault);

  // Walk forward minute by minute. Start from the next minute boundary.
  const cursor = new Date(now.getTime());
  cursor.setSeconds(0, 0);

  const totalMinutes = 7 * MINUTES_PER_DAY;
  for (let i = 1; i <= totalMinutes; i++) {
    cursor.setTime(cursor.getTime() + 60_000);
    const dow = cursor.getDay() as DayOfWeek;
    const m = cursor.getHours() * 60 + cursor.getMinutes();
    const hit = schedule.blocks.find((b) => blockMatchesAt(b, dow, m));
    const resolved = hit ? hit.scenario : fallbackDefault;
    if (resolved !== startScenario) {
      return formatHhmm(m);
    }
  }
  return null;
}

// --- Editor validation -------------------------------------------------------

export interface ScheduleBlockValidation {
  /** Index → error message key fragment (already-resolved is the caller's job). */
  errors: Record<number, ScheduleBlockError>;
  /** Indices of blocks that overlap another block (D3: warn, don't block). */
  overlapWarnings: number[];
}

export type ScheduleBlockError =
  | "invalid_start"
  | "invalid_end"
  | "zero_length"
  | "no_days";

/**
 * True when a schedule has at least one blocking (non-overlap) error. Overlaps
 * are warnings only and do NOT block save (D3).
 */
export function hasBlockingScheduleErrors(schedule: ScenarioSchedule): boolean {
  if (!schedule?.enabled) return false;
  return Object.keys(validateSchedule(schedule).errors).length > 0;
}

/**
 * Validate every block in a schedule. Hard errors (malformed/zero-length/no
 * days) are blocking; overlaps are warnings only (first-in-array wins).
 */
export function validateSchedule(
  schedule: ScenarioSchedule,
): ScheduleBlockValidation {
  const errors: Record<number, ScheduleBlockError> = {};
  const overlapWarnings: number[] = [];

  schedule.blocks.forEach((block, i) => {
    const s = parseHhmm(block.start);
    const e = parseHhmm(block.end);
    if (s === null) {
      errors[i] = "invalid_start";
      return;
    }
    if (e === null) {
      errors[i] = "invalid_end";
      return;
    }
    if (s === e) {
      errors[i] = "zero_length";
      return;
    }
    if (!block.days || block.days.length === 0) {
      errors[i] = "no_days";
    }
  });

  // Overlap detection (only among structurally-valid blocks). Two blocks
  // overlap if they share any day AND any minute-of-day window intersects.
  const valid = schedule.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => !errors[i]);

  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      const A = valid[a];
      const B = valid[b];
      // Blocks here already passed the no-days check, so `days` is non-empty;
      // the `?? []` only satisfies the now-optional type, it changes no behavior.
      const sharedDay = (A.b.days ?? []).some((d) =>
        (B.b.days ?? []).includes(d),
      );
      if (!sharedDay) continue;
      if (windowsOverlap(A.b, B.b)) {
        if (!overlapWarnings.includes(A.i)) overlapWarnings.push(A.i);
        if (!overlapWarnings.includes(B.i)) overlapWarnings.push(B.i);
      }
    }
  }

  return { errors, overlapWarnings };
}

/**
 * Do two blocks' time windows intersect on a shared day? Handles overnight
 * wrap by expanding each window into one or two [start,end) minute intervals.
 */
function windowsOverlap(
  a: ScenarioScheduleBlock,
  b: ScenarioScheduleBlock,
): boolean {
  const intervalsA = toIntervals(a);
  const intervalsB = toIntervals(b);
  for (const ia of intervalsA) {
    for (const ib of intervalsB) {
      if (ia[0] < ib[1] && ib[0] < ia[1]) return true;
    }
  }
  return false;
}

/** Expand a block into 1–2 [start,end) intervals within a single day. */
function toIntervals(block: ScenarioScheduleBlock): [number, number][] {
  const s = parseHhmm(block.start);
  const e = parseHhmm(block.end);
  if (s === null || e === null || s === e) return [];
  if (e > s) return [[s, e]];
  // overnight wrap: [s, 1440) + [0, e)
  return [
    [s, MINUTES_PER_DAY],
    [0, e],
  ];
}

// --- Client key seeding ------------------------------------------------------

let keyCounter = 0;

/**
 * Generate a stable client-only key for a schedule block's `_key` field.
 * Prefers crypto.randomUUID() where available, falling back to a monotonic
 * counter so it works in any runtime. Never persisted (see stripScenarioKeys).
 */
export function clientKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  keyCounter += 1;
  return `blk_${Date.now().toString(36)}_${keyCounter}`;
}

/**
 * Ensure every block in a binding carries a `_key`, minting one where missing.
 * Used when hydrating form state from persisted profiles (which never carry
 * `_key`). Returns a fresh binding; does not mutate the input.
 */
export function ensureScenarioKeys(
  binding: ProfileScenarioBinding,
): ProfileScenarioBinding {
  return {
    ...binding,
    schedule: {
      ...binding.schedule,
      blocks: binding.schedule.blocks.map((b) =>
        b._key ? b : { ...b, _key: clientKey() },
      ),
    },
  };
}

// --- Display helpers ---------------------------------------------------------

/** Coarse grouping of a block's day set, for a compact summary label. */
export type DayGrouping = "all" | "weekdays" | "weekends" | "none" | "custom";

/**
 * Classify a day set into a coarse grouping the UI can map to a localized
 * label. Pure and i18n-free so it stays unit-testable.
 *   all       = all 7 days
 *   weekdays  = exactly Mon..Fri (1,2,3,4,5)
 *   weekends  = exactly Sun + Sat (0,6)
 *   none      = empty
 *   custom    = anything else (caller falls back to a comma-joined list)
 */
export function groupDays(days: DayOfWeek[]): DayGrouping {
  if (!days || days.length === 0) return "none";
  const set = new Set(days);
  if (set.size === 7) return "all";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as DayOfWeek))) {
    return "weekdays";
  }
  if (set.size === 2 && set.has(0) && set.has(6)) return "weekends";
  return "custom";
}

/**
 * Strip the client-only `_key` off every schedule block, returning a binding
 * safe to persist (the device JSON must never carry `_key`). Pure; produces a
 * fresh object and does not mutate the input.
 */
export function stripScenarioKeys(
  binding: ProfileScenarioBinding,
): ProfileScenarioBinding {
  return {
    ...binding,
    schedule: {
      ...binding.schedule,
      blocks: binding.schedule.blocks.map(({ _key, ...rest }) => {
        void _key;
        return rest;
      }),
    },
  };
}

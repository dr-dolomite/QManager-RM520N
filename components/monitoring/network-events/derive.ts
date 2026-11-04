import {
  eventKey,
  presentEvent,
  type EventTone,
} from "@/lib/event-presentation";
import type { NetworkEvent } from "@/types/modem-status";

// Network Events — the pure derivations behind the log, Right now and Activity.

/** The CGI serves the newest 50 events of the device's ring. */
export const SERVED_EVENTS = 50;

/** A run is RUN_MIN or more consecutive same-type events, each within RUN_GAP_SEC of the next. */
export const RUN_MIN = 4;
export const RUN_GAP_SEC = 600;

const BUCKET_STEPS_SEC = [60, 120, 300, 600, 900, 1800, 3600, 7200] as const;
const MAX_COLUMNS = 24;
const MIN_COLUMNS = 8;
const HOUR_SEC = 3600;

/** An event plus its index into the full newest-first array (`unresolved` keys by it). */
export interface IndexedEvent {
  event: NetworkEvent;
  index: number;
}

export interface EventRun {
  kind: "run";
  /** Type + oldest member timestamp: unchanged while new members join at the head. */
  key: string;
  members: IndexedEvent[];
  newest: IndexedEvent;
  spanSec: number;
  /** Any member above severity info. */
  hasProblem: boolean;
}

export interface SingleItem {
  kind: "event";
  row: IndexedEvent;
}

export type LogItem = SingleItem | EventRun;

function buildRun(members: IndexedEvent[]): EventRun {
  let newest = members[0];
  let oldest = members[0];
  for (const m of members) {
    if (m.event.timestamp > newest.event.timestamp) newest = m;
    if (m.event.timestamp < oldest.event.timestamp) oldest = m;
  }
  return {
    kind: "run",
    key: `${oldest.event.type}-${oldest.event.timestamp}`,
    members,
    newest,
    spanSec: newest.event.timestamp - oldest.event.timestamp,
    hasProblem: members.some((m) => m.event.severity !== "info"),
  };
}

/** Collapse consecutive runs in an already filtered and sorted list. Order-agnostic. */
export function groupRuns(rows: readonly IndexedEvent[]): LogItem[] {
  const out: LogItem[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (
      j < rows.length &&
      rows[j].event.type === rows[i].event.type &&
      Math.abs(rows[j - 1].event.timestamp - rows[j].event.timestamp) <=
        RUN_GAP_SEC
    ) {
      j += 1;
    }
    if (j - i >= RUN_MIN) out.push(buildRun(rows.slice(i, j)));
    else for (let k = i; k < j; k++) out.push({ kind: "event", row: rows[k] });
    i = j;
  }
  return out;
}

/** The eventKeys of a run's members; open state is held per member so it survives polls. */
export function runMemberKeys(run: EventRun): string[] {
  return run.members.map((m) => eventKey(m.event));
}

/** A run's presentation probe: a routine-family type, so severity alone picks warning or routine. */
export function runProbe(run: EventRun): NetworkEvent {
  return {
    ...run.newest.event,
    type: "band_change",
    severity: run.hasProblem ? "warning" : "info",
  };
}

export type ServedWindow =
  | { kind: "empty" }
  | { kind: "all"; count: number }
  | { kind: "last"; count: number; spanSec: number };

/** What the served slice honestly covers: a full slice is a window, a short one is the whole boot. */
export function describeWindow(
  events: readonly NetworkEvent[],
  nowSec: number,
): ServedWindow {
  if (events.length === 0) return { kind: "empty" };
  if (events.length < SERVED_EVENTS) return { kind: "all", count: events.length };
  const oldest = events[events.length - 1].timestamp;
  return {
    kind: "last",
    count: events.length,
    spanSec: Math.max(60, nowSec - oldest),
  };
}

export interface ActivityColumn {
  startSec: number;
  endSec: number;
  counts: Record<EventTone, number>;
  total: number;
}

export interface ActivityBuckets {
  startSec: number;
  bucketSec: number;
  columns: ActivityColumn[];
  /** Tallest column total, floored at 1. */
  max: number;
  /** Legend totals: problems are warning + error. */
  problems: number;
  recoveries: number;
  routine: number;
}

const emptyCounts = (): Record<EventTone, number> => ({
  error: 0,
  warning: 0,
  success: 0,
  routine: 0,
});

/** Stacked bar buckets across the served window only (oldest served event to now). */
export function bucketEvents(
  events: readonly NetworkEvent[],
  nowSec: number,
): ActivityBuckets {
  const spanSec =
    events.length > 0
      ? Math.max(60, nowSec - events[events.length - 1].timestamp)
      : MAX_COLUMNS * BUCKET_STEPS_SEC[0];
  // Past 48 hours no step fits 24 columns, so the bucket widens in whole hours.
  const bucketSec =
    BUCKET_STEPS_SEC.find((step) => spanSec / step <= MAX_COLUMNS) ??
    Math.ceil(spanSec / MAX_COLUMNS / HOUR_SEC) * HOUR_SEC;
  const n = Math.max(MIN_COLUMNS, Math.ceil(spanSec / bucketSec));

  const columns: ActivityColumn[] = Array.from({ length: n }, (_, k) => {
    const endSec = nowSec - (n - 1 - k) * bucketSec;
    return { startSec: endSec - bucketSec, endSec, counts: emptyCounts(), total: 0 };
  });

  let problems = 0;
  let recoveries = 0;
  let routine = 0;
  for (const e of events) {
    const age = Math.max(0, nowSec - e.timestamp);
    const k = n - 1 - Math.min(n - 1, Math.floor(age / bucketSec));
    const tone = presentEvent(e, false, false, "card").tone;
    columns[k].counts[tone] += 1;
    columns[k].total += 1;
    if (tone === "error" || tone === "warning") problems += 1;
    else if (tone === "success") recoveries += 1;
    else routine += 1;
  }

  return {
    startSec: nowSec - n * bucketSec,
    bucketSec,
    columns,
    max: Math.max(1, ...columns.map((c) => c.total)),
    problems,
    recoveries,
    routine,
  };
}

// =============================================================================
// System Logs — shared derivations
// =============================================================================
// `shapes.ts` owns how things look; this owns how a device value becomes a
// string, a tone or a group. Sibling of the same split in
// `components/system-settings/derive.ts`.
// =============================================================================

import { LOG_LEVELS, type LevelFilter, type LogEntry } from "@/types/system-logs";

// -----------------------------------------------------------------------------
// Rotation
// -----------------------------------------------------------------------------

/** `QLOG_MAX_SIZE_KB`'s default in `scripts/usr/lib/qmanager/qlog.sh`. */
export const ROTATION_SIZE_KB = 256;

/** How full the log gets before the tile warns. */
export const ROTATION_WARN_FRACTION = 0.8;

/** 205 KB. The tile turns `warning` at or above this. */
export const ROTATION_WARN_KB = Math.ceil(
  ROTATION_SIZE_KB * ROTATION_WARN_FRACTION,
);

export function isNearRotation(sizeKb: number | undefined): boolean {
  return typeof sizeKb === "number" && sizeKb >= ROTATION_WARN_KB;
}

// -----------------------------------------------------------------------------
// Timestamps
// -----------------------------------------------------------------------------

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * The device's `YYYY-MM-DD HH:MM:SS` as epoch seconds in the viewer's zone.
 * Built field by field rather than handed to `Date`, whose treatment of a
 * space-separated string is implementation-defined.
 */
export function parseLogTimestamp(raw: string): number | null {
  const m = TIMESTAMP.exec(raw.trim());
  if (!m) return null;
  const at = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(at.getTime()) ? null : Math.floor(at.getTime() / 1000);
}

export function clockTime(atSec: number): string {
  return new Date(atSec * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A relative age, split into a unit key and a count the caller translates. */
export type AgeUnit = "now" | "seconds" | "minutes" | "hours" | "days";

export function relativeAge(deltaSec: number): {
  unit: AgeUnit;
  count: number;
} {
  const d = Math.max(0, Math.floor(deltaSec));
  if (d < 5) return { unit: "now", count: 0 };
  if (d < 60) return { unit: "seconds", count: d };
  if (d < 3600) return { unit: "minutes", count: Math.floor(d / 60) };
  if (d < 86400) return { unit: "hours", count: Math.floor(d / 3600) };
  return { unit: "days", count: Math.floor(d / 86400) };
}

// -----------------------------------------------------------------------------
// Row identity
// -----------------------------------------------------------------------------

/**
 * A row's identity, and the reason the entrance cascade does not replay every
 * ten seconds: an index-derived key renames every row as soon as one arrives.
 *
 * A log can repeat a line verbatim inside one second, so identical entries are
 * disambiguated by their ordinal within the window — stable because the window
 * is a tail and its ordering never reshuffles.
 */
export function rowIdentity(entry: LogEntry): string {
  return `${entry.timestamp}|${entry.component}|${entry.pid}|${entry.message}`;
}

export interface KeyedEntry {
  entry: LogEntry;
  key: string;
}

export function withRowKeys(entries: LogEntry[]): KeyedEntry[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = rowIdentity(entry);
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return { entry, key: ordinal === 0 ? base : `${base}#${ordinal}` };
  });
}

// -----------------------------------------------------------------------------
// Level counts and filtering
// -----------------------------------------------------------------------------

export type LevelCounts = Record<LevelFilter, number>;

/**
 * Every rail chip's live count, off the entries already in hand. This is what
 * moved level filtering client-side: the backend's `level` is a minimum-severity
 * FLOOR, so a server-filtered window could never report the other four counts —
 * and picking WARN silently showed ERROR too.
 */
export function levelCounts(entries: LogEntry[]): LevelCounts {
  const tally: LevelCounts = {
    all: entries.length,
    DEBUG: 0,
    INFO: 0,
    WARN: 0,
    ERROR: 0,
  };
  for (const entry of entries) {
    if (entry.level in tally) tally[entry.level] += 1;
  }
  return tally;
}

export function filterByLevel(
  entries: LogEntry[],
  level: LevelFilter,
): LogEntry[] {
  return level === "all"
    ? entries
    : entries.filter((entry) => entry.level === level);
}

export const RAIL_OPTIONS: LevelFilter[] = ["all", ...LOG_LEVELS];

// -----------------------------------------------------------------------------
// Day grouping
// -----------------------------------------------------------------------------

export interface DayGroup {
  key: string;
  /** Epoch seconds of the group's first row, for labelling. Null when the
   *  device emitted a timestamp this UI could not parse. */
  atSec: number | null;
  rows: KeyedEntry[];
}

function dayKey(atSec: number): string {
  const d = new Date(atSec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** `today` / `yesterday` / a date the caller formats itself. */
export type DayLabel = "today" | "yesterday" | "date";

export function dayLabelKind(atSec: number, nowSec: number): DayLabel {
  const key = dayKey(atSec);
  if (key === dayKey(nowSec)) return "today";
  if (key === dayKey(nowSec - 86400)) return "yesterday";
  return "date";
}

export function formatDayDate(atSec: number): string {
  return new Date(atSec * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function groupByDay(rows: KeyedEntry[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const row of rows) {
    const atSec = parseLogTimestamp(row.entry.timestamp);
    const key = atSec === null ? "unparsed" : dayKey(atSec);
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else out.push({ key, atSec, rows: [row] });
  }
  return out;
}

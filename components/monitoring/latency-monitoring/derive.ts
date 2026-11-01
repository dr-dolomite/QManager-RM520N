import type {
  ConnectivityStatus,
  PingHistoryEntry,
} from "@/types/modem-status";
import type { SiteBucket } from "@/types/sites";

// Latency Monitor: pure derivations. Every tone reads the poller's own cuts.

export interface Cuts {
  latencyMs: number;
  lossPct: number;
}

/** The poller's defaults, for a poller that predates `connectivity.thresholds`. */
const FALLBACK_CUTS: Cuts = { latencyMs: 250, lossPct: 30 };

export function cutsFrom(latencyMs?: number, lossPct?: number): Cuts {
  return {
    latencyMs: latencyMs ?? FALLBACK_CUTS.latencyMs,
    lossPct: lossPct ?? FALLBACK_CUTS.lossPct,
  };
}

export function resolveCuts(connectivity: ConnectivityStatus | null): Cuts {
  return cutsFrom(
    connectivity?.thresholds?.latency_ms,
    connectivity?.thresholds?.loss_pct,
  );
}

export type Tone = "ok" | "warn" | "bad";

/** Amber over the cut, red past twice the cut. */
export function latencyTone(ms: number, cuts: Cuts): Tone {
  if (ms > cuts.latencyMs * 2) return "bad";
  if (ms > cuts.latencyMs) return "warn";
  return "ok";
}

/** Amber on any loss, red at the loss cut. */
export function lossTone(pct: number, cuts: Cuts): Tone {
  if (pct >= cuts.lossPct) return "bad";
  if (pct > 0) return "warn";
  return "ok";
}

export interface MsParts {
  value: string;
  unit: "ms" | "s";
}

/** Under 10 ms keeps a decimal; 1000 ms and up reads in seconds. */
export function msParts(ms: number): MsParts {
  if (ms >= 1000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  if (ms < 10) return { value: ms.toFixed(1), unit: "ms" };
  return { value: String(Math.round(ms)), unit: "ms" };
}

export interface UnitLabels {
  ms: string;
  s: string;
}

/** A figure and its translated unit as one string, for captions and rows. */
export function msText(ms: number, units: UnitLabels): string {
  const p = msParts(ms);
  return `${p.value} ${units[p.unit]}`;
}

export function formatPct(pct: number): string {
  if (pct === 0) return "0";
  return pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock HH:MM. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// -----------------------------------------------------------------------------
// Right now
// -----------------------------------------------------------------------------

/** The poller computes jitter and loss once the window holds this many probes. */
export const MIN_STAT_SAMPLES = 10;

/** Slots in the live strip: the poller's ring capacity. */
export const STRIP_SLOTS = 60;

export interface LastAnswer {
  atMs: number;
  ms: number;
}

export type SpanUnit = "s" | "min" | "h" | "d";

export interface SpanPart {
  value: number;
  unit: SpanUnit;
}

/** An outage length as at most two figures: 45 s, 14 min, 2 h 5 min, 1 d 3 h. */
export function spanParts(sec: number): SpanPart[] {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return [{ value: s, unit: "s" }];
  const min = Math.floor(s / 60);
  if (min < 60) return [{ value: min, unit: "min" }];
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rest = min % 60;
    return rest ? [{ value: h, unit: "h" }, { value: rest, unit: "min" }] : [{ value: h, unit: "h" }];
  }
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return rest ? [{ value: d, unit: "d" }, { value: rest, unit: "h" }] : [{ value: d, unit: "d" }];
}

/**
 * Newest answered probe in the live ring, timed back from now by its slot.
 * Fresher than the archive, so a short blip never reads as a long outage.
 */
export function liveLastAnswer(
  probes: (number | null)[],
  intervalSec: number,
  nowSec: number,
): LastAnswer | null {
  for (let i = probes.length - 1; i >= 0; i--) {
    const ms = probes[i];
    if (ms !== null) {
      return { atMs: (nowSec - (probes.length - 1 - i) * intervalSec) * 1000, ms };
    }
  }
  return null;
}

/** Newest answered probe in the archived history, when there is one. */
export function lastAnswer(entries: PingHistoryEntry[]): LastAnswer | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const lat = entries[i].lat;
    if (lat !== null) return { atMs: entries[i].ts * 1000, ms: lat };
  }
  return null;
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

export type HistoryRange = "1h" | "6h" | "24h";

export const HISTORY_RANGES: readonly HistoryRange[] = ["1h", "6h", "24h"];

export const HISTORY_RANGE: Record<
  HistoryRange,
  { spanSec: number; bucketMin: number }
> = {
  "1h": { spanSec: 3600, bucketMin: 1 },
  "6h": { spanSec: 21600, bucketMin: 10 },
  "24h": { spanSec: 86400, bucketMin: 30 },
};

export interface HistoryPoint {
  /** Bucket start, ms epoch. */
  ts: number;
  /** Mean RTT of the answered probes; null when every probe failed. */
  avg: number | null;
  /** `avg` held to the plot's top, so a spike stays on the chart. */
  plot: number | null;
  /** Highest probe RTT in the bucket. */
  worst: number | null;
  total: number;
  failed: number;
}

export interface HistoryView {
  points: HistoryPoint[];
  /** Median probe RTT in the range. */
  typical: number | null;
  /** Highest probe RTT in the range. */
  worst: number | null;
  lossPct: number;
  /** Probes in the range. */
  total: number;
  domainMax: number;
  ticks: number[];
  startMs: number;
  endMs: number;
}

/** Cut in LOCAL time: every bucket size divides the hour. */
function bucketStart(tsMs: number, bucketMin: number): number {
  const d = new Date(tsMs);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / bucketMin) * bucketMin);
  return d.getTime();
}

function niceDomain(raw: number): number {
  const step = raw > 2000 ? 500 : raw > 600 ? 200 : raw > 300 ? 100 : 50;
  return Math.ceil(raw / step) * step;
}

/** `now` is the newest archived row, so the view is a pure function of the data. */
export function deriveHistory(
  entries: PingHistoryEntry[],
  range: HistoryRange,
  cuts: Cuts,
): HistoryView | null {
  if (entries.length === 0) return null;
  const { spanSec, bucketMin } = HISTORY_RANGE[range];
  const endSec = entries[entries.length - 1].ts;
  const startSec = endSec - spanSec;

  const rows = entries.filter((e) => e.ts > startSec && e.ts <= endSec);
  if (rows.length === 0) return null;

  const buckets = new Map<
    number,
    { sum: number; answered: number; worst: number | null; total: number; failed: number }
  >();
  const answered: number[] = [];
  let failed = 0;
  for (const row of rows) {
    const key = bucketStart(row.ts * 1000, bucketMin);
    const acc = buckets.get(key) ?? {
      sum: 0,
      answered: 0,
      worst: null,
      total: 0,
      failed: 0,
    };
    acc.total++;
    if (row.lat === null) {
      acc.failed++;
      failed++;
    } else {
      acc.sum += row.lat;
      acc.answered++;
      acc.worst = acc.worst === null ? row.lat : Math.max(acc.worst, row.lat);
      answered.push(row.lat);
    }
    buckets.set(key, acc);
  }

  const raw = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, acc]) => ({
      ts,
      avg: acc.answered > 0 ? acc.sum / acc.answered : null,
      worst: acc.worst,
      total: acc.total,
      failed: acc.failed,
    }));

  // The limit line is always on the plot; a lone spike gets a caret, not the scale.
  const avgs = raw
    .map((p) => p.avg)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const p95 = avgs.length ? avgs[Math.floor(avgs.length * 0.95)] : cuts.latencyMs;
  const domainMax = niceDomain(Math.max(p95 * 1.25, cuts.latencyMs * 1.2));

  answered.sort((a, b) => a - b);
  return {
    points: raw.map((p) => ({
      ...p,
      plot: p.avg === null ? null : Math.min(p.avg, domainMax),
    })),
    typical: answered.length ? answered[Math.floor(answered.length / 2)] : null,
    worst: answered.length ? answered[answered.length - 1] : null,
    lossPct: (failed / rows.length) * 100,
    total: rows.length,
    domainMax,
    ticks: [0, domainMax / 2, domainMax],
    startMs: startSec * 1000,
    endMs: endSec * 1000,
  };
}

/** Evenly spaced x ticks across the range, ends included. */
export function timeTicks(startMs: number, endMs: number, count: number): number[] {
  return Array.from(
    { length: count + 1 },
    (_, i) => startMs + ((endMs - startMs) * i) / count,
  );
}

export function axisMs(v: number, unitS: string): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} ${unitS}` : String(Math.round(v));
}

// -----------------------------------------------------------------------------
// Sites
// -----------------------------------------------------------------------------

export const MAX_SITES = 32;

/** Mean of answered samples over the range the CGI returned. */
export function siteAverage(series: SiteBucket[]): number | null {
  let sum = 0;
  let count = 0;
  for (const b of series) {
    if (b.ms === null || b.ok <= 0) continue;
    sum += b.ms * b.ok;
    count += b.ok;
  }
  return count > 0 ? sum / count : null;
}

/** Lower-cases and strips a scheme, credentials, path, query and port. */
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

/** Mirrors the daemon's host check: 3-253 of [a-z0-9.-], a dot, clean edges. */
export function isValidHost(host: string): boolean {
  if (host.length < 3 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (!host.includes(".")) return false;
  if (/^[.-]|[.-]$/.test(host)) return false;
  return !/\.\.|\.-|-\./.test(host);
}

export type HostError = "invalid" | "duplicate" | "full";

export function hostError(host: string, existing: readonly string[]): HostError | null {
  if (!isValidHost(host)) return "invalid";
  if (existing.includes(host)) return "duplicate";
  if (existing.length >= MAX_SITES) return "full";
  return null;
}

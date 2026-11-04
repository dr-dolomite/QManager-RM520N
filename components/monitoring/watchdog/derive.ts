"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  HelpCircleIcon,
  LoaderIcon,
  LockIcon,
  MinusCircleIcon,
  PauseCircleIcon,
  PowerOffIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import type { WatchdogSettings } from "@/hooks/use-watchdog-settings";
import type {
  ConnectivityStatus,
  WatchcatState,
  WatchcatStatus,
} from "@/types/modem-status";

import { STRIP, type DiscTone, type FigureTone } from "./shapes";

// Watchdog — the surface's ONE derived model. Every child reads this; no
// component re-infers a state from a payload.

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

export type TierIndex = 1 | 2 | 3 | 4;

/** Escalation order, gentlest first. The one place the four rungs are listed. */
export const TIERS: readonly TierIndex[] = [1, 2, 3, 4];

/** Rung copy keys. The names live HERE and nowhere else on the surface. */
export const TIER_NAME_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.name",
  2: "watchdog.ladder.tier2.name",
  3: "watchdog.ladder.tier3.name",
  4: "watchdog.ladder.tier4.name",
};

/** What the rung costs the user. Stated in the rung, never in a tooltip. */
export const TIER_CONSEQUENCE_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.consequence",
  2: "watchdog.ladder.tier2.consequence",
  3: "watchdog.ladder.tier3.consequence",
  4: "watchdog.ladder.tier4.consequence",
};

// -----------------------------------------------------------------------------
// The phase ladder
// -----------------------------------------------------------------------------

/**
 * What the surface knows about the watchdog, in one closed set. The seven live
 * members are the daemon's own states; the five synthetic ones cover the cases
 * the daemon cannot report about itself.
 */
export type WatchdogPhase =
  | "off"
  | "unknown"
  | "starting"
  | "not_running"
  | "auto_disabled"
  | WatchcatState;

/**
 * One poller Tier-1.5 period is ~20s (`TIER1_5_EVERY=5` at a ~3.7-4.0s cycle),
 * and a save backgrounds the unit restart, so a healthy start can take ~30s to
 * reach the page. Three periods is the honest floor before calling it silent.
 */
export const GRACE_MS = 60_000;

/**
 * A modem with no battery RTC boots at Jan 1970 and stays there without a
 * registered SIM, which makes every clock-difference staleness check read
 * "stale" forever. Below this epoch the modem clock is not evidence.
 */
export const CLOCK_PLAUSIBLE_AFTER = 1_600_000_000;

export interface PhaseInput {
  /** Saved truth, not the draft. The band never reports a half-edited form. */
  settingsEnabled: boolean;
  autoDisabled: boolean;
  watchcat: WatchcatStatus | null;
  /** The modem's own timestamp on the snapshot, for the plausibility gate. */
  snapshotAt: number | null;
  stale: boolean;
  /** The read itself failed, or nothing has arrived. Clock-independent. */
  unreachable: boolean;
  pastGrace: boolean;
}

/**
 * Resolution is ordered and total: a standing config fact outranks a live
 * reading, and not knowing outranks guessing.
 */
export function derivePhase({
  settingsEnabled,
  autoDisabled,
  watchcat,
  snapshotAt,
  stale,
  unreachable,
  pastGrace,
}: PhaseInput): WatchdogPhase {
  if (autoDisabled) return "auto_disabled";
  if (!settingsEnabled) return "off";

  const clockUsable =
    snapshotAt !== null && snapshotAt > CLOCK_PLAUSIBLE_AFTER;
  if (unreachable || (clockUsable && stale) || !watchcat) return "unknown";

  if (isWatchcatLive(watchcat)) return watchcat.state;
  // Enabled but its own state has gone quiet: no grace, it WAS reporting.
  if (watchcat.enabled) return "not_running";
  return pastGrace ? "not_running" : "starting";
}

/**
 * The daemon is enabled AND still reporting. A block with no age fields (an
 * older backend) counts as live: absence of evidence is not staleness.
 */
export function isWatchcatLive(watchcat: WatchcatStatus | null): boolean {
  if (!watchcat?.enabled) return false;
  const { age_sec: age, stale_after: limit } = watchcat;
  return !(age != null && limit != null && age > limit);
}

/** The disc is the only coloured thing in the status card's phase block. */
export const PHASE_DISC = {
  off: "neutral",
  unknown: "neutral",
  starting: "info",
  not_running: "bad",
  auto_disabled: "bad",
  monitor: "good",
  suspect: "alert",
  recovery: "info",
  cooldown: "info",
  ssr_hold: "info",
  locked: "neutral",
  disabled: "neutral",
} satisfies Record<WatchdogPhase, DiscTone>;

/** Twelve phases, twelve distinct glyphs — the containers are 1.03:1 apart. */
export const PHASE_GLYPH = {
  off: PowerOffIcon,
  unknown: HelpCircleIcon,
  starting: LoaderIcon,
  not_running: XCircleIcon,
  auto_disabled: AlertCircleIcon,
  monitor: CheckCircle2Icon,
  suspect: TriangleAlertIcon,
  recovery: RefreshCwIcon,
  cooldown: ClockIcon,
  ssr_hold: PauseCircleIcon,
  locked: LockIcon,
  disabled: MinusCircleIcon,
} satisfies Record<WatchdogPhase, LucideIcon>;

export const PHASE_LABEL_KEY: Record<WatchdogPhase, string> = {
  off: "watchdog.phase.off.label",
  unknown: "watchdog.phase.unknown.label",
  starting: "watchdog.phase.starting.label",
  not_running: "watchdog.phase.not_running.label",
  auto_disabled: "watchdog.phase.auto_disabled.label",
  monitor: "watchdog.phase.monitor.label",
  suspect: "watchdog.phase.suspect.label",
  recovery: "watchdog.phase.recovery.label",
  cooldown: "watchdog.phase.cooldown.label",
  ssr_hold: "watchdog.phase.ssr_hold.label",
  locked: "watchdog.phase.locked.label",
  disabled: "watchdog.phase.disabled.label",
};

export const PHASE_BLURB_KEY: Record<WatchdogPhase, string> = {
  off: "watchdog.phase.off.blurb",
  unknown: "watchdog.phase.unknown.blurb",
  starting: "watchdog.phase.starting.blurb",
  not_running: "watchdog.phase.not_running.blurb",
  auto_disabled: "watchdog.phase.auto_disabled.blurb",
  monitor: "watchdog.phase.monitor.blurb",
  suspect: "watchdog.phase.suspect.blurb",
  recovery: "watchdog.phase.recovery.blurb",
  cooldown: "watchdog.phase.cooldown.blurb",
  ssr_hold: "watchdog.phase.ssr_hold.blurb",
  locked: "watchdog.phase.locked.blurb",
  disabled: "watchdog.phase.disabled.blurb",
};

/** Only `recovery` is genuinely acting, so it is the surface's one loop. */
export function isLive(phase: WatchdogPhase): boolean {
  return phase === "recovery";
}

// -----------------------------------------------------------------------------
// The status card
// -----------------------------------------------------------------------------

export interface BandFigure {
  key: "checks" | "recoveries" | "reboots";
  eyebrowKey: string;
  /** Already-formatted figure, or null when the reading is absent. */
  value: string | null;
  captionKey: string;
  captionParams?: Record<string, string | number>;
  tone: FigureTone;
}

export interface BandView {
  labelKey: string;
  /** The phase blurb, or the live cooldown countdown in the same slot. */
  blurbKey: string;
  blurbParams?: Record<string, string | number>;
  /** The blurb carries a live figure and must not jitter. */
  blurbNumeric: boolean;
  disc: DiscTone;
  glyph: LucideIcon;
  /** The device is acting right now. Carries the surface's one ambient loop. */
  live: boolean;
  figures: BandFigure[];
}

export interface BandInput {
  phase: WatchdogPhase;
  settings: WatchdogSettings;
  watchcat: WatchcatStatus | null;
  /** Translated relative time for the last recovery, when there is one. */
  lastAgo: string | null;
}

const isTier = (n: number | null | undefined): n is TierIndex =>
  n === 1 || n === 2 || n === 3 || n === 4;

/**
 * Phase plus three readings, each honest about absence: a missing figure is
 * `null` and renders as an em dash, never as a zero the device never reported.
 */
export function deriveBand({
  phase,
  settings,
  watchcat,
  lastAgo,
}: BandInput): BandView {
  const known = phase !== "unknown" && watchcat !== null;
  const cooling = known && watchcat.cooldown_remaining > 0;
  const failures = known ? watchcat.failure_count : null;
  const reboots = known ? watchcat.reboots_this_hour : null;
  const cap = settings.max_reboots_per_hour;
  const lastTier = known ? watchcat.last_recovery_tier : null;
  const coolingTier = known ? watchcat.current_tier : null;

  return {
    labelKey: PHASE_LABEL_KEY[phase],
    blurbKey: cooling
      ? isTier(coolingTier)
        ? "watchdog.band.cooldownStep"
        : "watchdog.band.cooldownCaption"
      : PHASE_BLURB_KEY[phase],
    blurbParams: cooling
      ? { seconds: watchcat.cooldown_remaining, tier: coolingTier ?? 0 }
      : undefined,
    blurbNumeric: cooling,
    disc: PHASE_DISC[phase],
    glyph: PHASE_GLYPH[phase],
    live: isLive(phase),
    figures: [
      {
        key: "checks",
        eyebrowKey: "watchdog.band.checks",
        value:
          failures === null ? null : `${failures} / ${settings.fail_threshold}`,
        captionKey: "watchdog.band.checksCaption",
        tone: failures !== null && failures > 0 ? "alert" : "neutral",
      },
      {
        key: "recoveries",
        eyebrowKey: "watchdog.band.recoveries",
        value: known ? String(watchcat.total_recoveries) : null,
        captionKey:
          isTier(lastTier) && lastAgo
            ? "watchdog.band.recoveriesLast"
            : "watchdog.band.recoveriesNone",
        captionParams:
          isTier(lastTier) && lastAgo ? { tier: lastTier, ago: lastAgo } : undefined,
        tone: "neutral",
      },
      {
        key: "reboots",
        eyebrowKey: "watchdog.band.reboots",
        value: reboots === null ? null : `${reboots} / ${cap}`,
        // Tier-4 reboots in the rolling hour; the daemon recounts once a minute.
        captionKey: settings.tier4_enabled
          ? "watchdog.band.rebootsCaption"
          : "watchdog.band.rebootsOff",
        tone:
          reboots === null || reboots === 0
            ? "neutral"
            : reboots >= cap
              ? "bad"
              : "alert",
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// The probe strip
// -----------------------------------------------------------------------------

export type StripBar =
  | { kind: "none" }
  | { kind: "miss" }
  | { kind: "ok"; heightPct: number };

export type StripView =
  | { kind: "empty" }
  | {
      kind: "bars";
      bars: StripBar[];
      total: number;
      missed: number;
      avgMs: number | null;
      minutes: number;
    };

/** The poller's own probe history, oldest first, left-padded to the slot count. */
export function deriveStrip(
  connectivity: ConnectivityStatus | null,
  phase: WatchdogPhase,
): StripView {
  const all = connectivity?.latency_history ?? [];
  if (phase === "unknown" || all.length === 0) return { kind: "empty" };

  const history = all.slice(-STRIP.SLOTS);
  const answered = history.filter((v): v is number => v !== null);
  const max = Math.max(1, ...answered);
  const pad: StripBar[] = Array.from(
    { length: STRIP.SLOTS - history.length },
    () => ({ kind: "none" }),
  );
  const bars: StripBar[] = history.map((v) =>
    v === null
      ? { kind: "miss" }
      : {
          kind: "ok",
          heightPct: Math.round(STRIP.FLOOR_PCT + STRIP.SPAN_PCT * (v / max)),
        },
  );
  const avg = connectivity?.avg_latency_ms;
  const interval = connectivity?.history_interval_sec ?? 0;

  return {
    kind: "bars",
    bars: [...pad, ...bars],
    total: history.length,
    missed: history.length - answered.length,
    avgMs: typeof avg === "number" && Number.isFinite(avg) ? Math.round(avg) : null,
    minutes: Math.max(1, Math.round((history.length * interval) / 60)),
  };
}

// -----------------------------------------------------------------------------
// The outage timeline
// -----------------------------------------------------------------------------

/** One integer check for the form and the timeline, mirroring the CGI ranges. */
export const isIntInRange = (raw: string, min: number, max: number): boolean => {
  const n = Number(raw);
  return !(raw.trim() === "" || isNaN(n) || !Number.isInteger(n) || n < min || n > max);
};

/** The daemon holds at least this long after a SIM switch before rechecking. */
const SIM_SWITCH_MIN_WAIT = 90;

export interface TimelineInput {
  enabled: boolean;
  tiers: Record<TierIndex, boolean>;
  backupSlot: string;
  probeInterval: string;
  failThreshold: string;
  cooldown: string;
}

export interface TimelineRow {
  tier: TierIndex;
  seconds: number;
  /** The first armed step runs the moment the outage is declared. */
  declared: boolean;
}

export type TimelineNote = "off" | "none" | "invalid" | "stopped";

export interface TimelineView {
  rows: TimelineRow[];
  /** Shown only when there are no rows or the ladder stops early. */
  note: TimelineNote | null;
}

/**
 * When each armed step runs into an outage, from the two cards' DRAFTS:
 * declare at probe interval × threshold, then one wait per step.
 */
export function deriveTimeline({
  enabled,
  tiers,
  backupSlot,
  probeInterval,
  failThreshold,
  cooldown,
}: TimelineInput): TimelineView {
  if (!enabled) return { rows: [], note: "off" };
  if (
    !isIntInRange(probeInterval, 1, 60) ||
    !isIntInRange(failThreshold, 1, 20) ||
    !isIntInRange(cooldown, 10, 300)
  )
    return { rows: [], note: "invalid" };

  const armed = TIERS.filter((tier) => tiers[tier]);
  if (armed.length === 0) return { rows: [], note: "none" };

  const wait = Number(cooldown);
  let at = Number(probeInterval) * Number(failThreshold);
  const rows: TimelineRow[] = [];
  for (const [i, tier] of armed.entries()) {
    rows.push({ tier, seconds: at, declared: i === 0 });
    // A tier 3 with no slot halts the ladder (watchcat return code 2).
    if (tier === 3 && !backupSlot) return { rows, note: "stopped" };
    at += tier === 3 ? Math.max(SIM_SWITCH_MIN_WAIT, wait) : wait;
  }
  return { rows, note: null };
}

/** "N s" under a minute, else "M min S s", dropping a zero seconds part. */
export function timelineDuration(seconds: number): {
  key: string;
  params: Record<string, number>;
} {
  if (seconds < 60)
    return { key: "watchdog.detection.timeline.seconds", params: { s: seconds } };
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0
    ? { key: "watchdog.detection.timeline.minutes", params: { m } }
    : { key: "watchdog.detection.timeline.minutesSeconds", params: { m, s } };
}


// -----------------------------------------------------------------------------
// Relative time
// -----------------------------------------------------------------------------

const DAY_SEC = 86_400;

/**
 * One relative-time formatter for the whole surface, so the band's "last
 * recovery" and the log's rows cannot drift apart. The shared
 * `formatTimeAgo` in types/modem-status.ts is English-only.
 */
export function useTimeAgo(): (epochSec: number) => string {
  const { t } = useTranslation("common");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => clearInterval(id);
  }, []);

  return useCallback(
    (epochSec: number) => {
      const diff = Math.max(0, nowSec - epochSec);
      if (diff < 60) return t("watchdog.activity.time.just_now");
      if (diff < 3600)
        return t("watchdog.activity.time.minutes", {
          count: Math.floor(diff / 60),
        });
      if (diff < DAY_SEC)
        return t("watchdog.activity.time.hours", {
          count: Math.floor(diff / 3600),
        });
      return t("watchdog.activity.time.days", {
        count: Math.floor(diff / DAY_SEC),
      });
    },
    [nowSec, t],
  );
}

// -----------------------------------------------------------------------------
// The grace gate
// -----------------------------------------------------------------------------

/**
 * Whether the grace window has elapsed, measured against the poll's own
 * `receivedAtMs` rather than a clock read during render — a `Date.now()` there
 * is what `react-hooks/purity` flags, and the rule bails per component.
 *
 * The anchor moves when the saved master switch flips, so enabling the
 * watchdog restarts the window instead of instantly declaring it silent.
 */
export function useGraceGate(
  receivedAtMs: number | null,
  settingsEnabled: boolean,
): boolean {
  const [anchor, setAnchor] = useState<number | null>(receivedAtMs);
  const [prevEnabled, setPrevEnabled] = useState(settingsEnabled);

  if (prevEnabled !== settingsEnabled) {
    setPrevEnabled(settingsEnabled);
    setAnchor(receivedAtMs);
  } else if (anchor === null && receivedAtMs !== null) {
    setAnchor(receivedAtMs);
  }

  return anchor !== null && receivedAtMs !== null
    ? receivedAtMs - anchor > GRACE_MS
    : false;
}

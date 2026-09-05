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
  PowerOffIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import type { BadgeVariant } from "@/components/ui/badge";
import type { WatchdogSettings } from "@/hooks/use-watchdog-settings";
import type { WatchcatState, WatchcatStatus } from "@/types/modem-status";

import type { DiscTone, TileValueTone } from "./shapes";

// Watchdog — the surface's ONE derived model. Every child reads this; no
// component re-infers a state from a payload.

// -----------------------------------------------------------------------------
// The recovery ladder
// -----------------------------------------------------------------------------

export type TierIndex = 1 | 2 | 3 | 4;

/** Escalation order, gentlest first. The one place the four rungs are listed. */
export const TIERS: readonly TierIndex[] = [1, 2, 3, 4];

/**
 * The machine voice per rung — what the device actually issues. Tier 4 is not
 * an AT command: `run_reboot` shells out to `/sbin/reboot`.
 */
export const TIER_COMMAND: Record<TierIndex, string> = {
  1: "AT+COPS=2 → AT+COPS=0",
  2: "AT+CFUN=0 → AT+CFUN=1",
  3: "AT+CFUN=0 → AT+QUIMSLOT=N → AT+CFUN=1",
  4: "reboot",
};

/** Rung copy keys. The names live HERE and nowhere else on the surface. */
export const TIER_NAME_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.name",
  2: "watchdog.ladder.tier2.name",
  3: "watchdog.ladder.tier3.name",
  4: "watchdog.ladder.tier4.name",
};

export const TIER_EFFECT_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.effect",
  2: "watchdog.ladder.tier2.effect",
  3: "watchdog.ladder.tier3.effect",
  4: "watchdog.ladder.tier4.effect",
};

/** What the rung costs the user. Stated in the rung, never in a tooltip. */
export const TIER_CONSEQUENCE_KEY: Record<TierIndex, string> = {
  1: "watchdog.ladder.tier1.consequence",
  2: "watchdog.ladder.tier2.consequence",
  3: "watchdog.ladder.tier3.consequence",
  4: "watchdog.ladder.tier4.consequence",
};

/**
 * A rung's resolved state. `running` carries no chip: the promoted container
 * already reports it and a `primary-container` chip on a `primary-container`
 * row is the same surface twice.
 */
export type RungState = "off" | "on" | "running" | "blocked";

export const RUNG_BADGE = {
  off: "muted",
  on: "success",
  blocked: "warning",
} satisfies Record<Exclude<RungState, "running">, BadgeVariant>;

/** One glyph per rung state. Two states in this slot never share one. */
export const RUNG_GLYPH = {
  off: MinusCircleIcon,
  on: CheckCircle2Icon,
  blocked: TriangleAlertIcon,
} satisfies Record<Exclude<RungState, "running">, LucideIcon>;

export const RUNG_STATUS_KEY = {
  off: "watchdog.ladder.status.off",
  on: "watchdog.ladder.status.on",
  blocked: "watchdog.ladder.status.blocked",
} satisfies Record<Exclude<RungState, "running">, string>;

export interface RungView {
  tier: TierIndex;
  state: RungState;
  /** Draft truth: what the switch shows and what a save would write. */
  enabled: boolean;
  command: string;
}

export interface RungInput {
  tiers: Record<TierIndex, boolean>;
  /** Draft backup slot. Tier 3 without one stops the ladder, so it blocks. */
  backupSlot: string;
  /** Live truth: the tier the daemon is executing right now, 0 for none. */
  runningTier: number;
}

export function deriveRungs({
  tiers,
  backupSlot,
  runningTier,
}: RungInput): RungView[] {
  return TIERS.map((tier) => {
    const enabled = tiers[tier];
    let state: RungState;
    if (runningTier === tier) state = "running";
    else if (!enabled) state = "off";
    else if (tier === 3 && !backupSlot) state = "blocked";
    else state = "on";
    return { tier, state, enabled, command: TIER_COMMAND[tier] };
  });
}

// -----------------------------------------------------------------------------
// The phase ladder
// -----------------------------------------------------------------------------

/**
 * What the surface knows about the watchdog, in one closed set. The six live
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
const CLOCK_PLAUSIBLE_AFTER = 1_600_000_000;

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

  if (watchcat.enabled) return watchcat.state;
  return pastGrace ? "not_running" : "starting";
}

/** The disc is the only coloured thing on a tile, so the phase lands here. */
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
  locked: "neutral",
  disabled: "neutral",
} satisfies Record<WatchdogPhase, DiscTone>;

export const PHASE_VALUE_TONE = {
  off: "neutral",
  unknown: "neutral",
  starting: "neutral",
  not_running: "bad",
  auto_disabled: "bad",
  monitor: "neutral",
  suspect: "alert",
  recovery: "neutral",
  cooldown: "neutral",
  locked: "neutral",
  disabled: "neutral",
} satisfies Record<WatchdogPhase, TileValueTone>;

/** Eleven phases, eleven distinct glyphs — the containers are 1.03:1 apart. */
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
  locked: "watchdog.phase.locked.blurb",
  disabled: "watchdog.phase.disabled.blurb",
};

/** Only `recovery` is genuinely acting, so it is the surface's one loop. */
export function isLive(phase: WatchdogPhase): boolean {
  return phase === "recovery";
}

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

export interface BandTile {
  key: "state" | "checks" | "recoveries" | "reboots";
  eyebrowKey: string;
  /** Already-formatted figure, or null when the reading is absent. */
  value: string | null;
  captionKey: string;
  captionParams?: Record<string, string | number>;
  disc: DiscTone;
  valueTone: TileValueTone;
  glyph: LucideIcon;
  /** The caption carries a live figure and must not jitter. */
  captionNumeric?: boolean;
}

export interface BandInput {
  phase: WatchdogPhase;
  /** Already translated: derive owns the key, the caller owns the language. */
  phaseLabel: string;
  settings: WatchdogSettings;
  watchcat: WatchcatStatus | null;
  /** Translated tier name for the "last recovery" caption, when there is one. */
  lastTierName: string | null;
  /** Translated relative time for the last recovery, when there is one. */
  lastAgo: string | null;
}

/**
 * Four readings, each honest about absence: a missing figure is `null` and
 * renders as an em dash, never as a zero the device never reported.
 */
export function deriveBand({
  phase,
  phaseLabel,
  settings,
  watchcat,
  lastTierName,
  lastAgo,
}: BandInput): BandTile[] {
  const known = phase !== "unknown" && watchcat !== null;
  const cooling = known && watchcat.cooldown_remaining > 0;
  const failures = known ? watchcat.failure_count : null;
  const reboots = known ? watchcat.reboots_this_hour : null;

  return [
    {
      key: "state",
      eyebrowKey: "watchdog.band.state",
      value: phaseLabel,
      captionKey: cooling
        ? "watchdog.band.cooldownCaption"
        : PHASE_BLURB_KEY[phase],
      captionParams: cooling
        ? { seconds: watchcat.cooldown_remaining }
        : undefined,
      captionNumeric: cooling,
      disc: PHASE_DISC[phase],
      valueTone: PHASE_VALUE_TONE[phase],
      glyph: PHASE_GLYPH[phase],
    },
    {
      key: "checks",
      eyebrowKey: "watchdog.band.checks",
      value: failures === null ? null : `${failures} / ${settings.fail_threshold}`,
      captionKey: "watchdog.band.checksCaption",
      disc: failures !== null && failures > 0 ? "alert" : "neutral",
      valueTone: failures !== null && failures > 0 ? "alert" : "neutral",
      glyph: TriangleAlertIcon,
    },
    {
      key: "recoveries",
      eyebrowKey: "watchdog.band.recoveries",
      value: known ? String(watchcat.total_recoveries) : null,
      captionKey:
        lastTierName && lastAgo
          ? "watchdog.band.recoveriesLast"
          : "watchdog.band.recoveriesNone",
      captionParams:
        lastTierName && lastAgo
          ? { tier: lastTierName, ago: lastAgo }
          : undefined,
      disc: "neutral",
      valueTone: "neutral",
      glyph: ClockIcon,
    },
    {
      key: "reboots",
      eyebrowKey: "watchdog.band.reboots",
      value:
        reboots === null
          ? null
          : `${reboots} / ${settings.max_reboots_per_hour}`,
      // `count_recent_reboots` runs at daemon start and inside tier 4 only, so
      // this figure is a running total since start, never a rolling hour.
      captionKey: settings.tier4_enabled
        ? "watchdog.band.rebootsCaption"
        : "watchdog.band.rebootsOff",
      disc: reboots !== null && reboots > 0 ? "alert" : "neutral",
      valueTone: reboots !== null && reboots > 0 ? "alert" : "neutral",
      glyph: PowerOffIcon,
    },
  ];
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

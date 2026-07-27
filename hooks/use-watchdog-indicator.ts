"use client";

import { useMemo } from "react";

import { useModemStatus } from "@/hooks/use-modem-status";
import type { WatchcatState } from "@/types/modem-status";

// =============================================================================
// useWatchdogIndicator — live watchdog state for the sidebar nav row
// =============================================================================
// Reads the watchcat block the poller already publishes into
// /tmp/qmanager_status.json. Deliberately NOT useWatchdogSettings(): that hook
// hits monitoring/watchdog.sh, which reads config as well as state, and the
// shell is mounted on every page — it has no business doing that once per
// session, let alone on a timer.
//
// Cadence is 15s, not the dashboard's 2s. The nav row answers "is the watchdog
// doing something right now", a question whose answer changes on the order of
// the watchdog's own probe interval. Polling it faster would spend the modem's
// CPU to tell the user nothing new.
//
// PRODUCT.md principle 3, "interfaces that never lie", is the whole reason this
// hook is narrow: the row must reflect what the device is actually doing, so it
// returns null whenever we do not know — no data yet, stale data, watchdog
// disabled, or a state we do not recognise.
// =============================================================================

const POLL_INTERVAL_MS = 15_000;

export type WatchdogActivity = "recovery" | "cooldown";

export interface WatchdogIndicator {
  activity: WatchdogActivity;
  /** Ladder tier the watchdog is on (1 = re-register … 4 = deferred reboot). */
  tier: number;
}

/**
 * The two states worth interrupting the nav for. `suspect` is excluded on
 * purpose: failures accumulating below the threshold is the watchdog working
 * normally, and painting the sidebar red for it would train users to ignore it.
 */
const REPORTABLE: Record<string, WatchdogActivity | undefined> = {
  recovery: "recovery",
  cooldown: "cooldown",
};

export function useWatchdogIndicator(): WatchdogIndicator | null {
  const { data, isStale } = useModemStatus({ pollInterval: POLL_INTERVAL_MS });

  return useMemo(() => {
    // Stale data means the poller stopped. A frozen "acting" pill would be a
    // lie of exactly the kind the design principles forbid.
    if (!data || isStale) return null;

    const watchcat = data.watchcat;
    if (!watchcat?.enabled) return null;

    const activity = REPORTABLE[watchcat.state as WatchcatState];
    if (!activity) return null;

    return { activity, tier: watchcat.current_tier };
  }, [data, isStale]);
}

"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useSharedSimProfiles } from "@/hooks/use-sim-profiles";
import type { ProfileSummary, ProfileListResponse } from "@/types/sim-profile";
import {
  resolveScheduledScenario,
  nextChangeAt as computeNextChangeAt,
} from "@/lib/scenario-schedule";

// =============================================================================
// useActiveProfile — the active profile + its scenario schedule lock
// =============================================================================
// Standalone, this hook owns a 30s poll of `profiles/list.sh` and picks the
// active record out of the response.
//
// SHARED FETCH. When a `SimProfilesProvider` is mounted above (as it is on
// /cellular/custom-profiles), the same three values are DERIVED from that one
// shared list and this hook stops both its initial fetch AND its 30s poll —
// the shared instance already refreshes, and a second poller against the same
// endpoint was the whole redundancy this removes. The public return shape is
// unchanged in either mode.
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/profiles";
const POLL_INTERVAL_MS = 30_000;
// Recompute the resolved/next-change scenario every minute so the locked badge
// advances at block boundaries without a network round-trip.
const TICK_INTERVAL_MS = 60_000;

export interface UseActiveProfileReturn {
  activeProfile: ProfileSummary | null;
  isLoading: boolean;
  refresh: () => void;
  // --- Scenario schedule lock (display-only; device cron is authoritative) ---
  /** True when the active profile has scenario.schedule.enabled. */
  scheduleLocked: boolean;
  /** Scenario id dictated by the schedule right now (or the default fallback). */
  scheduledScenarioId: string | null;
  /** "HH:MM" of the next scheduled transition, or null. */
  nextChangeAt: string | null;
  /** Active profile name, for the lock hint copy. */
  lockProfileName: string | null;
}

export function useActiveProfile(): UseActiveProfileReturn {
  const shared = useSharedSimProfiles();
  // Gate for our OWN fetch + poll. Every hook below is still called
  // unconditionally — only the effect bodies branch.
  const enabled = shared === null;

  const [ownProfile, setOwnProfile] = useState<ProfileSummary | null>(null);
  const [ownLoading, setOwnLoading] = useState(true);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchActive = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data: ProfileListResponse = await resp.json();
      if (!mountedRef.current) return;

      const active = data.active_profile_id
        ? (data.profiles ?? []).find((p) => p.id === data.active_profile_id) ?? null
        : null;

      setOwnProfile(active);
    } catch {
      // keep stale data on error
    } finally {
      if (mountedRef.current) setOwnLoading(false);
    }
  }, []);

  useEffect(() => {
    // No provider → we own the fetch and the poll. Provider → neither, so the
    // page mounts exactly one reader of profiles/list.sh.
    if (!enabled) return;
    fetchActive();
    const id = setInterval(fetchActive, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, fetchActive]);

  // ---------------------------------------------------------------------------
  // Resolve the active record — from the shared list, or from our own fetch
  // ---------------------------------------------------------------------------
  // Destructured before the memo so the deps are the shared instance's stable
  // state values; the context VALUE itself is a fresh object each render and
  // would defeat memoization.
  const sharedProfiles = shared?.profiles;
  const sharedActiveId = shared?.activeProfileId ?? null;

  const activeProfile = useMemo<ProfileSummary | null>(() => {
    if (!sharedProfiles) return ownProfile;
    if (!sharedActiveId) return null;
    return sharedProfiles.find((p) => p.id === sharedActiveId) ?? null;
  }, [sharedProfiles, sharedActiveId, ownProfile]);

  // Minute tick to advance the scheduled-scenario resolution at block edges.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const binding = activeProfile?.scenario ?? null;
  const scheduleLocked = !!binding?.schedule.enabled;

  const scheduledScenarioId = useMemo(() => {
    if (!binding || !scheduleLocked) return null;
    return resolveScheduledScenario(now, binding.schedule, binding.default);
  }, [binding, scheduleLocked, now]);

  const nextChangeAt = useMemo(() => {
    if (!binding || !scheduleLocked) return null;
    return computeNextChangeAt(now, binding.schedule, binding.default);
  }, [binding, scheduleLocked, now]);

  return {
    activeProfile,
    isLoading: shared ? shared.isLoading : ownLoading,
    // Under a provider, refreshing has to refresh the SHARED list — a private
    // refetch would update nothing anyone reads.
    refresh: shared ? shared.refresh : fetchActive,
    scheduleLocked,
    scheduledScenarioId,
    nextChangeAt,
    lockProfileName: scheduleLocked ? activeProfile?.name ?? null : null,
  };
}

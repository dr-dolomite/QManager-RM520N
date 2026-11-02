"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// usePingProfile — Fetch & Save Hook for the four probe target slots
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
//
// GET returns { success: true, settings: { profile, interval_override,
// target_host_1, target_host_2, target_ip_1, target_ip_2, ... } }. The profile
// picks the debounce windows; `interval_override` is the cadence the Connection
// Watchdog owns, and it shadows the profile's own cadence.
//
// POST { action: "save_settings", profile, <the four slots> } writes the file and
// pokes /tmp/qmanager_ping_reload; the daemon reloads on the next cycle.
//
// --- Why four slots, in this order -------------------------------------------
// The daemon walks the chain in a fixed order and SHORT-CIRCUITS on the first
// success:
//
//   target_host_1 → target_host_2 → target_ip_1 → target_ip_2
//
// The two hostname legs come first so the RESOLVER, not a config key, decides
// the address family — that is what retired the old v4/v6 slot pair. The two
// IPv4 literal legs are the fallback for the case the hostname legs cannot
// cover: a broken resolver. A hostname in a literal slot would fail for the
// same reason the hostname legs already did, which is why the CGI rejects one.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/settings/ping_profile.sh";

export const PING_PROFILES = ["sensitive", "regular", "relaxed", "quiet"] as const;
export type PingProfile = (typeof PING_PROFILES)[number];

export interface PingProfileTargets {
  profile: PingProfile;
  target_host_1: string;
  target_host_2: string;
  target_ip_1: string;
  target_ip_2: string;
}

interface PingProfileResponse {
  success: boolean;
  settings?: Partial<Omit<PingProfileTargets, "profile">> & {
    profile?: string;
    interval_override?: number | null;
  };
  error?: string;
  detail?: string;
}

export interface UsePingProfileReturn {
  /** The four saved slots, or undefined until the first GET resolves. */
  targets: PingProfileTargets | undefined;
  /** The Watchdog's stored cadence in seconds, or null when the profile's own applies. */
  intervalOverride: number | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (settings: PingProfileTargets) => Promise<PingProfileResponse>;
  isClearing: boolean;
  /** Drops the Watchdog's stored cadence so the profile's own applies. Throws on failure. */
  clearInterval: () => Promise<void>;
  /** Re-runs the GET non-silently — the Retry affordance for the error state. */
  refresh: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePingProfile(): UsePingProfileReturn {
  const [targets, setTargets] = useState<PingProfileTargets | undefined>(
    undefined,
  );
  const [intervalOverride, setIntervalOverride] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchProfile = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json: PingProfileResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        throw new Error(json.detail ?? json.error ?? "Failed to load targets");
      }

      // The CGI defaults every slot independently, so a complete chain always
      // comes back. `?? ""` is only a type narrowing, not a fallback policy —
      // an empty string renders as an empty field the user must fill, which is
      // the honest reading of a slot the backend could not supply.
      const s = json.settings;
      setIntervalOverride(
        typeof s.interval_override === "number" ? s.interval_override : null,
      );
      setTargets({
        profile: PING_PROFILES.find((p) => p === s.profile) ?? "relaxed",
        target_host_1: s.target_host_1 ?? "",
        target_host_2: s.target_host_2 ?? "",
        target_ip_1: s.target_ip_1 ?? "",
        target_ip_2: s.target_ip_2 ?? "",
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load targets");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Wrapped so a caller cannot pass `silent` and suppress the loading state.
  const refresh = useCallback(() => fetchProfile(), [fetchProfile]);

  const save = useCallback(
    async (settings: PingProfileTargets): Promise<PingProfileResponse> => {
      setSaveError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_settings",
            profile: settings.profile,
            target_host_1: settings.target_host_1,
            target_host_2: settings.target_host_2,
            target_ip_1: settings.target_ip_1,
            target_ip_2: settings.target_ip_2,
          }),
        });

        const json: PingProfileResponse = await resp.json();
        if (!mountedRef.current) return json;

        if (!json.success) {
          throw new Error(json.detail ?? json.error ?? "Save failed");
        }

        setTargets({ ...settings });
        fetchProfile(true);

        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        if (mountedRef.current) setSaveError(msg);
        throw err;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchProfile],
  );

  const clearInterval = useCallback(async (): Promise<void> => {
    setIsClearing(true);
    try {
      const resp = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_interval" }),
      });
      const json: PingProfileResponse = await resp.json();
      if (!json.success) {
        throw new Error(json.detail ?? json.error ?? "Clear failed");
      }
      if (mountedRef.current) setIntervalOverride(null);
      await fetchProfile(true);
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  }, [fetchProfile]);

  return {
    targets,
    intervalOverride,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
    isClearing,
    clearInterval,
    refresh,
  };
}

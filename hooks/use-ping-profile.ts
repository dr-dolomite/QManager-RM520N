"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// usePingProfile — Fetch & Save Hook for the four probe target slots
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
//
// GET returns { success: true, settings: { target_host_1, target_host_2,
// target_ip_1, target_ip_2, ... } }. The endpoint may still echo a `profile`
// label — we ignore it. Probe timing (cadence + failure threshold) is owned by
// the Connection Watchdog, so this hook is targets-only.
//
// POST { action: "save_settings", <the four slots> } writes the file and pokes
// /tmp/qmanager_ping_reload; the daemon reloads its chain on the next cycle.
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

export interface PingProfileTargets {
  target_host_1: string;
  target_host_2: string;
  target_ip_1: string;
  target_ip_2: string;
}

interface PingProfileResponse {
  success: boolean;
  settings?: Partial<PingProfileTargets> & { profile?: string };
  error?: string;
  detail?: string;
}

export interface UsePingProfileReturn {
  /** The four saved slots, or undefined until the first GET resolves. */
  targets: PingProfileTargets | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (settings: PingProfileTargets) => Promise<PingProfileResponse>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePingProfile(): UsePingProfileReturn {
  const [targets, setTargets] = useState<PingProfileTargets | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      setTargets({
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

  return {
    targets,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}

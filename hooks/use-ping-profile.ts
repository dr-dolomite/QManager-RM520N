"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// usePingProfile — Fetch & Save Hook for the probe targets
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
//
// GET returns { success: true, settings: { target_ipv4, target_ipv6, ... } }. The
// endpoint may still echo a legacy `profile` field — we ignore it. Probe timing
// (cadence + failure threshold) is now owned by the Connection Watchdog, so this
// hook is targets-only.
// POST { action: "save_settings", target_ipv4, target_ipv6 } writes the file and
// pokes /tmp/qmanager_ping_reload; the daemon reloads its targets on the next cycle.
// The two targets are DNS hosts the ICMP-port daemon pings — IPv4 first, IPv6 as
// the fallback so an IPv6-only bearer is never reported as down.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/settings/ping_profile.sh";

interface PingProfileSettings {
  target_ipv4: string;
  target_ipv6: string;
}

interface PingProfileResponse {
  success: boolean;
  settings?: PingProfileSettings;
  error?: string;
  detail?: string;
}

export interface UsePingProfileReturn {
  targetIpv4: string | undefined;
  targetIpv6: string | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (settings: {
    target_ipv4: string;
    target_ipv6: string;
  }) => Promise<PingProfileResponse>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePingProfile(): UsePingProfileReturn {
  const [targetIpv4, setTargetIpv4] = useState<string | undefined>(undefined);
  const [targetIpv6, setTargetIpv6] = useState<string | undefined>(undefined);
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

      setTargetIpv4(json.settings.target_ipv4);
      setTargetIpv6(json.settings.target_ipv6);
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
    async (settings: {
      target_ipv4: string;
      target_ipv6: string;
    }): Promise<PingProfileResponse> => {
      setSaveError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_settings",
            target_ipv4: settings.target_ipv4,
            target_ipv6: settings.target_ipv6,
          }),
        });

        const json: PingProfileResponse = await resp.json();
        if (!mountedRef.current) return json;

        if (!json.success) {
          throw new Error(json.detail ?? json.error ?? "Save failed");
        }

        setTargetIpv4(settings.target_ipv4);
        setTargetIpv6(settings.target_ipv6);
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
    targetIpv4,
    targetIpv6,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}

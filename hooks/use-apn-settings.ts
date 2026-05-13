"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { CurrentApnProfile } from "@/types/sim-profile";
import type {
  ApnSettingsResponse,
  ApnSaveRequest,
  ApnSaveResponse,
} from "@/types/apn-settings";

// =============================================================================
// useApnSettings — One-Shot APN Fetch & Save Hook
// =============================================================================
// Fetches carrier profiles and active CID on mount.
// Provides saveApn for applying APN changes (+ optional TTL/HL) via POST.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/apn.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/apn.sh";

export interface UseApnSettingsReturn {
  /** All carrier profiles from AT+CGDCONT? (null before first fetch) */
  profiles: CurrentApnProfile[] | null;
  /** CID with WAN connectivity (null before first fetch) */
  activeCid: number | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Apply APN change (+ optional TTL/HL). Returns true on success. */
  saveApn: (request: ApnSaveRequest) => Promise<boolean>;
  /** Re-fetch all APN data from the modem */
  refresh: () => void;
}

export function useApnSettings(): UseApnSettingsReturn {
  const [profiles, setProfiles] = useState<CurrentApnProfile[] | null>(null);
  const [activeCid, setActiveCid] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch carrier profiles + active CID
  // ---------------------------------------------------------------------------
  const fetchApn = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ApnSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch APN settings");
        return;
      }

      setProfiles(data.profiles);
      setActiveCid(data.active_cid);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch APN settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchApn();
  }, [fetchApn]);

  // ---------------------------------------------------------------------------
  // Save APN change
  // ---------------------------------------------------------------------------
  const saveApn = useCallback(
    async (request: ApnSaveRequest): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ApnSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to apply APN settings");
          return false;
        }

        // AT+COPS=0 inside the CGI kicks off reattach; bearer comes back over
        // the next ~5–15s depending on signal. Wait briefly before the silent
        // refetch — too short and we'll show the old +CGPADDR/+QMAP state.
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Re-fetch to show actual modem state (silent — no skeleton)
        await fetchApn(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to apply APN settings"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchApn]
  );

  return {
    profiles,
    activeCid,
    isLoading,
    isSaving,
    error,
    saveApn,
    refresh: fetchApn,
  };
}

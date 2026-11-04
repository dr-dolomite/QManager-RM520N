"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { CurrentModemSettings } from "@/types/sim-profile";

// =============================================================================
// useCurrentSettings — One-Shot Modem Settings Query Hook
// =============================================================================
// Fetches current modem settings (APN, IMEI, ICCID) for pre-filling
// the profile creation form. Called once on demand, not on a timer.
//
// The CGI endpoint queries the modem via qcmd, so it is the ONE endpoint on the
// Custom SIM Profiles page that takes the AT flock — everything else there
// (profiles/list.sh, scenarios/list.sh, apply_status.sh) is a plain disk read.
//
// MEASURED ON HARDWARE, 2026-08-02: ~0.22s uncontended, 0.47s worst case when it
// queues behind a poller AT cycle. This comment previously claimed "2-3 seconds",
// which was wrong by an order of magnitude and directly motivated an
// optimization investigation that turned out to have nothing to optimize. If you
// are about to design around this endpoint being slow: re-measure first.
//
// Usage:
//   const { settings, isLoading, error, refresh } = useCurrentSettings();
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/profiles/current_settings.sh";

export interface UseCurrentSettingsReturn {
  /** Current modem settings (null before first fetch) */
  settings: CurrentModemSettings | null;
  /** True while fetching */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually trigger a fresh query */
  refresh: () => void;
}

export function useCurrentSettings(
  /** If true, fetch immediately on mount. Default: false (fetch on demand via refresh). */
  fetchOnMount: boolean = false
): UseCurrentSettingsReturn {
  const [settings, setSettings] = useState<CurrentModemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: CurrentModemSettings = await resp.json();
      if (!mountedRef.current) return;

      setSettings(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to query current modem settings"
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (fetchOnMount) {
      fetchSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOnMount]);

  return {
    settings,
    isLoading,
    error,
    refresh: fetchSettings,
  };
}

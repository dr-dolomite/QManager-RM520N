"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  MbnProfile,
  MbnSettingsResponse,
  MbnSaveRequest,
  MbnSaveResponse,
} from "@/types/mbn-settings";

// =============================================================================
// useMbnSettings — One-Shot MBN Fetch & Save Hook
// =============================================================================
// Fetches MBN auto-select status and profile list on mount.
// Provides saveMbn for applying changes and rebootDevice for triggering reboot.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/mbn.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/mbn.sh";

export interface UseMbnSettingsReturn {
  /** All MBN profiles (null before first fetch) */
  profiles: MbnProfile[] | null;
  /** Auto-select status: 1 = enabled, 0 = disabled (null before first fetch) */
  autoSel: number | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Apply MBN changes. Returns true on success. */
  saveMbn: (request: MbnSaveRequest) => Promise<boolean>;
  /** Trigger device reboot. Returns true if command was sent. */
  rebootDevice: () => Promise<boolean>;
  /** Re-fetch MBN data from the modem */
  refresh: () => void;
}

export function useMbnSettings(): UseMbnSettingsReturn {
  const [profiles, setProfiles] = useState<MbnProfile[] | null>(null);
  const [autoSel, setAutoSel] = useState<number | null>(null);
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
  // Fetch MBN auto-select status + profile list
  // ---------------------------------------------------------------------------
  const fetchMbn = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await fetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: MbnSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch MBN settings");
        return;
      }

      setProfiles(data.profiles);
      setAutoSel(data.auto_sel);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch MBN settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchMbn();
  }, [fetchMbn]);

  // ---------------------------------------------------------------------------
  // Save MBN change (apply profile or toggle auto-select)
  // ---------------------------------------------------------------------------
  const saveMbn = useCallback(
    async (request: MbnSaveRequest): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await fetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: MbnSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to apply MBN settings");
          return false;
        }

        // Silent re-fetch to update local state (no skeleton)
        await fetchMbn(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to apply MBN settings"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchMbn]
  );

  // ---------------------------------------------------------------------------
  // Reboot device (separate from save — called from reboot dialog)
  // ---------------------------------------------------------------------------
  const rebootDevice = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await fetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reboot" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: MbnSaveResponse = await resp.json();
      return data.success;
    } catch {
      return false;
    }
  }, []);

  return {
    profiles,
    autoSel,
    isLoading,
    isSaving,
    error,
    saveMbn,
    rebootDevice,
    refresh: fetchMbn,
  };
}

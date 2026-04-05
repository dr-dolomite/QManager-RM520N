"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SystemSettings,
  ScheduleConfig,
  SystemSettingsResponse,
} from "@/types/system-settings";

// =============================================================================
// useSystemSettings — Fetch & Save Hook for System Settings
// =============================================================================
// Fetches all system settings on mount (preferences + schedules).
// Provides separate save functions for each settings group.
//
// Backend: GET/POST /cgi-bin/quecmanager/system/settings.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/settings.sh";

// ─── Save Payload Types ───────────────────────────────────────────────────

export interface SaveSettingsPayload {
  action: "save_settings";
  hostname?: string;
  temp_unit?: "celsius" | "fahrenheit";
  distance_unit?: "km" | "miles";
  timezone?: string;
  zonename?: string;
  sms_tool_device?: string; // "" = default (smd11), "/dev/smd7" = alternate
}

export interface SaveScheduledRebootPayload {
  action: "save_scheduled_reboot";
  enabled: boolean;
  time: string;
  days: number[];
}

export interface UseSystemSettingsReturn {
  settings: SystemSettings | null;
  scheduledReboot: ScheduleConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<boolean>;
  saveScheduledReboot: (payload: SaveScheduledRebootPayload) => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSystemSettings(): UseSystemSettingsReturn {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [scheduledReboot, setScheduledReboot] =
    useState<ScheduleConfig | null>(null);
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
  // Fetch current settings
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SystemSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError("Failed to fetch system settings");
        return;
      }

      setSettings(json.settings);
      setScheduledReboot(json.scheduled_reboot);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch system settings",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Generic POST helper
  // ---------------------------------------------------------------------------
  const postAction = useCallback(
    async (
      payload:
        | SaveSettingsPayload
        | SaveScheduledRebootPayload,
    ): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save settings");
          return false;
        }

        // Use response data directly when available (avoids re-fetch race),
        // fall back to silent re-fetch for actions that don't return full state.
        if (json.scheduled_reboot) {
          setScheduledReboot(json.scheduled_reboot);
        } else if (json.low_power) {
          // Future: setLowPower(json.low_power) when low power hook exists
        }

        // Re-fetch for save_settings (preferences) which doesn't return
        // schedule data — and to sync any other state we didn't capture above.
        if (payload.action === "save_settings") {
          await fetchSettings(true);
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save settings",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings],
  );

  // ---------------------------------------------------------------------------
  // Per-action save wrappers
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    (payload: SaveSettingsPayload) => postAction(payload),
    [postAction],
  );

  const saveScheduledReboot = useCallback(
    (payload: SaveScheduledRebootPayload) => postAction(payload),
    [postAction],
  );

  return {
    settings,
    scheduledReboot,
    isLoading,
    isSaving,
    error,
    saveSettings,
    saveScheduledReboot,
    refresh: fetchSettings,
  };
}

// =============================================================================
// useUnitPreferences — Lightweight hook for dashboard unit display
// =============================================================================
// Fetches unit preferences on mount. Used by device-metrics.tsx to display
// temperature in °F and distance in miles when configured.
// =============================================================================

interface UnitPreferences {
  tempUnit: "celsius" | "fahrenheit";
  distanceUnit: "km" | "miles";
}

export function useUnitPreferences(): UnitPreferences | null {
  const [prefs, setPrefs] = useState<UnitPreferences | null>(null);

  useEffect(() => {
    let cancelled = false;

    authFetch(CGI_ENDPOINT)
      .then((r) => r.json())
      .then((json: SystemSettingsResponse) => {
        if (!cancelled && json.success && json.settings) {
          setPrefs({
            tempUnit: json.settings.temp_unit || "celsius",
            distanceUnit: json.settings.distance_unit || "km",
          });
        }
      })
      .catch(() => {
        // Fallback to defaults on error
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return prefs;
}

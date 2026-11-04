"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  DeviceClock,
  DeviceClockReading,
  SystemSettings,
  ScheduleConfig,
  SystemSettingsResponse,
  ScheduledRebootSaveResult,
} from "@/types/system-settings";

export type { ScheduledRebootSaveResult } from "@/types/system-settings";

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

// ─── Save Response Types ──────────────────────────────────────────────────

// Outcome of pushing the configured timezone to the live device clock.
// "failed" = config saved, but the clock apply did not take (e.g. sudoers not
// yet rolled out, or zone data missing).
export type TimezoneApplyStatus =
  | "applied"
  | "failed"
  | "not_attempted"
  | "invalid";

// Shared shape for the POST responses handled by postAction(). Fields are
// optional because they vary by action (save_settings vs save_scheduled_reboot).
interface SaveResponse {
  success: boolean;
  detail?: string;
  error?: string;
  scheduled_reboot?: ScheduleConfig;
  // Whether save_scheduled_reboot actually armed a live systemd timer on this
  // device (vs. merely persisting config). See ScheduledRebootSaveResult.
  armed?: boolean;
  reason?: string;
  timezone_apply_status?: TimezoneApplyStatus;
}

/**
 * What a preferences save returns. Callers toast from this and never from the
 * hook's `error`, which describes the last READ only.
 */
export interface SaveResult {
  success: boolean;
  /** The device's reason, translated through `resolveErrorMessage`. Absent when none was given. */
  message?: string;
  /** The zone was saved but did not reach the live clock (partial success). */
  timezoneNotApplied?: boolean;
}

// Internal outcome returned by postAction — carries the raw success plus the
// arm status so saveScheduledReboot can surface an honest toast.
interface PostActionResult {
  success: boolean;
  armed?: boolean;
  reason?: string;
  rejection?: string;
  rejectionDetail?: string;
  timezoneNotApplied?: boolean;
}

export interface UseSystemSettingsReturn {
  settings: SystemSettings | null;
  scheduledReboot: ScheduleConfig | null;
  /** The modem's clock as of the last read; null before one or on an old backend. */
  deviceClock: DeviceClockReading | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Last READ failed: a localized sentence, never raw transport text. */
  error: string | null;
  /** The device's own reason for that failure, when it gave one. */
  errorDetail: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<SaveResult>;
  saveScheduledReboot: (
    payload: SaveScheduledRebootPayload,
  ) => Promise<ScheduledRebootSaveResult>;
  refresh: (silent?: boolean) => Promise<void>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/** A clock reading the UI can tick from; an epoch of 0 means the device could not read it. */
function toClockReading(clock: DeviceClock | undefined): DeviceClockReading | null {
  if (!clock || !(clock.epoch > 0) || typeof clock.local !== "string") return null;
  return { ...clock, receivedAt: Date.now() };
}

export function useSystemSettings(): UseSystemSettingsReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [scheduledReboot, setScheduledReboot] =
    useState<ScheduleConfig | null>(null);
  const [deviceClock, setDeviceClock] = useState<DeviceClockReading | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Held in a ref so a language switch does not rebuild fetchSettings and refetch.
  const tRef = useRef(t);
  tRef.current = t;

  // Responses settle out of order, so every request claims a sequence at ISSUE
  // time and a late one that lost the race is dropped instead of applied.
  const reqSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

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
    const seq = ++reqSeqRef.current;
    if (!silent) setIsLoading(true);
    setError(null);
    setErrorDetail(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error();

      const json = (await resp.json()) as SystemSettingsResponse & {
        error?: string;
        detail?: string;
      };
      if (!mountedRef.current) return;
      // A newer answer already landed, so this one is stale by definition.
      if (seq <= appliedSeqRef.current) return;
      appliedSeqRef.current = seq;

      if (!json.success) {
        const reason = resolveErrorMessage(tRef.current, json.error, json.detail, "").trim();
        setError(reason || tRef.current("unknown"));
        setErrorDetail(reason || null);
        return;
      }

      setSettings(json.settings);
      setScheduledReboot(json.scheduled_reboot);
      setDeviceClock(toClockReading(json.device_clock));
    } catch {
      if (!mountedRef.current) return;
      if (seq <= appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      // Transport failures carry no device reason; HTTP/network text stays out of the UI.
      setError(tRef.current("unknown"));
    } finally {
      // Deliberately unsequenced: gating this would strand the spinner whenever
      // a silent refetch supersedes a visible one and never clears it.
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
    ): Promise<PostActionResult> => {
      const seq = ++reqSeqRef.current;
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) throw new Error();

        const json: SaveResponse = await resp.json();
        if (!mountedRef.current) return { success: false };

        if (!json.success) {
          return {
            success: false,
            rejection: json.error,
            rejectionDetail: json.detail,
          };
        }

        // Use response data directly when available (avoids re-fetch race),
        // fall back to silent re-fetch for actions that don't return full state.
        if (json.scheduled_reboot && seq > appliedSeqRef.current) {
          appliedSeqRef.current = seq;
          setScheduledReboot(json.scheduled_reboot);
        }

        // Re-fetch for save_settings (preferences) which doesn't return
        // schedule data — and to sync any other state we didn't capture above.
        // The silent re-fetch also pulls the fresh timezone ground-truth fields
        // (effective_offset / timezone_applied) so the card can render its badge.
        if (payload.action === "save_settings") {
          await fetchSettings(true);
        }

        // Arm status lets the reboot card warn on an unarmed schedule; the zone
        // flag lets the preferences card warn instead of claiming success.
        return {
          success: true,
          armed: json.armed,
          reason: json.reason,
          timezoneNotApplied: json.timezone_apply_status === "failed",
        };
      } catch {
        if (!mountedRef.current) return { success: false };
        // No device reason on a transport failure; the "network" token has its own copy.
        return { success: false, rejection: "network" };
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
    async (payload: SaveSettingsPayload): Promise<SaveResult> => {
      const result = await postAction(payload);
      if (result.success) {
        return { success: true, timezoneNotApplied: result.timezoneNotApplied };
      }
      // A transport failure has no device reason; the caller's generic line covers it.
      if (result.rejection === "network") return { success: false };
      const message = resolveErrorMessage(
        t,
        result.rejection,
        result.rejectionDetail,
        "",
      );
      return { success: false, message: message || undefined };
    },
    [postAction, t],
  );

  const saveScheduledReboot = useCallback(
    (payload: SaveScheduledRebootPayload): Promise<ScheduledRebootSaveResult> =>
      postAction(payload),
    [postAction],
  );

  return {
    settings,
    scheduledReboot,
    deviceClock,
    isLoading,
    isSaving,
    error,
    errorDetail,
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

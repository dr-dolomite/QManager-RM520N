"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WatchdogSettings {
  enabled: boolean;
  /** Consecutive failed PROBES (raw ping streak) before recovery begins. */
  fail_threshold: number;
  /** Ping probe cadence in seconds. The watchdog owns this and propagates it to the ping daemon on save. */
  probe_interval: number;
  check_interval: number;
  cooldown: number;
  tier1_enabled: boolean;
  tier2_enabled: boolean;
  tier3_enabled: boolean;
  tier4_enabled: boolean;
  backup_sim_slot: number | null;
  max_reboots_per_hour: number;
}

export type WatchdogSavePayload = WatchdogSettings & {
  action: "save_settings";
};

export interface WatchdogLiveStatus {
  timestamp: number;
  enabled: boolean;
  state: string;
  current_tier: number;
  failure_count: number;
  last_recovery_time: number | null;
  last_recovery_tier: number | null;
  total_recoveries: number;
  cooldown_remaining: number;
  sim_failover_active: boolean;
  original_sim_slot: number | null;
  current_sim_slot: number | null;
  reboots_this_hour: number;
}

export interface SimFailoverInfo {
  active: boolean;
  original_slot?: number;
  current_slot?: number;
  switched_at?: number;
}

export interface SimSwapInfo {
  detected: boolean;
  matching_profile_id?: string;
  matching_profile_name?: string;
  dismissed?: boolean;
}

export interface UseWatchdogSettingsReturn {
  settings: WatchdogSettings | null;
  status: WatchdogLiveStatus | null;
  simFailover: SimFailoverInfo | null;
  simSwap: SimSwapInfo | null;
  autoDisabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<boolean>;
  dismissSimSwap: () => Promise<boolean>;
  revertSim: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useWatchdogSettings(): UseWatchdogSettingsReturn {
  const [settings, setSettings] = useState<WatchdogSettings | null>(null);
  const [status, setStatus] = useState<WatchdogLiveStatus | null>(null);
  const [simFailover, setSimFailover] = useState<SimFailoverInfo | null>(null);
  const [simSwap, setSimSwap] = useState<SimSwapInfo | null>(null);
  const [autoDisabled, setAutoDisabled] = useState(false);
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
  // Fetch current settings + live status
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch watchdog settings");
        return;
      }

      // Defensive defaults: the frozen backend always emits fail_threshold +
      // probe_interval, but guard the rename so an older/partial envelope during
      // an OTA rollout can't seed the form with NaN.
      setSettings({
        ...json.settings,
        fail_threshold: json.settings?.fail_threshold ?? 5,
        probe_interval: json.settings?.probe_interval ?? 5,
      });
      setStatus(json.status && json.status.timestamp ? json.status : null);
      setSimFailover(json.sim_failover || null);
      setSimSwap(json.sim_swap || null);
      setAutoDisabled(json.auto_disabled === true);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch watchdog settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    // Silent background refresh so the live status hero and counter strip stay
    // current without flashing the skeleton on every tick.
    const id = setInterval(() => fetchSettings(true), 30_000);
    return () => clearInterval(id);
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Save settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: WatchdogSavePayload): Promise<boolean> => {
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
          setError(json.error || "Failed to save watchdog settings");
          return false;
        }

        // Silent re-fetch to sync state
        await fetchSettings(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save settings"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings]
  );

  // ---------------------------------------------------------------------------
  // Dismiss SIM swap notification
  // ---------------------------------------------------------------------------
  const dismissSimSwap = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_sim_swap" }),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      if (!mountedRef.current) return false;

      if (json.success) {
        setSimSwap((prev) =>
          prev ? { ...prev, detected: false, dismissed: true } : prev
        );
      }
      return json.success;
    } catch {
      return false;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Request SIM revert (watchcat picks up the flag)
  // ---------------------------------------------------------------------------
  const revertSim = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert_sim" }),
      });

      if (!resp.ok) return false;

      const json = await resp.json();
      return json.success;
    } catch {
      return false;
    }
  }, []);

  return {
    settings,
    status,
    simFailover,
    simSwap,
    autoDisabled,
    isLoading,
    isSaving,
    error,
    saveSettings,
    dismissSimSwap,
    revertSim,
    refresh: fetchSettings,
  };
}

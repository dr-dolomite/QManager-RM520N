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
  /** Hold the ladder while the baseband restarts itself (absent on older backends). */
  ssr_aware?: boolean;
  /** Longest hold, seconds. */
  ssr_grace?: number;
  /** Start a Tier 1-2 recovery when the link stays over the quality limits. */
  quality_enabled?: boolean;
  /** Consecutive over-limit checks before that recovery starts. */
  quality_consecutive?: number;
  /** While on the backup SIM, periodically try the primary again. */
  primary_recheck_enabled?: boolean;
  /** Minutes between those tries. */
  primary_recheck_interval?: number;
}

/** The limits the quality trigger uses: Connection Quality's, raised to the watchdog's floors. */
export interface WatchdogQualityLimits {
  latency_ms: number;
  loss_pct: number;
}

export type WatchdogSavePayload = Omit<WatchdogSettings, "check_interval"> & {
  action: "save_settings";
  /** Optional on the wire. The CGI writes the key only when it is present, so
   *  omitting it preserves the server's value instead of clobbering it. */
  check_interval?: number;
};

// The CGI also returns `status` and `sim_failover`. Neither is read here: the
// page takes both from the poller snapshot, which is the fresher source.

// NOTE: SIM-swap state is NOT surfaced here. It lives in the persistent SIM
// registry (`system/sim_registry.sh` + `hooks/use-sim-registry.ts`) and is read
// for display through `status.json.sim_swap`; the watchdog endpoint no longer
// owns a dismiss action.

/**
 * The save outcome, RETURNED rather than only stored. `error` state is set in
 * the same tick, so a caller's closure still holds the pre-call value and the
 * backend's reason was being dropped on every failure.
 */
export interface WatchdogSaveResult {
  ok: boolean;
  /** The backend's own sentence when it sent one. Already human-readable. */
  message: string | null;
  /** The rejected field's backend name, when the failure names one. */
  field: string | null;
}

export interface UseWatchdogSettingsReturn {
  settings: WatchdogSettings | null;
  autoDisabled: boolean;
  /** Epoch seconds of the watchdog's own Tier-4 reboots, newest first. */
  recentReboots: number[];
  /** Null on an older backend that does not report them. */
  qualityLimits: WatchdogQualityLimits | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<WatchdogSaveResult>;
  revertSim: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useWatchdogSettings(): UseWatchdogSettingsReturn {
  const [settings, setSettings] = useState<WatchdogSettings | null>(null);
  const [autoDisabled, setAutoDisabled] = useState(false);
  const [recentReboots, setRecentReboots] = useState<number[]>([]);
  const [qualityLimits, setQualityLimits] = useState<WatchdogQualityLimits | null>(null);
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
        ssr_aware: json.settings?.ssr_aware ?? true,
        ssr_grace: json.settings?.ssr_grace ?? 45,
        quality_enabled: json.settings?.quality_enabled ?? false,
        quality_consecutive: json.settings?.quality_consecutive ?? 5,
        primary_recheck_enabled: json.settings?.primary_recheck_enabled ?? false,
        primary_recheck_interval: json.settings?.primary_recheck_interval ?? 30,
      });
      const ql = json.quality_limits;
      setQualityLimits(
        ql && Number.isFinite(ql.latency_ms) && Number.isFinite(ql.loss_pct)
          ? { latency_ms: ql.latency_ms, loss_pct: ql.loss_pct }
          : null,
      );
      setAutoDisabled(json.auto_disabled === true);
      // Absent on older backends: no history, not an error.
      setRecentReboots(
        Array.isArray(json.recent_reboots)
          ? json.recent_reboots.filter(
              (v: unknown): v is number =>
                typeof v === "number" && Number.isFinite(v),
            )
          : [],
      );
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
    async (payload: WatchdogSavePayload): Promise<WatchdogSaveResult> => {
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
        if (!mountedRef.current) return { ok: false, message: null, field: null };

        if (!json.success) {
          // `error` is a machine token ("invalid_field"); `reason` is the
          // sentence the two-pass validator wrote. Prefer the sentence.
          const message =
            typeof json.reason === "string" && json.reason
              ? json.reason
              : typeof json.error === "string" && json.error
                ? json.error
                : null;
          setError(message ?? "Failed to save watchdog settings");
          return {
            ok: false,
            message,
            field: typeof json.field === "string" ? json.field : null,
          };
        }

        // Silent re-fetch to sync state
        await fetchSettings(true);
        return { ok: true, message: null, field: null };
      } catch (err) {
        if (!mountedRef.current) return { ok: false, message: null, field: null };
        const message =
          err instanceof Error ? err.message : "Failed to save settings";
        setError(message);
        return { ok: false, message, field: null };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings]
  );

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
    autoDisabled,
    recentReboots,
    qualityLimits,
    isLoading,
    isSaving,
    error,
    saveSettings,
    revertSim,
    refresh: fetchSettings,
  };
}

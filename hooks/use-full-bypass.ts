"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { FullBypassStatus } from "@/types/traffic-engine";

// =============================================================================
// useFullBypass — Traffic Engine Full Bypass status & control hook
// =============================================================================
// Renamed from useTrafficMasquerade (2026-09-01) along with the mode itself:
// tpws has no fake-SNI mode, so nothing was ever masqueraded on this platform.
// See types/traffic-engine.ts > DpiMode.
//
// Fetches the full-bypass section status (?section=full_bypass) on mount and
// re-polls on the same 2s cadence as useVideoOptimizer (the two share one
// engine; both cards show live state). Provides save (enabled + sni_domain).
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/video_optimizer.sh?section=full_bypass
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 2000;

export interface UseFullBypassReturn {
  data: FullBypassStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (enabled: boolean, sniDomain: string) => Promise<boolean>;
  /**
   * Re-read the section. See `UseVideoOptimizerReturn.refresh` — the two hooks
   * are read together by one shell and must expose the same signature, or the
   * shell can only make half of a mode-switch refetch silent, which leaves the
   * unmount in place.
   */
  refresh: (silent?: boolean) => void;
}

export function useFullBypass(): UseFullBypassReturn {
  const [data, setData] = useState<FullBypassStatus | null>(null);
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

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const resp = await authFetch(`${CGI_ENDPOINT}?section=full_bypass`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch Full Bypass status");
        return;
      }

      setData({
        success: true,
        enabled: json.enabled,
        status: json.status,
        uptime: json.uptime,
        packets_processed: json.packets_processed ?? 0,
        domains_loaded: json.domains_loaded ?? 0,
        binary_installed: json.binary_installed,
        kernel_module_loaded: json.kernel_module_loaded,
        sni_domain: json.sni_domain ?? "speedtest.net",
        force_tcp: json.force_tcp,
        force_tcp_active: json.force_tcp_active,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch Full Bypass status");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus(true), POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const save = useCallback(
    async (enabled: boolean, sniDomain: string): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_full_bypass", enabled, sni_domain: sniDomain }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save Full Bypass settings");
          return false;
        }
        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save Full Bypass settings");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchStatus],
  );

  return { data, isLoading, isSaving, error, save, refresh: fetchStatus };
}
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { MasqueradeStatus } from "@/types/traffic-engine";

// =============================================================================
// useTrafficMasquerade — Traffic Engine Masquerade status & control hook
// =============================================================================
// Fetches the masquerade section status (?section=masquerade) on mount and
// re-polls on the same 2s cadence as useVideoOptimizer (the two share one
// engine; both cards show live state). Provides save (enabled + sni_domain).
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/video_optimizer.sh?section=masquerade
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 2000;

export interface UseTrafficMasqueradeReturn {
  data: MasqueradeStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (enabled: boolean, sniDomain: string) => Promise<boolean>;
  refresh: () => void;
}

export function useTrafficMasquerade(): UseTrafficMasqueradeReturn {
  const [data, setData] = useState<MasqueradeStatus | null>(null);
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
      const resp = await authFetch(`${CGI_ENDPOINT}?section=masquerade`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch masquerade status");
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
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch masquerade status");
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
          body: JSON.stringify({ action: "save_masquerade", enabled, sni_domain: sniDomain }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save masquerade settings");
          return false;
        }
        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save masquerade settings");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchStatus],
  );

  return { data, isLoading, isSaving, error, save, refresh: fetchStatus };
}
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useForceTcp — QUIC Force-TCP status & control hook (standalone)
// =============================================================================
// Self-contained fetch of the same engine CGI GET (reads force_tcp +
// force_tcp_active) and the save_force_tcp POST. Deliberately does NOT read
// the engine hooks' data or states: the Force-TCP tile is fully independent
// of the engine — binary install/uninstall and engine enable/disable never
// touch this rule, so nothing engine-shaped should leak into this hook
// (and nothing in here should break the engine sections if it fails).
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/video_optimizer.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";

export interface ForceTcpStatus {
  /** Config intent from quic.force_tcp. */
  force_tcp: boolean;
  /** Live rule presence on bridge0 FORWARD. */
  force_tcp_active: boolean;
}

export interface UseForceTcpReturn {
  data: ForceTcpStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (enabled: boolean) => Promise<boolean>;
  refresh: () => void;
}

export function useForceTcp(): UseForceTcpReturn {
  const [data, setData] = useState<ForceTcpStatus | null>(null);
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
  // Fetch status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch QUIC status");
        return;
      }
      setData({
        force_tcp: json.force_tcp ?? false,
        force_tcp_active: json.force_tcp_active ?? false,
      });
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch QUIC status");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Save enable/disable (auto-applies the iptables rule on the CGI side)
  // ---------------------------------------------------------------------------
  const save = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_force_tcp", enabled }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save QUIC Force-TCP");
          return false;
        }
        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save QUIC Force-TCP");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchStatus],
  );

  return {
    data,
    isLoading,
    isSaving,
    error,
    save,
    refresh: fetchStatus,
  };
}
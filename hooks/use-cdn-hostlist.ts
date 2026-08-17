"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useCdnHostlist — Traffic Engine Video Optimizer hostlist hook
// =============================================================================
// Reads the hostlist (?action=hostlist) and saves it (?action=save_hostlist).
// The hostlist lives at /etc/qmanager/video_domains.txt; tpws hot-reloads it
// (--hostlist-auto-reload), so a save takes effect without engine restart.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/video_optimizer.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";

export interface UseCdnHostlistReturn {
  domains: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveDomains: (domains: string[]) => Promise<boolean>;
  refresh: () => void;
}

export function useCdnHostlist(): UseCdnHostlistReturn {
  const [domains, setDomains] = useState<string[]>([]);
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

  const fetchHostlist = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const resp = await authFetch(`${CGI_ENDPOINT}?section=hostlist`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch hostlist");
        return;
      }
      setDomains(Array.isArray(json.domains) ? json.domains : []);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch hostlist");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHostlist();
  }, [fetchHostlist]);

  const saveDomains = useCallback(
    async (next: string[]): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_hostlist", domains: next }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save hostlist");
          return false;
        }
        await fetchHostlist(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save hostlist");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchHostlist],
  );

  return { domains, isLoading, isSaving, error, saveDomains, refresh: fetchHostlist };
}
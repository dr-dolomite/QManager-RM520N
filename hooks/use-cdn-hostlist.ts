"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { MutationResult } from "@/types/mutation-result";

// Video Optimizer hostlist over network/video_optimizer.sh; tpws hot-reloads a
// saved list. The caller holds the draft and passes the whole list to save.

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";

export interface UseCdnHostlistReturn {
  /** The saved list, as the device last answered it. */
  domains: string[];
  /** The factory list, read from the same GET (empty on an older CGI). */
  defaultDomains: string[];
  isLoading: boolean;
  isSaving: boolean;
  isRestoring: boolean;
  error: string | null;
  /** Writes the whole list. The CGI accepts an empty list; callers must refuse one. */
  saveHostlist: (domains: string[]) => Promise<MutationResult>;
  restoreDefaults: () => Promise<MutationResult>;
  refresh: (silent?: boolean) => void;
}

export function useCdnHostlist(): UseCdnHostlistReturn {
  const [domains, setDomains] = useState<string[]>([]);
  const [defaultDomains, setDefaultDomains] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
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
      setDefaultDomains(Array.isArray(json.default_domains) ? json.default_domains : []);
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

  /** One POST, its result returned so the caller toasts the real outcome. */
  const post = useCallback(
    async (
      body: Record<string, unknown>,
      setBusy: (busy: boolean) => void,
      fallback: string,
    ): Promise<MutationResult> => {
      setError(null);
      setBusy(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return { ok: false, error: null };

        if (!json.success) {
          // Return the backend's code and detail as sent; local fallbacks stay in `error` state.
          const reason = json.detail || json.error || null;
          setError(reason ?? fallback);
          return { ok: false, error: json.error || null, detail: json.detail || null };
        }
        await fetchHostlist(true);
        return { ok: true, error: null };
      } catch (err) {
        if (!mountedRef.current) return { ok: false, error: null };
        const msg = err instanceof Error ? err.message : fallback;
        setError(msg);
        return { ok: false, error: null };
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [fetchHostlist],
  );

  const saveHostlist = useCallback(
    (next: string[]) =>
      post({ action: "save_hostlist", domains: next }, setIsSaving, "Failed to save hostlist"),
    [post],
  );

  const restoreDefaults = useCallback(
    () => post({ action: "restore_hostlist" }, setIsRestoring, "Failed to restore hostlist"),
    [post],
  );

  return {
    domains,
    defaultDomains,
    isLoading,
    isSaving,
    isRestoring,
    error,
    saveHostlist,
    restoreDefaults,
    refresh: fetchHostlist,
  };
}

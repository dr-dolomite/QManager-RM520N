"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { HostlistResponse } from "@/types/video-optimizer";

const API_URL = "/cgi-bin/quecmanager/network/video_optimizer.sh";

export function useCdnHostlist() {
  const [domains, setDomains] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchHostlist = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(`${API_URL}?section=hostlist`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: HostlistResponse = await response.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError("Failed to load hostname list");
        return;
      }

      setDomains(data.domains);
      setCount(data.count);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch hostname list"
      );
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  const saveHostlist = useCallback(
    async (newDomains: string[]): Promise<boolean> => {
      setIsSaving(true);
      setError(null);

      try {
        const response = await authFetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_hostlist", domains: newDomains }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!data.success) {
          setError(data.detail || "Failed to save hostname list");
          return false;
        }

        await fetchHostlist(true);
        return true;
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : "Failed to save hostname list"
          );
        }
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchHostlist]
  );

  const restoreDefaults = useCallback(async (): Promise<boolean> => {
    setIsRestoring(true);
    setError(null);

    try {
      const response = await authFetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_hostlist" }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success) {
        setError(data.detail || "Failed to restore defaults");
        return false;
      }

      await fetchHostlist(true);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error ? err.message : "Failed to restore defaults"
        );
      }
      return false;
    } finally {
      if (mountedRef.current) setIsRestoring(false);
    }
  }, [fetchHostlist]);

  useEffect(() => {
    fetchHostlist();
  }, [fetchHostlist]);

  return {
    domains,
    count,
    isLoading,
    isSaving,
    isRestoring,
    error,
    saveHostlist,
    restoreDefaults,
    refresh: fetchHostlist,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  LanConfigResponse,
  LanConfigSaveRequest,
  LanConfigSaveResponse,
} from "@/types/lan-config";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/lan_config.sh";

export function useLanConfig() {
  const [data, setData] = useState<LanConfigResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchConfig = useCallback(async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const result: LanConfigResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!result.success) {
        setError(result.detail || result.error || "Failed to fetch LAN config");
        return;
      }

      setData(result);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch LAN config");
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(
    async (
      settings: Omit<LanConfigSaveRequest, "action">,
    ): Promise<LanConfigSaveResponse | null> => {
      setIsSaving(true);
      setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", ...settings }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: LanConfigSaveResponse = await resp.json();
        if (!mountedRef.current) return null;

        if (!result.success) {
          setError(result.detail || result.error || "Failed to save LAN config");
          return result;
        }

        await fetchConfig(true);
        return result;
      } catch (err) {
        if (!mountedRef.current) return null;
        setError(err instanceof Error ? err.message : "Failed to save LAN config");
        return null;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchConfig],
  );

  return {
    data,
    isLoading,
    isRefreshing,
    isSaving,
    error,
    refresh: () => fetchConfig(true),
    saveConfig,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import type { AdaptivePollingSettings, PollerTier } from "@/types/modem-status";

// GET  -> { success, settings, isDefault, tier }  (tier = what the poller runs at now)
// POST -> { action: "save", ...settings } -> { success } | { success: false, error, detail }
// CGI: /cgi-bin/quecmanager/system/adaptive_polling.sh

const ENDPOINT = "/cgi-bin/quecmanager/system/adaptive_polling.sh";
const TIER_REFRESH_MS = 10_000;

interface AdaptivePollingGetResponse {
  success: boolean;
  settings?: AdaptivePollingSettings;
  isDefault?: boolean;
  tier?: PollerTier;
  error?: string;
  detail?: string;
}

interface AdaptivePollingSaveResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

export type AdaptivePollingSaveResult =
  { success: true } | { success: false; error?: string; detail?: string };

export interface UseAdaptivePollingReturn {
  settings: AdaptivePollingSettings | undefined;
  isDefault: boolean;
  tier: PollerTier | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (next: AdaptivePollingSettings) => Promise<AdaptivePollingSaveResult>;
  refresh: () => void;
}

export function useAdaptivePolling(): UseAdaptivePollingReturn {
  const [settings, setSettings] = useState<AdaptivePollingSettings | undefined>(
    undefined,
  );
  const [isDefault, setIsDefault] = useState(false);
  const [tier, setTier] = useState<PollerTier | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // `silent` is the background tier refresh: no skeleton, no error over a populated card.
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent && mountedRef.current) setIsLoading(true);
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json: AdaptivePollingGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        if (!silent)
          setError(
            json.detail || json.error || "Failed to load adaptive polling",
          );
        setIsLoading(false);
        return;
      }

      setSettings(json.settings);
      setIsDefault(json.isDefault ?? false);
      setTier(json.tier);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      if (!silent) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load adaptive polling",
        );
      }
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchSettings();
    const stop = startVisibleInterval(
      () => fetchSettings(true),
      TIER_REFRESH_MS,
    );
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [fetchSettings]);

  const save = useCallback(
    async (
      next: AdaptivePollingSettings,
    ): Promise<AdaptivePollingSaveResult> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        const response = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", ...next }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const json: AdaptivePollingSaveResponse = await response.json();
        if (!json.success) {
          if (mountedRef.current)
            setSaveError(json.detail || json.error || "Failed to save");
          return { success: false, error: json.error, detail: json.detail };
        }
        if (mountedRef.current) {
          // An explicit save writes the section, so defaults no longer apply.
          setSettings(next);
          setIsDefault(false);
        }
        return { success: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Failed to save";
        if (mountedRef.current) setSaveError(detail);
        return { success: false, detail };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [],
  );

  return {
    settings,
    isDefault,
    tier,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
    refresh: fetchSettings,
  };
}

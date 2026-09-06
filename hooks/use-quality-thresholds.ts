"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { QualityThresholdsSettings } from "@/types/modem-status";

// =============================================================================
// useQualityThresholds — Fetch & Save Hook for Latency & Loss Thresholds
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh
//
// GET returns { success, settings: QualityThresholdsSettings, is_default }.
// POST { action: "save_settings", ...QualityThresholdsSettings } writes the
// config and pokes /tmp/qmanager_events_reload; events.sh picks up the
// change at the start of its next detection cycle.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/settings/quality_thresholds.sh";

interface QualityThresholdsResponse {
  success: boolean;
  settings?: QualityThresholdsSettings;
  is_default?: boolean;
  error?: string;
  detail?: string;
}

export interface UseQualityThresholdsReturn {
  thresholds: QualityThresholdsSettings | undefined;
  isDefault: boolean;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (next: QualityThresholdsSettings) => Promise<QualityThresholdsResponse>;
  /** Re-runs the GET non-silently — the Retry affordance for the error state. */
  refresh: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQualityThresholds(): UseQualityThresholdsReturn {
  const [thresholds, setThresholds] = useState<
    QualityThresholdsSettings | undefined
  >(undefined);
  const [isDefault, setIsDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current thresholds
  // ---------------------------------------------------------------------------
  const fetchThresholds = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json: QualityThresholdsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        throw new Error(
          json.detail ?? json.error ?? "Failed to load thresholds",
        );
      }

      setThresholds(json.settings);
      setIsDefault(Boolean(json.is_default));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load thresholds",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchThresholds();
  }, [fetchThresholds]);

  // Wrapped so a caller cannot pass `silent` and suppress the loading state.
  const refresh = useCallback(() => fetchThresholds(), [fetchThresholds]);

  // ---------------------------------------------------------------------------
  // Save thresholds
  // ---------------------------------------------------------------------------
  const save = useCallback(
    async (
      next: QualityThresholdsSettings,
    ): Promise<QualityThresholdsResponse> => {
      setSaveError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_settings",
            latency: next.latency,
            loss: next.loss,
          }),
        });

        const json: QualityThresholdsResponse = await resp.json();
        if (!mountedRef.current) return json;

        if (!json.success) {
          throw new Error(json.detail ?? json.error ?? "Save failed");
        }

        // Optimistic update + silent re-fetch (clears is_default to false).
        setThresholds(next);
        fetchThresholds(true);

        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        if (mountedRef.current) setSaveError(msg);
        throw err;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchThresholds],
  );

  return {
    thresholds,
    isDefault,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
    refresh,
  };
}

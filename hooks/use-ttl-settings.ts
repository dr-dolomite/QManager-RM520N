"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { MutationResult } from "@/types/mutation-result";

// =============================================================================
// useTtlSettings — One-Shot TTL/HL Fetch & Save Hook
// =============================================================================
// Fetches current TTL and HL values on mount.
// Provides saveTtlHl for applying new values.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/ttl.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ttl.sh";
const K = "ttlMtu";

// ttl.sh's persist_failed means "live but not saved"; the shared errors key is worded for config restore.
const ttlCode = (code: unknown) =>
  code === "persist_failed" ? "ttl_persist_failed" : typeof code === "string" ? code : null;

export interface TtlSettingsData {
  /** Whether custom TTL/HL is currently active */
  isEnabled: boolean;
  /** Current TTL value (0 = default / disabled) */
  ttl: number;
  /** Current HL value (0 = default / disabled) */
  hl: number;
  /** Whether TTL/HL is set to autostart on boot */
  autostart: boolean;
}

export interface UseTtlSettingsReturn {
  /** Current TTL/HL data (null before first fetch) */
  data: TtlSettingsData | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Apply new TTL/HL values. Returns true on success. */
  saveTtlHl: (ttl: number, hl: number) => Promise<MutationResult>;
  /** Re-fetch TTL/HL data */
  refresh: () => void;
}

export function useTtlSettings(): UseTtlSettingsReturn {
  const { t } = useTranslation("common");
  // Read through a ref so a language switch does not rebuild the callbacks and re-run the mount fetch.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [data, setData] = useState<TtlSettingsData | null>(null);
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
  // Fetch current TTL/HL values
  // ---------------------------------------------------------------------------
  const fetchTtl = useCallback(async (silent = false) => {
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
        const tr = tRef.current;
        setError(resolveErrorMessage(tr, ttlCode(json.error), json.detail, tr(`${K}.ttl_load_error`)));
        return;
      }

      setData({
        isEnabled: json.is_enabled,
        ttl: json.ttl,
        hl: json.hl,
        autostart: json.autostart,
      });
    } catch {
      if (!mountedRef.current) return;
      setError(tRef.current(`${K}.ttl_load_error`));
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchTtl();
  }, [fetchTtl]);

  // ---------------------------------------------------------------------------
  // Save TTL/HL values
  // ---------------------------------------------------------------------------
  const saveTtlHl = useCallback(
    async (ttl: number, hl: number): Promise<MutationResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ttl, hl }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return { ok: false, error: null };

        if (!json.success) {
          const tr = tRef.current;
          const message = resolveErrorMessage(tr, ttlCode(json.error), json.detail, tr(`${K}.toast_ttl_error`));
          setError(message);
          return { ok: false, error: message };
        }

        // Silent re-fetch to update local state
        await fetchTtl(true);
        return { ok: true, error: null };
      } catch {
        if (!mountedRef.current) return { ok: false, error: null };
        const message = tRef.current(`${K}.toast_ttl_error`);
        setError(message);
        return { ok: false, error: message };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchTtl],
  );

  return {
    data,
    isLoading,
    isSaving,
    error,
    saveTtlHl,
    refresh: fetchTtl,
  };
}

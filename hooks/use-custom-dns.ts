"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  CustomDnsSettingsResponse,
  CustomDnsSaveRequest,
  CustomDnsClearRequest,
  CustomDnsSaveResponse,
} from "@/types/custom-dns";

// =============================================================================
// useCustomDns — Fetch & Save Hook for Custom DNS Settings
// =============================================================================
// Fetches the current dnsmasq upstream configuration on mount and exposes
// saveSettings + clearSettings actions. dnsmasq is reloaded via SIGHUP
// (sub-second, non-destructive) — no reboot is needed.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/custom_dns.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/custom_dns.sh";

export interface CustomDnsApplyData {
  enabled: boolean;
  ignoreCarrier: boolean;
  /** 0..4 upstream resolvers (IPv4 or IPv6). Will be joined with commas for the wire format. */
  servers: string[];
}

/** Field-level error returned by the CGI when validation fails. */
export interface CustomDnsFieldError {
  field?: string;
  message: string;
}

export interface UseCustomDnsReturn {
  /** Latest server response — null before first fetch. */
  settings: CustomDnsSettingsResponse | null;
  /** True while initial fetch is in progress. */
  isLoading: boolean;
  /** True while a save/clear request is in flight. */
  isSaving: boolean;
  /** Top-level fetch or transport error. */
  error: string | null;
  /** Field-level error from the most recent save attempt (cleared on next save). */
  fieldError: CustomDnsFieldError | null;
  /**
   * Persist the upstream-DNS configuration. dnsmasq is reloaded via SIGHUP on
   * the device. Returns true if the apply succeeded.
   */
  saveSettings: (data: CustomDnsApplyData) => Promise<boolean>;
  /** Remove the QManager block entirely — falls back to carrier DNS. */
  clearSettings: () => Promise<boolean>;
  /** Re-fetch settings. */
  refresh: () => void;
}

export function useCustomDns(): UseCustomDnsReturn {
  const [settings, setSettings] = useState<CustomDnsSettingsResponse | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<CustomDnsFieldError | null>(
    null
  );

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data = (await resp.json()) as CustomDnsSettingsResponse;
      if (!mountedRef.current) return;

      setSettings(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch Custom DNS settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Apply settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (data: CustomDnsApplyData): Promise<boolean> => {
      setError(null);
      setFieldError(null);
      setIsSaving(true);

      try {
        const request: CustomDnsSaveRequest = {
          action: "save",
          enabled: data.enabled,
          ignore_carrier: data.ignoreCarrier,
          servers: data.servers.join(","),
        };

        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        const result = (await resp.json()) as CustomDnsSaveResponse;
        if (!mountedRef.current) return false;

        if (!resp.ok || !result.ok) {
          const message =
            (result as { error?: string }).error ||
            `HTTP ${resp.status}: ${resp.statusText}`;
          const field = (result as { field?: string }).field;
          setFieldError({ field, message });
          setError(message);
          return false;
        }

        setSettings(result.applied);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        const message =
          err instanceof Error ? err.message : "Failed to apply settings";
        setError(message);
        setFieldError({ message });
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Clear (remove the QManager block)
  // ---------------------------------------------------------------------------
  const clearSettings = useCallback(async (): Promise<boolean> => {
    setError(null);
    setFieldError(null);
    setIsSaving(true);

    try {
      const request: CustomDnsClearRequest = { action: "clear" };
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const result = (await resp.json()) as CustomDnsSaveResponse;
      if (!mountedRef.current) return false;

      if (!resp.ok || !result.ok) {
        const message =
          (result as { error?: string }).error ||
          `HTTP ${resp.status}: ${resp.statusText}`;
        setError(message);
        return false;
      }

      setSettings(result.applied);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(
        err instanceof Error ? err.message : "Failed to clear settings"
      );
      return false;
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    error,
    fieldError,
    saveSettings,
    clearSettings,
    refresh: fetchSettings,
  };
}

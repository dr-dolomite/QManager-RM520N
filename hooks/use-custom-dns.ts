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
// Fetches the current dnsmasq upstream configuration on mount and exposes a
// save action. dnsmasq is reloaded via SIGHUP (sub-second, non-destructive) —
// no reboot is needed.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/custom_dns.sh
//
// -----------------------------------------------------------------------------
// `blockCorrupt` REACHES COMPONENTS THROUGH `settings`, AND THAT IS DELIBERATE
// -----------------------------------------------------------------------------
// `blockCorrupt?: boolean` is declared on `CustomDnsSettingsResponse` and this
// hook returns the parsed payload verbatim, so `settings.blockCorrupt` is
// already the whole path. It is NOT re-exported as a second top-level field.
//
// A duplicated field would look like a fix and behave like a hazard: two names
// for one truth, one of which is a snapshot taken at a moment the other has
// since moved past. The reason the flag was invisible for so long was never that
// it was unreachable — it was that no component read it, so a malformed dnsmasq
// block rendered identically to a healthy one. That is fixed in the components,
// which is the only place it could have been fixed.
//
// -----------------------------------------------------------------------------
// `clearSettings` IS EXPORTED AND DELIBERATELY HAS NO CALL SITE
// -----------------------------------------------------------------------------
// It posts `action=clear`, which the CGI maps onto save-with-`enabled=false`.
// That path runs the sentinel stripper, and the stripper raises its in-block
// flag on the BEGIN marker and lowers it only on END.
//
// A "damaged block" is DEFINED as one marker without the other. So invoking this
// in the exact state where a repair button would be offered — BEGIN present, END
// missing — drops every remaining line of `/etc/data/dnsmasq.conf`:
// `listen-address`, `dhcp-authoritative`, `conf-dir`. `dnsmasq --test` passes it,
// because the truncated file is syntactically valid and merely missing
// directives; `sudo mv` then installs it and `killall -HUP dnsmasq` makes it
// live, on a device the operator is reaching over that same LAN.
//
// The UI therefore WARNS about a damaged block and offers no in-app repair. Do
// not wire this to a button. If a future backend gains a marker-repair verb that
// is safe by construction, that verb — not this one — is what the button calls.
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
  /**
   * Remove the QManager block entirely — falls back to carrier DNS.
   *
   * DELIBERATELY UNWIRED. See the module header: in the one state a caller would
   * want it (a damaged sentinel block) it destroys the rest of `dnsmasq.conf`.
   */
  clearSettings: () => Promise<boolean>;
  /**
   * Re-fetch settings.
   *
   * THE SIGNATURE IS THE POINT. `silent` suppresses the loading state for a
   * background poll, and typing this as `() => void` made `onClick={refresh}`
   * compile — which hands React's MouseEvent to `silent`, so a user-initiated
   * refresh ran with its own spinner suppressed and the button looked inert for
   * the whole request. Declaring the parameter makes that call site a type
   * error, and `onClick={() => refresh()}` the only spelling that builds.
   */
  refresh: (silent?: boolean) => Promise<void>;
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

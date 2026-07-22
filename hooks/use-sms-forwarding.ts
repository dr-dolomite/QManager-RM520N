"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SmsForwardingData,
  SmsForwardingSavePayload,
  SmsForwardingResponse,
  SmsForwardingActionResponse,
} from "@/types/sms-forwarding";

// =============================================================================
// useSmsForwarding — Fetch & Save Hook for SMS Forwarding
// =============================================================================
// Reads the forwarding daemon's settings + its persistent failure state, and
// provides save / test / clear-failures actions.
//
// The daemon is the only server-side inbox reader: when it abandons a message
// after repeated failed sends it appends to a failure list that this hook
// surfaces so the UI can raise a persistent alert even when the user wasn't on
// the page. That's why we poll: a background failure should appear without a
// manual refresh.
//
// Backend: GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms_forwarding.sh";
// Quiet background poll for the failure state while mounted.
const FAILURE_POLL_MS = 20000;

export interface UseSmsForwardingReturn {
  /** Current forwarding data (null before first fetch) */
  data: SmsForwardingData | null;
  /** True while the initial fetch is in progress */
  isLoading: boolean;
  /** True while a save is in progress */
  isSaving: boolean;
  /** True while a test send is in progress */
  isSendingTest: boolean;
  /** True while clearing the failure list */
  isClearing: boolean;
  /** Error message if any operation failed */
  error: string | null;
  /** Persist enable + target. Returns true on success. */
  saveSettings: (payload: SmsForwardingSavePayload) => Promise<boolean>;
  /** Send a test forward to the SAVED target (body is ignored server-side). */
  sendTest: () => Promise<boolean>;
  /** Acknowledge / clear the persistent failure list. */
  clearFailures: () => Promise<boolean>;
  /** Re-fetch. Pass true for a silent (no-skeleton, no-clobber) refresh. */
  refresh: (silent?: boolean) => void;
}

export function useSmsForwarding(): UseSmsForwardingReturn {
  const [data, setData] = useState<SmsForwardingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch settings + failure state
  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    if (!silent) setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsForwardingResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        // A working view shouldn't be clobbered by a background poll failure.
        if (!silent) {
          setError(
            json.detail || json.error || "Failed to fetch forwarding settings",
          );
        }
        return;
      }

      setData({
        settings: {
          enabled: !!json.settings?.enabled,
          target_phone: json.settings?.target_phone ?? "",
        },
        failures: Array.isArray(json.failures) ? json.failures : [],
        failure_count:
          typeof json.failure_count === "number"
            ? json.failure_count
            : Array.isArray(json.failures)
              ? json.failures.length
              : 0,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      // Silent (poll) failures shouldn't clobber a working view with an error.
      if (!silent) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch forwarding settings",
        );
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Quiet background poll for the failure state
  useEffect(() => {
    const id = setInterval(() => {
      fetchData(true);
    }, FAILURE_POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Save settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: SmsForwardingSavePayload): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_settings", ...payload }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsForwardingActionResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save settings");
          return false;
        }

        await fetchData(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save settings");
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchData],
  );

  // ---------------------------------------------------------------------------
  // Send a test forward to the configured target
  // ---------------------------------------------------------------------------
  const sendTest = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsSendingTest(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_test" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsForwardingActionResponse = await resp.json();
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to send test message");
        return false;
      }
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(
        err instanceof Error ? err.message : "Failed to send test message",
      );
      return false;
    } finally {
      if (mountedRef.current) {
        setIsSendingTest(false);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Clear (acknowledge) the failure state
  // ---------------------------------------------------------------------------
  const clearFailures = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsClearing(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_failures" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsForwardingActionResponse = await resp.json();
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to clear alerts");
        return false;
      }

      await fetchData(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to clear alerts");
      return false;
    } finally {
      if (mountedRef.current) {
        setIsClearing(false);
      }
    }
  }, [fetchData]);

  return {
    data,
    isLoading,
    isSaving,
    isSendingTest,
    isClearing,
    error,
    saveSettings,
    sendTest,
    clearFailures,
    refresh: fetchData,
  };
}

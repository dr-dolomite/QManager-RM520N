"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SmsForwardingData,
  SmsForwardingSavePayload,
} from "@/types/sms-forwarding";

// =============================================================================
// useSmsForwarding — Fetch & Save Hook for SMS Forwarding
// =============================================================================
// Reads the forwarding daemon's settings + its persistent failure state, and
// provides save / test / clear-failures actions.
//
// The daemon is the only server-side inbox reader: when it abandons a message
// after 3 failed sends it appends to a failure list that this hook surfaces so
// the UI can raise a persistent alert even when the user wasn't on the page.
//
// Backend: GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms_forwarding.sh";
// Poll the failure state while mounted so a background failure surfaces without
// a manual refresh. Quiet interval — the daemon itself polls every 15s.
const FAILURE_POLL_MS = 20000;
const K = "sms.forwarding.errors";

/** A mutation's outcome; `error` is already resolved for display. */
export type SmsForwardingResult = { ok: true } | { ok: false; error: string };

export interface UseSmsForwardingReturn {
  data: SmsForwardingData | null;
  isLoading: boolean;
  isSaving: boolean;
  isSendingTest: boolean;
  isClearing: boolean;
  /** Why the last foreground READ failed (translated). Mutations return theirs. */
  error: string | null;
  saveSettings: (payload: SmsForwardingSavePayload) => Promise<SmsForwardingResult>;
  sendTest: () => Promise<SmsForwardingResult>;
  clearFailures: () => Promise<SmsForwardingResult>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSmsForwarding(): UseSmsForwardingReturn {
  const { t } = useTranslation("cellular");
  // Read through a ref: `t` in the callbacks' deps would rebuild them on a
  // language switch and re-arm the poll.
  const tRef = useRef(t);
  tRef.current = t;
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
  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      if (!silent) setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              tRef.current,
              json.error,
              json.detail,
              tRef.current(`${K}.load_failed`),
            ),
          );
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
      } catch {
        if (!mountedRef.current) return;
        // Silent (poll) failures shouldn't clobber a working view with an error.
        if (!silent) {
          setError(tRef.current(`${K}.load_failed`));
        }
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

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
    async (payload: SmsForwardingSavePayload): Promise<SmsForwardingResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_settings", ...payload }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              tRef.current, json.error, json.detail, tRef.current(`${K}.save_failed`)),
          };
        }
        if (mountedRef.current) await fetchData(true);
        return { ok: true };
      } catch {
        return { ok: false, error: tRef.current(`${K}.save_failed`) };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchData],
  );

  // ---------------------------------------------------------------------------
  // Send a test forward to the configured target
  // ---------------------------------------------------------------------------
  const sendTest = useCallback(
    async (): Promise<SmsForwardingResult> => {
      setIsSendingTest(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_test" }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              tRef.current, json.error, json.detail, tRef.current(`${K}.test_failed`)),
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: tRef.current(`${K}.test_failed`) };
      } finally {
        if (mountedRef.current) setIsSendingTest(false);
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Clear (acknowledge) the failure state
  // ---------------------------------------------------------------------------
  const clearFailures = useCallback(
    async (): Promise<SmsForwardingResult> => {
      setIsClearing(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear_failures" }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              tRef.current, json.error, json.detail, tRef.current(`${K}.clear_failed`)),
          };
        }
        if (mountedRef.current) await fetchData(true);
        return { ok: true };
      } catch {
        return { ok: false, error: tRef.current(`${K}.clear_failed`) };
      } finally {
        if (mountedRef.current) setIsClearing(false);
      }
    },
    [fetchData],
  );

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

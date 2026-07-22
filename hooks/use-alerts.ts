"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  AlertsState,
  AlertsSavePayload,
  AlertChannel,
  InstallResult,
} from "@/types/alerts";

// =============================================================================
// useAlerts — one hook for the whole centralized Alerts surface
// =============================================================================
// Fetches the combined {channels, routing, capabilities} state, saves it in a
// single atomic POST, sends per-channel tests against the real send path, and
// drives the msmtp mailer install lifecycle for the email channel.
//
// Backend: GET/POST /cgi-bin/quecmanager/monitoring/alerts.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/alerts.sh";

export interface UseAlertsReturn {
  state: AlertsState | null;
  isLoading: boolean;
  isSaving: boolean;
  testingChannel: AlertChannel | null;
  installResult: InstallResult;
  error: string | null;
  saveSettings: (payload: AlertsSavePayload) => Promise<boolean>;
  sendTest: (channel: AlertChannel) => Promise<boolean>;
  runInstall: () => Promise<void>;
  refresh: () => void;
}

export function useAlerts(): UseAlertsReturn {
  const [state, setState] = useState<AlertsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingChannel, setTestingChannel] = useState<AlertChannel | null>(
    null,
  );
  const [installResult, setInstallResult] = useState<InstallResult>({
    success: true,
    status: "idle",
  });
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installPollRef.current) clearInterval(installPollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch combined state
  // ---------------------------------------------------------------------------
  const fetchState = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to load alert settings");
        return;
      }

      setState({
        channels: json.channels,
        routing: json.routing,
        capabilities: json.capabilities,
        reboots: Array.isArray(json.reboots) ? json.reboots : [],
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load alert settings",
      );
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // ---------------------------------------------------------------------------
  // Save (one atomic POST covering all channels + routing)
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: AlertsSavePayload): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save settings");
          return false;
        }

        await fetchState(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save settings");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchState],
  );

  // ---------------------------------------------------------------------------
  // Per-channel test send (real path, gated on saved config by the caller)
  // ---------------------------------------------------------------------------
  const sendTest = useCallback(
    async (channel: AlertChannel): Promise<boolean> => {
      setError(null);
      setTestingChannel(channel);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_test", channel }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to send test");
          return false;
        }
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to send test");
        return false;
      } finally {
        if (mountedRef.current) setTestingChannel(null);
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // msmtp install lifecycle (email channel only)
  // ---------------------------------------------------------------------------
  const stopInstallPolling = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  const pollInstallStatus = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_status" }),
      });
      if (!resp.ok) return;
      const data: InstallResult = await resp.json();
      if (!mountedRef.current) return;
      setInstallResult(data);
      if (data.status === "complete" || data.status === "error") {
        stopInstallPolling();
        await fetchState(true);
      }
    } catch {
      // Silently retry on the next poll tick.
    }
  }, [stopInstallPolling, fetchState]);

  const runInstall = useCallback(async () => {
    setInstallResult({
      success: true,
      status: "running",
      message: "Starting installation…",
    });
    try {
      await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_msmtp" }),
      });
      installPollRef.current = setInterval(pollInstallStatus, 2000);
    } catch (err) {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to start installation",
        });
      }
    }
  }, [pollInstallStatus]);

  return {
    state,
    isLoading,
    isSaving,
    testingChannel,
    installResult,
    error,
    saveSettings,
    sendTest,
    runInstall,
    refresh: fetchState,
  };
}

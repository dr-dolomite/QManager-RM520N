"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useEmailAlerts — Fetch & Save Hook for Email Alert Settings
// =============================================================================
// Fetches current email alert configuration on mount.
// Provides saveSettings for persisting changes and sendTestEmail for testing.
//
// Backend: GET/POST /cgi-bin/quecmanager/monitoring/email_alerts.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/email_alerts.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmailAlertsSettings {
  enabled: boolean;
  sender_email: string;
  recipient_email: string;
  /** Stored app password (empty string if not set) */
  app_password: string;
  threshold_minutes: number;
}

export interface EmailAlertsSavePayload {
  action: "save_settings";
  enabled: boolean;
  sender_email: string;
  recipient_email: string;
  /** Only included when user has typed a new password */
  app_password?: string;
  threshold_minutes: number;
}

export interface UseEmailAlertsReturn {
  settings: EmailAlertsSettings | null;
  msmtpInstalled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isSendingTest: boolean;
  error: string | null;
  saveSettings: (payload: EmailAlertsSavePayload) => Promise<boolean>;
  sendTestEmail: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useEmailAlerts(): UseEmailAlertsReturn {
  const [settings, setSettings] = useState<EmailAlertsSettings | null>(null);
  const [msmtpInstalled, setMsmtpInstalled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch email alert settings");
        return;
      }

      setMsmtpInstalled(json.msmtp_installed !== false);
      setSettings(json.settings);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch email alert settings",
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
  // Save settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: EmailAlertsSavePayload): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save settings");
          return false;
        }

        // Silent re-fetch to sync app_password_set
        await fetchSettings(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save settings",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings],
  );

  // ---------------------------------------------------------------------------
  // Send test email
  // ---------------------------------------------------------------------------
  const sendTestEmail = useCallback(async (): Promise<boolean> => {
    setIsSendingTest(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_test" }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      if (!mountedRef.current) return false;
      return json.success;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) {
        setIsSendingTest(false);
      }
    }
  }, []);

  return {
    settings,
    msmtpInstalled,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    sendTestEmail,
    refresh: fetchSettings,
  };
}

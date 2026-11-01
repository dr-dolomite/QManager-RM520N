"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { enterRebootFlow } from "@/lib/reboot";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  BackupImeiConfig,
  ImeiSettingsResponse,
  ImeiSaveRequest,
  ImeiSaveResponse,
} from "@/types/imei-settings";

// =============================================================================
// useImeiSettings — One-Shot IMEI Fetch & Save Hook
// =============================================================================
// Fetches current IMEI (from poller cache) and backup config on mount.
// Provides saveImei for writing new IMEI, saveBackup for backup config,
// and rebootDevice for triggering reboot.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/imei.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/imei.sh";

export interface UseImeiSettingsReturn {
  /** Current device IMEI (null before first fetch) */
  currentImei: string | null;
  /** Whether backup IMEI is enabled (null before first fetch) */
  backupEnabled: boolean | null;
  /** Backup IMEI value (null before first fetch) */
  backupImei: string | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Write new IMEI to modem NVM. Returns true on success. */
  saveImei: (imei: string) => Promise<boolean>;
  /** Save backup IMEI configuration. Returns true on success. */
  saveBackup: (config: BackupImeiConfig) => Promise<boolean>;
  /** Trigger device reboot. Returns true if command was sent. */
  rebootDevice: () => Promise<boolean>;
  /** Re-fetch IMEI data */
  refresh: () => void;
}

export function useImeiSettings(): UseImeiSettingsReturn {
  const { t } = useTranslation("errors");
  const [currentImei, setCurrentImei] = useState<string | null>(null);
  const [backupEnabled, setBackupEnabled] = useState<boolean | null>(null);
  const [backupImei, setBackupImei] = useState<string | null>(null);
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
  // Fetch current IMEI + backup config
  // ---------------------------------------------------------------------------
  const fetchImei = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ImeiSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(resolveErrorMessage(t, data.error, undefined, "Failed to fetch IMEI settings"));
        return;
      }

      setCurrentImei(data.current_imei);
      setBackupEnabled(data.backup.enabled);
      setBackupImei(data.backup.imei);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch IMEI settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // Fetch on mount
  useEffect(() => {
    fetchImei();
  }, [fetchImei]);

  // ---------------------------------------------------------------------------
  // Save new IMEI (write to modem NVM)
  // ---------------------------------------------------------------------------
  const saveImei = useCallback(
    async (imei: string): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const request: ImeiSaveRequest = { action: "set_imei", imei };
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ImeiSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(resolveErrorMessage(t, data.error, data.detail, "Failed to write IMEI"));
          return false;
        }

        // Silent re-fetch to update local state (no skeleton)
        await fetchImei(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to write IMEI"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchImei, t]
  );

  // ---------------------------------------------------------------------------
  // Save backup IMEI configuration
  // ---------------------------------------------------------------------------
  const saveBackup = useCallback(
    async (config: BackupImeiConfig): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const request: ImeiSaveRequest = {
          action: "save_backup",
          enabled: config.enabled,
          backup_imei: config.imei,
        };
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ImeiSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(
            resolveErrorMessage(t, data.error, data.detail, "Failed to save backup configuration")
          );
          return false;
        }

        // Silent re-fetch to update local state (no skeleton)
        await fetchImei(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save backup configuration"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchImei, t]
  );

  // ---------------------------------------------------------------------------
  // Reboot device (separate from save — called from reboot dialog)
  // ---------------------------------------------------------------------------
  const rebootDevice = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reboot" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ImeiSaveResponse = await resp.json();
      if (data.success) {
        enterRebootFlow("imei");
      }
      return data.success;
    } catch {
      return false;
    }
  }, []);

  return {
    currentImei,
    backupEnabled,
    backupImei,
    isLoading,
    isSaving,
    error,
    saveImei,
    saveBackup,
    rebootDevice,
    refresh: fetchImei,
  };
}

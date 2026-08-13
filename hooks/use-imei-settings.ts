"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
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
  /**
   * Hand off to the reboot countdown page and fire the reboot.
   *
   * Returns nothing on purpose — see the implementation note below. A reboot is
   * never something this app can await.
   */
  rebootDevice: () => void;
  /** Re-fetch IMEI data */
  refresh: () => void;
}

export function useImeiSettings(): UseImeiSettingsReturn {
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
        setError(data.error || "Failed to fetch IMEI settings");
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
  }, []);

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
          setError(data.detail || data.error || "Failed to write IMEI");
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
    [fetchImei]
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
            data.detail || data.error || "Failed to save backup configuration"
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
    [fetchImei]
  );

  // ---------------------------------------------------------------------------
  // Reboot device (separate from save — called from the reboot dialog/banner)
  // ---------------------------------------------------------------------------
  // QManager is served BY the modem it reboots, so the request that starts the
  // reboot kills its own HTTP response. Awaiting it can only ever resolve to a
  // network error, and the incumbent implementation did exactly that: it
  // reported "Reboot failed" on a reboot that was in fact already underway, and
  // left the user sitting on a page whose backend had gone away.
  //
  // The product-wide handoff (nav-user.tsx, mbn-card.tsx, ip-passthrough-card.tsx,
  // use-software-update.ts) is: mark the session, drop the login indicator
  // cookie, fire the request `keepalive` so it survives the navigation, and go
  // to /reboot/ immediately so the countdown page is already in browser memory
  // when the device disappears. This is that flow, nothing more.
  const rebootDevice = useCallback((): void => {
    sessionStorage.setItem("qm_rebooting", "1");
    document.cookie = "qm_logged_in=; Path=/; Max-Age=0";

    const request: ImeiSaveRequest = { action: "reboot" };
    fetch(CGI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      keepalive: true,
    }).catch(() => {});

    window.location.href = "/reboot/";
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

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useSoftwareUpdate — Check, download, install QManager updates
// =============================================================================
// Checks GitHub Releases via the backend CGI on mount.
// Two-step flow: download + verify → install. Polls status during both phases.
//
// Backend: GET/POST /cgi-bin/quecmanager/system/update.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/update.sh";
const POLL_INTERVAL = 2000;
const LAST_CHECKED_KEY = "qm_update_last_checked";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AvailableVersion {
  tag: string;
  has_assets: boolean;
  asset_size: string | null;
  is_current: boolean;
}

export interface DownloadState {
  status: "downloading" | "verifying" | "ready" | "error";
  version: string;
  message?: string;
  size?: string;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  changelog: string | null;
  current_changelog: string | null;
  download_url: string | null;
  download_size: string | null;
  available_versions: AvailableVersion[];
  download_state: DownloadState | null;
  include_prerelease: boolean;
  auto_update_enabled: boolean;
  auto_update_time: string;
  check_error: string | null;
}

export interface UpdateStatus {
  status: "idle" | "downloading" | "installing" | "rebooting" | "error";
  message?: string;
  version?: string;
  size?: string;
}

export interface UseSoftwareUpdateReturn {
  updateInfo: UpdateInfo | null;
  updateStatus: UpdateStatus;
  downloadState: DownloadState | null;
  isLoading: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isDownloading: boolean;
  error: string | null;
  lastChecked: string | null;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: (version?: string) => Promise<void>;
  installStaged: () => Promise<void>;
  installUpdate: () => Promise<void>;
  installVersion: (version: string) => Promise<void>;
  togglePrerelease: (enabled: boolean) => Promise<void>;
  saveAutoUpdate: (enabled: boolean, time: string) => Promise<void>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSoftwareUpdate(): UseSoftwareUpdateReturn {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" });
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    // Load last checked from localStorage
    const stored = localStorage.getItem(LAST_CHECKED_KEY);
    if (stored) setLastChecked(stored);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Poll download status during background download
  // ---------------------------------------------------------------------------
  const startDownloadPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const resp = await authFetch(`${CGI_ENDPOINT}?action=status`);
        if (!resp.ok) return;

        const json = await resp.json();
        if (!mountedRef.current) return;

        setDownloadState(json as DownloadState);

        if (json.status === "ready") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsDownloading(false);
        }

        if (json.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsDownloading(false);
          setError(json.message || "Download failed");
        }
      } catch {
        // Silently retry on next interval
      }
    }, POLL_INTERVAL);
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch update info from CGI
  // ---------------------------------------------------------------------------
  const fetchUpdateInfo = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to check for updates");
        return;
      }

      setUpdateInfo(json as UpdateInfo);

      // Sync download state from backend
      const info = json as UpdateInfo;
      if (info.download_state) {
        setDownloadState(info.download_state);
        if (info.download_state.status === "downloading" || info.download_state.status === "verifying") {
          setIsDownloading(true);
          startDownloadPolling();
        }
      }

      // Update last checked timestamp
      const now = new Date().toISOString();
      localStorage.setItem(LAST_CHECKED_KEY, now);
      setLastChecked(now);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to check for updates");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, [startDownloadPolling]);

  // Fetch on mount
  useEffect(() => {
    fetchUpdateInfo();
  }, [fetchUpdateInfo]);

  // ---------------------------------------------------------------------------
  // Poll update status during install/rollback
  // ---------------------------------------------------------------------------
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const resp = await authFetch(`${CGI_ENDPOINT}?action=status`);
        if (!resp.ok) return;

        const json: UpdateStatus = await resp.json();
        if (!mountedRef.current) return;

        setUpdateStatus(json);

        if (json.status === "rebooting") {
          // Navigate to /reboot/ immediately so the static page loads from
          // lighttpd before the OTA worker fires the reboot syscall. The
          // worker waits for the page's reboot_ack before issuing reboot,
          // so any delay here only widens the race.
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          sessionStorage.setItem("qm_rebooting", "1");
          document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
          window.location.href = "/reboot/";
        }

        if (json.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsUpdating(false);
          setError(json.message || "Update failed");
        }
      } catch {
        // Fetch failed — device is likely rebooting already. Navigate
        // immediately; if the static page is uncached and lighttpd is
        // already gone the user will see a connection error, but waiting
        // doesn't help since the device won't come back any sooner.
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        sessionStorage.setItem("qm_rebooting", "1");
        document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
        window.location.href = "/reboot/";
      }
    }, POLL_INTERVAL);
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    await fetchUpdateInfo(true);
    if (mountedRef.current) setIsChecking(false);
  }, [fetchUpdateInfo]);

  const downloadUpdate = useCallback(async (version?: string) => {
    const targetVersion = version || updateInfo?.latest_version;
    if (!targetVersion) return;

    setError(null);
    setIsDownloading(true);
    setDownloadState({ status: "downloading", version: targetVersion });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", version: targetVersion }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to start download");
        setIsDownloading(false);
        setDownloadState(null);
        return;
      }

      startDownloadPolling();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to start download");
      setIsDownloading(false);
      setDownloadState(null);
    }
  }, [updateInfo, startDownloadPolling]);

  const installStaged = useCallback(async () => {
    setError(null);
    setIsUpdating(true);
    setUpdateStatus({ status: "installing", message: "Installing update..." });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_staged" }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to start installation");
        setIsUpdating(false);
        return;
      }

      startPolling();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to start installation");
      setIsUpdating(false);
    }
  }, [startPolling]);

  // ---------------------------------------------------------------------------
  // Chained poller — used by installVersion to fuse the two-step flow into one
  // click. Both phases write to the same /tmp/qmanager_update.json, so a single
  // setInterval can watch the download phase, fire install_staged once it sees
  // status:"ready", then keep polling through installing → rebooting.
  // ---------------------------------------------------------------------------
  const startChainedPolling = useCallback((version: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let installPosted = false;

    pollRef.current = setInterval(async () => {
      try {
        const resp = await authFetch(`${CGI_ENDPOINT}?action=status`);
        if (!resp.ok) return;

        const json = await resp.json();
        if (!mountedRef.current) return;

        // Map the raw status into the stepper's UpdateStatus shape. Download
        // sub-phases ("downloading", "verifying") collapse to step 0; once we
        // post install_staged below, the next tick reports "installing" and
        // the stepper advances.
        if (json.status === "downloading" || json.status === "verifying") {
          setUpdateStatus({ status: "downloading", message: json.message, version, size: json.size });
        } else if (json.status === "installing" || json.status === "rebooting" || json.status === "error") {
          setUpdateStatus(json as UpdateStatus);
        }

        // Chain step: when the download reports ready, fire install_staged once.
        if (json.status === "ready" && !installPosted) {
          installPosted = true;
          setUpdateStatus({ status: "installing", message: "Installing update...", version });
          await authFetch(CGI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "install_staged" }),
          });
          return; // next tick will pick up the installing/rebooting status
        }

        if (json.status === "rebooting") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          sessionStorage.setItem("qm_rebooting", "1");
          document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
          window.location.href = "/reboot/";
        }

        if (json.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsUpdating(false);
          setError(json.message || "Install failed");
        }
      } catch {
        // Network blink — if we've already posted install_staged, the device is
        // likely rebooting. Mirror startPolling's behavior and redirect.
        if (installPosted) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          sessionStorage.setItem("qm_rebooting", "1");
          document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
          window.location.href = "/reboot/";
        }
      }
    }, POLL_INTERVAL);
  }, []);

  // ---------------------------------------------------------------------------
  // installVersion — one-click chained install for a specific version. Used by
  // Version Management. Backend uses the same two endpoints as the main flow
  // (download → install_staged); the chain happens in the poller above.
  // ---------------------------------------------------------------------------
  const installVersion = useCallback(async (version: string) => {
    if (!version) return;

    setError(null);
    setIsUpdating(true);
    setUpdateStatus({ status: "downloading", version });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", version }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to start install");
        setIsUpdating(false);
        return;
      }

      startChainedPolling(version);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to start install");
      setIsUpdating(false);
    }
  }, [startChainedPolling]);

  const installUpdate = useCallback(async () => {
    if (!updateInfo?.download_url || !updateInfo?.latest_version) return;

    setError(null);
    setIsUpdating(true);
    setUpdateStatus({ status: "downloading", version: updateInfo.latest_version });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          download_url: updateInfo.download_url,
          version: updateInfo.latest_version,
          download_size: updateInfo.download_size,
        }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to start update");
        setIsUpdating(false);
        return;
      }

      startPolling();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to start update");
      setIsUpdating(false);
    }
  }, [updateInfo, startPolling]);

  const togglePrerelease = useCallback(async (enabled: boolean) => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_prerelease", enabled }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to save preference");
        return;
      }

      // Re-check with new preference
      await fetchUpdateInfo(true);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to save preference");
    }
  }, [fetchUpdateInfo]);

  const saveAutoUpdate = useCallback(async (enabled: boolean, time: string) => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_auto_update", enabled, time }),
      });

      const json = await resp.json();
      if (!json.success) {
        setError(json.detail || json.error || "Failed to save auto-update preference");
        return;
      }

      await fetchUpdateInfo(true);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to save auto-update preference");
    }
  }, [fetchUpdateInfo]);

  return {
    updateInfo,
    updateStatus,
    downloadState,
    isLoading,
    isChecking,
    isUpdating,
    isDownloading,
    error,
    lastChecked,
    checkForUpdates,
    downloadUpdate,
    installStaged,
    installUpdate,
    installVersion,
    togglePrerelease,
    saveAutoUpdate,
  };
}

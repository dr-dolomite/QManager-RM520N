"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { rebootNow } from "@/lib/reboot";

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
/** An install whose status has not changed for this long is offered a manual reboot. */
const INSTALL_STALL_TIMEOUT_MS = 120000;

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
  /** An `errors` catalog code on failure; `message` is the worker's English log line. */
  error?: string | null;
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
  check_error_code?: string | null;
  /** A `VERSION.pending` marker survived a reboot — the tree may be mixed. */
  previous_install_failed: boolean;
  pending_version: string | null;
}

export interface UpdateStatus {
  status: "idle" | "downloading" | "installing" | "rebooting" | "error";
  message?: string;
  version?: string;
  size?: string;
  error?: string | null;
}

/** Which operation produced `error`. Seven call sites write one shared string. */
export type UpdateErrorKind = "check" | "download" | "install";

export interface UseSoftwareUpdateReturn {
  updateInfo: UpdateInfo | null;
  updateStatus: UpdateStatus;
  downloadState: DownloadState | null;
  isLoading: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isDownloading: boolean;
  /** The failure reason (an `errors` sentence or the device's words), or `null`. */
  error: string | null;
  errorKind: UpdateErrorKind | null;
  /** The install has reported the same status for 120 s. */
  isInstallStalled: boolean;
  lastChecked: string | null;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: (version?: string) => Promise<void>;
  installStaged: () => Promise<void>;
  installUpdate: () => Promise<void>;
  installVersion: (version: string) => Promise<void>;
  /** Manual reboot offered once an install stalls; the caller confirms it first. */
  rebootDevice: () => void;
  // Both RETURN the failure instead of raising it into `error`: the shared
  // error resolves the whole surface to `check_failed`, and a preference that
  // failed to save is not a failed GitHub check. `null` is success; a string is
  // the resolved reason (an `errors` sentence or the device's words), and `""` means it failed without saying why — the
  // caller owns the sentence, because it knows which row it saved.
  togglePrerelease: (enabled: boolean) => Promise<string | null>;
  saveAutoUpdate: (enabled: boolean, time: string) => Promise<string | null>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSoftwareUpdate(): UseSoftwareUpdateReturn {
  const { t } = useTranslation("errors");
  // A ref, so a language switch does not rebuild `fail` and re-run the mount fetch.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" });
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<UpdateErrorKind | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstallStalled, setIsInstallStalled] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const installStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusSignatureRef = useRef("");

  const clearInstallStallTimer = useCallback(() => {
    if (installStallTimerRef.current) {
      clearTimeout(installStallTimerRef.current);
      installStallTimerRef.current = null;
    }
  }, []);

  const armInstallStallTimer = useCallback(() => {
    clearInstallStallTimer();
    installStallTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setIsInstallStalled(true);
    }, INSTALL_STALL_TIMEOUT_MS);
  }, [clearInstallStallTimer]);

  // The message is never written without the operation that produced it. A
  // backend code resolves through `errors`; an unknown one falls back to its detail.
  const fail = useCallback(
    (kind: UpdateErrorKind, detail?: string | null, code?: string | null) => {
      const message = resolveErrorMessage(tRef.current, code, detail, "").trim();
      setErrorKind(kind);
      setError(message || null);
    },
    [],
  );

  const clearFailure = useCallback(() => {
    setErrorKind(null);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Load last checked from localStorage
    const stored = localStorage.getItem(LAST_CHECKED_KEY);
    if (stored) setLastChecked(stored);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      clearInstallStallTimer();
    };
  }, [clearInstallStallTimer]);

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
          fail("download", json.message, json.error);
        }
      } catch {
        // Silently retry on next interval
      }
    }, POLL_INTERVAL);
  }, [fail]);

  // ---------------------------------------------------------------------------
  // Fetch update info from CGI
  // ---------------------------------------------------------------------------
  const fetchUpdateInfo = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    clearFailure();

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error();

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        fail("check", json.detail, json.error);
        return;
      }

      const info = json as UpdateInfo;
      setUpdateInfo({
        ...info,
        check_error: info.check_error
          ? resolveErrorMessage(tRef.current, info.check_error_code, info.check_error, "")
          : null,
      });

      // Sync download state from backend
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
    } catch {
      if (!mountedRef.current) return;
      fail("check", null);
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, [startDownloadPolling, fail, clearFailure]);

  // Fetch on mount
  useEffect(() => {
    fetchUpdateInfo();
  }, [fetchUpdateInfo]);

  // Install-stall tracking: any status change re-arms the 120 s timer while
  // "installing"; the timer firing means the installer went quiet.
  const trackStall = useCallback(
    (json: { status: string; message?: string; version?: string }) => {
      const signature = `${json.status}|${json.message ?? ""}|${json.version ?? ""}`;
      if (signature === lastStatusSignatureRef.current) return;
      lastStatusSignatureRef.current = signature;
      setIsInstallStalled(false);
      if (json.status === "installing") armInstallStallTimer();
      else clearInstallStallTimer();
    },
    [armInstallStallTimer, clearInstallStallTimer],
  );

  const settleStall = useCallback(() => {
    clearInstallStallTimer();
    setIsInstallStalled(false);
    lastStatusSignatureRef.current = "";
  }, [clearInstallStallTimer]);

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
        trackStall(json);

        if (json.status === "rebooting") {
          settleStall();
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
          settleStall();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsUpdating(false);
          fail("install", json.message, json.error);
        }
      } catch {
        // Fetch failed — device is likely rebooting already. Navigate
        // immediately; if the static page is uncached and lighttpd is
        // already gone the user will see a connection error, but waiting
        // doesn't help since the device won't come back any sooner.
        settleStall();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        sessionStorage.setItem("qm_rebooting", "1");
        document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
        window.location.href = "/reboot/";
      }
    }, POLL_INTERVAL);
  }, [fail, trackStall, settleStall]);

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

    clearFailure();
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
        fail("download", json.detail, json.error);
        setIsDownloading(false);
        setDownloadState(null);
        return;
      }

      startDownloadPolling();
    } catch {
      if (!mountedRef.current) return;
      fail("download", null);
      setIsDownloading(false);
      setDownloadState(null);
    }
  }, [updateInfo, startDownloadPolling, fail, clearFailure]);

  const installStaged = useCallback(async () => {
    clearFailure();
    settleStall();
    setIsUpdating(true);
    setUpdateStatus({ status: "installing" });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_staged" }),
      });

      const json = await resp.json();
      if (!json.success) {
        fail("install", json.detail, json.error);
        setIsUpdating(false);
        // A status left at "installing" after the request failed is a lie.
        setUpdateStatus({ status: "idle" });
        return;
      }

      startPolling();
    } catch {
      if (!mountedRef.current) return;
      fail("install", null);
      setIsUpdating(false);
      setUpdateStatus({ status: "idle" });
    }
  }, [startPolling, fail, clearFailure, settleStall]);

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
          trackStall(json);
        }

        // Chain step: when the download reports ready, fire install_staged once.
        if (json.status === "ready" && !installPosted) {
          installPosted = true;
          setUpdateStatus({ status: "installing", version });
          const post = await authFetch(CGI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "install_staged" }),
          });
          // A refused install must not sit on "installing" until the poll gives up.
          const postJson = await post.json().catch(() => null);
          if (postJson && postJson.success === false) {
            settleStall();
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setIsUpdating(false);
            setUpdateStatus({ status: "idle" });
            fail("install", postJson.detail, postJson.error);
          }
          return; // next tick will pick up the installing/rebooting status
        }

        if (json.status === "rebooting") {
          settleStall();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          sessionStorage.setItem("qm_rebooting", "1");
          document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
          window.location.href = "/reboot/";
        }

        if (json.status === "error") {
          settleStall();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setIsUpdating(false);
          fail("install", json.message, json.error);
        }
      } catch {
        // Network blink — if we've already posted install_staged, the device is
        // likely rebooting. Mirror startPolling's behavior and redirect.
        if (installPosted) {
          settleStall();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          sessionStorage.setItem("qm_rebooting", "1");
          document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
          window.location.href = "/reboot/";
        }
      }
    }, POLL_INTERVAL);
  }, [fail, trackStall, settleStall]);

  // ---------------------------------------------------------------------------
  // installVersion — one-click chained install for a specific version. Used by
  // Version Management. Backend uses the same two endpoints as the main flow
  // (download → install_staged); the chain happens in the poller above.
  // ---------------------------------------------------------------------------
  const installVersion = useCallback(async (version: string) => {
    if (!version) return;

    clearFailure();
    settleStall();
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
        fail("install", json.detail, json.error);
        setIsUpdating(false);
        // A status left at "downloading" after the request failed is a lie.
        setUpdateStatus({ status: "idle" });
        return;
      }

      startChainedPolling(version);
    } catch {
      if (!mountedRef.current) return;
      fail("install", null);
      setIsUpdating(false);
      setUpdateStatus({ status: "idle" });
    }
  }, [startChainedPolling, fail, clearFailure, settleStall]);

  const installUpdate = useCallback(async () => {
    if (!updateInfo?.download_url || !updateInfo?.latest_version) return;

    clearFailure();
    settleStall();
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
        fail("install", json.detail, json.error);
        setIsUpdating(false);
        return;
      }

      startPolling();
    } catch {
      if (!mountedRef.current) return;
      fail("install", null);
      setIsUpdating(false);
    }
  }, [updateInfo, startPolling, fail, clearFailure, settleStall]);

  // Manual escape hatch once an install stalls; the caller gates it behind a confirm.
  const rebootDevice = useCallback(() => {
    clearFailure();
    settleStall();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setUpdateStatus({ status: "rebooting" });
    rebootNow("software_update");
  }, [clearFailure, settleStall]);

  const togglePrerelease = useCallback(async (enabled: boolean): Promise<string | null> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_prerelease", enabled }),
      });

      const json = await resp.json();
      if (!json.success) {
        return resolveErrorMessage(tRef.current, json.error, json.detail, "");
      }

      // Re-check with new preference
      await fetchUpdateInfo(true);
      return null;
    } catch {
      if (!mountedRef.current) return null;
      return "";
    }
  }, [fetchUpdateInfo]);

  const saveAutoUpdate = useCallback(async (enabled: boolean, time: string): Promise<string | null> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_auto_update", enabled, time }),
      });

      const json = await resp.json();
      if (!json.success) {
        return resolveErrorMessage(tRef.current, json.error, json.detail, "");
      }

      await fetchUpdateInfo(true);
      return null;
    } catch {
      if (!mountedRef.current) return null;
      return "";
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
    errorKind,
    isInstallStalled,
    lastChecked,
    checkForUpdates,
    downloadUpdate,
    installStaged,
    installUpdate,
    installVersion,
    rebootDevice,
    togglePrerelease,
    saveAutoUpdate,
  };
}

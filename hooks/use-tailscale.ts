"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

export interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
  log?: string;
  /** Which job the shared install_status file describes. */
  op?: "install" | "update";
}

/**
 * The outcome of one mutation. `reason` is the backend's own explanation,
 * already resolved through `resolveErrorMessage`; empty when the backend gave
 * none, so the caller supplies its translated fallback.
 */
export interface TailscaleActionResult {
  ok: boolean;
  reason: string;
}

// =============================================================================
// useTailscale — Fetch & Action Hook for Tailscale VPN Management
// =============================================================================
// Fetches Tailscale status on mount (tiered: not installed → stopped → full).
// Provides action methods for connect, disconnect, logout, service, boot toggle,
// install and update. Adaptive polling: 10s normal, 3s during auth wait.
//
// Update: tailscaled restarts under the tunnel, so `runUpdate` tolerates a
// window of failed progress polls instead of reading them as a failed update.
// Install and update RETURN their outcome rather than parking the reason in
// hook state, so a caller toasting after an `await` never reads a stale closure.
//
// Backend: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/vpn/tailscale.sh";

const POLL_NORMAL_MS = 10_000;
const POLL_AUTH_MS = 3_000;
const INSTALL_POLL_MS = 2_000;
/** Failed progress reads this long in a row mean the update is not coming back. */
const UPDATE_FAIL_TOLERANCE_MS = 20_000;
/** Upper bound on one update, download over cellular included. */
const UPDATE_MAX_MS = 10 * 60_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TailscaleSelf {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  online: boolean;
  os: string;
  relay: string;
}

export interface TailscaleTailnet {
  name: string;
  magic_dns_suffix: string;
  magic_dns_enabled: boolean;
}

export interface TailscalePeer {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  os: string;
  online: boolean;
  last_seen: string;
  relay: string;
  exit_node: boolean;
}

export interface TailscaleStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  ssh_enabled?: boolean;
  version?: string;
  backend_state?: string;
  auth_url?: string;
  self?: TailscaleSelf;
  tailnet?: TailscaleTailnet;
  peers?: TailscalePeer[];
  health?: string[];
  install_hint?: string;
  error_detail?: string;
  /** Newest stable version, "" when it could not be determined. */
  latest_version?: string;
  update_available?: boolean;
  /** An update holds the install lock; the other fields may be absent. */
  busy?: "update";
}

export interface UseTailscaleReturn {
  status: TailscaleStatus | null;
  isLoading: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingSsh: boolean;
  isUninstalling: boolean;
  isUpdating: boolean;
  installResult: InstallResult;
  error: string | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  startService: () => Promise<boolean>;
  stopService: () => Promise<boolean>;
  setBootEnabled: (enabled: boolean) => Promise<boolean>;
  setSshEnabled: (enabled: boolean) => Promise<boolean>;
  uninstall: () => Promise<boolean>;
  runInstall: () => Promise<void>;
  checkUpdate: (force?: boolean) => Promise<TailscaleActionResult>;
  runUpdate: () => Promise<TailscaleActionResult>;
  refresh: () => void;
}

interface PostResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

interface InstallStatusResponse extends PostResponse {
  status?: InstallResult["status"];
  message?: string;
  log?: string;
  op?: "install" | "update";
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const OK: TailscaleActionResult = { ok: true, reason: "" };

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useTailscale(): UseTailscaleReturn {
  const { t } = useTranslation("errors");
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [isTogglingSsh, setIsTogglingSsh] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [installResult, setInstallResult] = useState<InstallResult>({
    success: true,
    status: "idle",
  });
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const updatingRef = useRef(false);
  const updateCheckedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installPollRef.current) clearInterval(installPollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
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
        setError(json.error || "Failed to fetch Tailscale status");
        return;
      }

      // An update holds the lock and the CGI answers with a bare
      // `{installed, busy}`; layered over a good payload it keeps the page on
      // screen instead of reading as "service stopped".
      if (json.busy) {
        setStatus((prev) =>
          prev?.installed ? { ...prev, busy: json.busy } : json,
        );
        return;
      }

      setStatus(json);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch Tailscale status",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Adaptive polling — faster during auth wait
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const isAuthWaiting =
      status?.backend_state === "NeedsLogin" && !!status?.auth_url;
    const interval = isAuthWaiting ? POLL_AUTH_MS : POLL_NORMAL_MS;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchStatus(true), interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, status?.backend_state, status?.auth_url]);

  // ---------------------------------------------------------------------------
  // POST helper
  // ---------------------------------------------------------------------------
  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<PostResponse & {
      auth_url?: string;
      already_authenticated?: boolean;
    }> => {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      return resp.json();
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const connect = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    setError(null);

    try {
      const json = await postAction({ action: "connect" });
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to connect");
        return false;
      }

      // Refetch to pick up auth_url or Running state
      await fetchStatus(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to connect");
      return false;
    } finally {
      if (mountedRef.current) setIsConnecting(false);
    }
  }, [postAction, fetchStatus]);

  const disconnect = useCallback(async (): Promise<boolean> => {
    setIsDisconnecting(true);
    setError(null);

    try {
      const json = await postAction({ action: "disconnect" });
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to disconnect");
        return false;
      }

      await fetchStatus(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to disconnect");
      return false;
    } finally {
      if (mountedRef.current) setIsDisconnecting(false);
    }
  }, [postAction, fetchStatus]);

  const logout = useCallback(async (): Promise<boolean> => {
    setIsDisconnecting(true);
    setError(null);

    try {
      const json = await postAction({ action: "logout" });
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to logout");
        return false;
      }

      await fetchStatus(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to logout");
      return false;
    } finally {
      if (mountedRef.current) setIsDisconnecting(false);
    }
  }, [postAction, fetchStatus]);

  const startService = useCallback(async (): Promise<boolean> => {
    setIsTogglingService(true);
    setError(null);

    try {
      const json = await postAction({ action: "start_service" });
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to start service");
        return false;
      }

      await fetchStatus(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to start service");
      return false;
    } finally {
      if (mountedRef.current) setIsTogglingService(false);
    }
  }, [postAction, fetchStatus]);

  const stopService = useCallback(async (): Promise<boolean> => {
    setIsTogglingService(true);
    setError(null);

    try {
      const json = await postAction({ action: "stop_service" });
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to stop service");
        return false;
      }

      await fetchStatus(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to stop service");
      return false;
    } finally {
      if (mountedRef.current) setIsTogglingService(false);
    }
  }, [postAction, fetchStatus]);

  const setBootEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setError(null);

      try {
        const json = await postAction({
          action: "set_boot_enabled",
          enabled,
        });
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to update boot setting");
          return false;
        }

        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to update boot setting",
        );
        return false;
      }
    },
    [postAction, fetchStatus],
  );

  const setSshEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setIsTogglingSsh(true);
      setError(null);

      try {
        const json = await postAction({ action: "set_ssh", enabled });
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to update SSH setting");
          return false;
        }

        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to update SSH setting",
        );
        return false;
      } finally {
        if (mountedRef.current) setIsTogglingSsh(false);
      }
    },
    [postAction, fetchStatus],
  );

  // ---------------------------------------------------------------------------
  // Install via helper script
  // ---------------------------------------------------------------------------
  const stopInstallPolling = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  /** Normalise one install_status read; a backend error code beats its prose. */
  const toInstallResult = useCallback(
    (r: InstallStatusResponse): InstallResult => ({
      success: r.success,
      status: r.status ?? "idle",
      message:
        r.status === "error"
          ? resolveErrorMessage(t, r.error, r.detail, r.message ?? "")
          : r.message,
      detail: r.detail,
      log: r.log,
      op: r.op,
    }),
    [t],
  );

  const pollInstallStatus = useCallback(async () => {
    try {
      const json = (await postAction({
        action: "install_status",
      })) as InstallStatusResponse;
      if (!mountedRef.current) return;
      const r = toInstallResult(json);
      setInstallResult(r);
      if (r.status === "complete" || r.status === "error") {
        stopInstallPolling();
        await fetchStatus(true);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [postAction, toInstallResult, stopInstallPolling, fetchStatus]);

  const runInstall = useCallback(async () => {
    stopInstallPolling();
    setInstallResult({
      success: true,
      status: "running",
      op: "install",
      message: "Starting installation...",
    });
    try {
      const json = await postAction({ action: "install" });
      if (!mountedRef.current) return;
      if (!json.success) {
        // Refused up front (already running, already installed): no job to poll.
        setInstallResult({
          success: false,
          status: "error",
          message: resolveErrorMessage(t, json.error, json.detail, ""),
        });
        return;
      }
      installPollRef.current = setInterval(pollInstallStatus, INSTALL_POLL_MS);
    } catch (err) {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: err instanceof Error ? err.message : "Failed to start installation",
        });
      }
    }
  }, [postAction, pollInstallStatus, stopInstallPolling, t]);

  /**
   * Ask for the newest version. Merges the answer into `status` instead of
   * refetching, so the page does not flicker for a background read.
   */
  const checkUpdate = useCallback(
    async (force = false): Promise<TailscaleActionResult> => {
      try {
        const json = (await postAction({
          action: "check_update",
          ...(force ? { force: true } : {}),
        })) as PostResponse & { latest_version?: string; update_available?: boolean };
        if (!json.success) {
          return {
            ok: false,
            reason: resolveErrorMessage(t, json.error, json.detail, ""),
          };
        }
        if (mountedRef.current) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  latest_version: json.latest_version ?? prev.latest_version,
                  update_available:
                    json.update_available ?? prev.update_available,
                }
              : prev,
          );
        }
        return OK;
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "",
        };
      }
    },
    [postAction, t],
  );

  // One background check per visit once Tailscale is known to be installed. The
  // CGI caches the answer; a failure just leaves the page without an update offer.
  const shouldCheckUpdate = !!status?.installed && !status.busy;
  useEffect(() => {
    if (!shouldCheckUpdate || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    void checkUpdate();
  }, [shouldCheckUpdate, checkUpdate]);

  /**
   * Start the update and follow it to the end. tailscaled restarts partway
   * through, so a run of failed progress reads is tolerated; only a longer
   * silence is a failure. The loop outlives the component so the toast still
   * lands if the user navigates away.
   */
  const runUpdate = useCallback(async (): Promise<TailscaleActionResult> => {
    if (updatingRef.current) return { ok: false, reason: "" };
    updatingRef.current = true;
    setIsUpdating(true);
    setInstallResult({ success: true, status: "running", op: "update" });

    const fail = (reason: string): TailscaleActionResult => {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: reason,
          op: "update",
        });
      }
      return { ok: false, reason };
    };

    try {
      const started = await postAction({ action: "update" });
      if (!started.success) {
        return fail(resolveErrorMessage(t, started.error, started.detail, ""));
      }

      const startedAt = Date.now();
      let failingSince: number | null = null;
      while (Date.now() - startedAt < UPDATE_MAX_MS) {
        await sleep(INSTALL_POLL_MS);
        try {
          const json = (await postAction({
            action: "install_status",
          })) as InstallStatusResponse;
          failingSince = null;
          // The status file may still hold an earlier install's result until the
          // helper rewrites it; only an update result counts in the first seconds.
          if (json.op !== "update" && Date.now() - startedAt < 10_000) continue;
          const r = toInstallResult({ ...json, op: json.op ?? "update" });
          if (mountedRef.current) setInstallResult(r);
          if (r.status === "complete") {
            await fetchStatus(true);
            return OK;
          }
          if (r.status === "error") {
            await fetchStatus(true);
            return { ok: false, reason: r.message ?? "" };
          }
        } catch {
          failingSince ??= Date.now();
          if (Date.now() - failingSince > UPDATE_FAIL_TOLERANCE_MS) {
            return fail("");
          }
        }
      }
      return fail("");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "");
    } finally {
      updatingRef.current = false;
      if (mountedRef.current) setIsUpdating(false);
    }
  }, [postAction, toInstallResult, fetchStatus, t]);

  const uninstall = useCallback(async (): Promise<boolean> => {
    setIsUninstalling(true);
    try {
      const json = await postAction({ action: "uninstall" });
      if (!mountedRef.current) return false;
      if (!json.success) {
        setError(json.detail || "Failed to uninstall");
        return false;
      }
      await fetchStatus(true);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error ? err.message : "Failed to uninstall",
        );
      }
      return false;
    } finally {
      if (mountedRef.current) setIsUninstalling(false);
    }
  }, [postAction, fetchStatus]);

  return {
    status,
    isLoading,
    isConnecting,
    isDisconnecting,
    isTogglingService,
    isTogglingSsh,
    isUninstalling,
    isUpdating,
    installResult,
    error,
    connect,
    disconnect,
    logout,
    startService,
    stopService,
    setBootEnabled,
    setSshEnabled,
    uninstall,
    runInstall,
    checkUpdate,
    runUpdate,
    refresh: fetchStatus,
  };
}

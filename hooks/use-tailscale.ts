"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

export interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  log?: string;
  /** Which job the shared install_status file describes. */
  op?: "install" | "update" | "uninstall";
}

/** One mutation's outcome; `reason` is translated, "" when the backend gave none. */
export interface TailscaleActionResult {
  ok: boolean;
  reason: string;
  /** The version the device reports after a finished update. */
  version?: string;
}

// =============================================================================
// useTailscale — Fetch & Action Hook for Tailscale VPN Management
// =============================================================================
// Fetches Tailscale status on mount (tiered: not installed → stopped → full).
// Provides action methods for connect, disconnect, logout, service, boot toggle,
// install and update. Adaptive polling: 10s normal, 3s during auth wait.
//
// Install, update and uninstall return their outcome, so a toast after an `await` never
// reads stale hook state. `runUpdate` tolerates failed polls while tailscaled restarts.
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
/** The helper must have written this run's first status by then. */
const UPDATE_START_MS = 15_000;
/** Upper bound on one uninstall; measured under 15 s. */
const UNINSTALL_MAX_MS = 60_000;

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
  uninstall: () => Promise<TailscaleActionResult>;
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
  op?: "install" | "update" | "uninstall";
  run?: string;
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
  const latestStatusRef = useRef<TailscaleStatus | null>(null);
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

      latestStatusRef.current = json;
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

  /** One install_status read; a failure is always a translated sentence, never the tool's English. */
  const toInstallResult = useCallback(
    (r: InstallStatusResponse): InstallResult => ({
      success: r.success,
      status: r.status ?? "idle",
      message:
        r.status === "error"
          ? resolveErrorMessage(
              t,
              r.error || (r.op === "update" ? "update_failed" : "install_failed"),
              undefined,
              "",
            )
          : r.message,
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
      // The file may still hold the last uninstall's result until the helper writes.
      if (json.op === "uninstall") return;
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
          message: resolveErrorMessage(t, json.error || "install_failed", undefined, ""),
        });
        return;
      }
      installPollRef.current = setInterval(pollInstallStatus, INSTALL_POLL_MS);
    } catch {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: resolveErrorMessage(t, "install_failed", undefined, ""),
        });
      }
    }
  }, [postAction, pollInstallStatus, stopInstallPolling, t]);

  /** Ask for the newest version; merged into `status` so the page does not refetch. */
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

  /** Follow this update run to the end; the loop outlives the component so the toast still lands. */
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
      const started = (await postAction({
        action: "update",
      })) as PostResponse & { run?: string };
      if (!started.success) {
        return fail(
          resolveErrorMessage(t, started.error || "update_failed", undefined, ""),
        );
      }
      const run = started.run;
      let seen = false;

      const startedAt = Date.now();
      let failingSince: number | null = null;
      while (Date.now() - startedAt < UPDATE_MAX_MS) {
        await sleep(INSTALL_POLL_MS);
        try {
          const json = (await postAction({
            action: "install_status",
          })) as InstallStatusResponse;
          failingSince = null;
          // Only this run's status counts; the file may hold an older install's result.
          if (json.op !== "update" || (run && json.run !== run)) {
            if (!seen && Date.now() - startedAt > UPDATE_START_MS) {
              return fail(resolveErrorMessage(t, "update_failed", undefined, ""));
            }
            continue;
          }
          seen = true;
          const r = toInstallResult(json);
          if (mountedRef.current) setInstallResult(r);
          if (r.status === "complete") {
            await fetchStatus(true);
            return { ok: true, reason: "", version: latestStatusRef.current?.version };
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

  /** Follow this uninstall run to its terminal status; the reason is translated. */
  const uninstall = useCallback(async (): Promise<TailscaleActionResult> => {
    setIsUninstalling(true);
    try {
      const started = (await postAction({
        action: "uninstall",
      })) as PostResponse & { run?: string };
      if (!started.success) {
        return {
          ok: false,
          reason: resolveErrorMessage(t, started.error, started.detail, ""),
        };
      }
      const run = started.run;
      const startedAt = Date.now();
      let seen = false;
      while (Date.now() - startedAt < UNINSTALL_MAX_MS) {
        await sleep(INSTALL_POLL_MS);
        try {
          const json = (await postAction({
            action: "install_status",
          })) as InstallStatusResponse;
          if (json.op !== "uninstall" || (run && json.run !== run)) {
            if (!seen && Date.now() - startedAt > UPDATE_START_MS) break;
            continue;
          }
          seen = true;
          if (json.status === "complete") {
            await fetchStatus(true);
            return OK;
          }
          if (json.status === "error") {
            await fetchStatus(true);
            return {
              ok: false,
              reason: resolveErrorMessage(t, json.error, undefined, ""),
            };
          }
        } catch {
          // The firewall reload can drop one poll; keep trying until the deadline.
        }
      }
      await fetchStatus(true);
      return { ok: false, reason: "" };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "" };
    } finally {
      if (mountedRef.current) setIsUninstalling(false);
    }
  }, [postAction, fetchStatus, t]);

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

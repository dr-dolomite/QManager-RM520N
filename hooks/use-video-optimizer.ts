"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { InstallPhase, VideoOptimizerStatus } from "@/types/traffic-engine";

// =============================================================================
// useVideoOptimizer — Traffic Engine Video Optimizer status & control hook
// =============================================================================
// Fetches engine status on mount and re-polls every 2s while the engine is
// active (packets counter / uptime are live values; the status card derives
// packets-per-second deltas from successive samples). Provides enable/disable
// save and the install lifecycle (spawn + poll install_status).
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/video_optimizer.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 2000;

export interface UseVideoOptimizerReturn {
  data: VideoOptimizerStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  isInstalling: boolean;
  isUninstalling: boolean;
  installPhase: InstallPhase;
  installMessage: string | null;
  error: string | null;
  saveEnabled: (enabled: boolean) => Promise<boolean>;
  installBinary: () => Promise<boolean>;
  uninstallBinary: () => Promise<boolean>;
  dismissBinaryOpError: () => void;
  refresh: () => void;
}

export function useVideoOptimizer(): UseVideoOptimizerReturn {
  const [data, setData] = useState<VideoOptimizerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Synchronous mutual exclusion across install/uninstall entry points: two
  // rapid clicks must not spawn racing CGI operations (state updates alone
  // are too late — both closures would still see stale flags).
  const opBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch engine status");
        return;
      }

      setData({
        success: true,
        enabled: json.enabled,
        status: json.status,
        uptime: json.uptime,
        packets_processed: json.packets_processed ?? 0,
        domains_loaded: json.domains_loaded ?? 0,
        binary_installed: json.binary_installed,
        kernel_module_loaded: json.kernel_module_loaded,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch engine status");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  // Poll on mount; re-poll every POLL_MS while mounted. Cheap GET, guarded
  // against overlap by the 2s cadence being comfortably above CGI latency.
  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus(true), POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Save enable/disable
  // ---------------------------------------------------------------------------
  const saveEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", enabled }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save engine settings");
          return false;
        }
        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save engine settings");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchStatus],
  );

  // ---------------------------------------------------------------------------
  // Binary install / uninstall lifecycle — spawn, then poll install_status
  // until terminal. Both directions share the identical marker protocol, so
  // one state machine drives both; only the POST action and copy differ.
  // ---------------------------------------------------------------------------
  const runBinaryOperation = useCallback(
    async (action: "install" | "uninstall"): Promise<boolean> => {
      const isInstall = action === "install";
      const copy = {
        start: isInstall ? "Starting zapret download..." : "Stopping Traffic Engine...",
        spawnFailed: isInstall ? "Failed to start install" : "Failed to start removal",
        already: isInstall ? "tpws already installed" : "Engine binary already removed",
        failed: isInstall ? "Install failed" : "Removal failed",
        timeout: isInstall
          ? "Install timed out — the downloader may still finish in the background; refresh in a few minutes"
          : "Removal timed out — refresh the page in a few minutes",
      };

      if (opBusyRef.current) return false;
      opBusyRef.current = true;
      setError(null);
      setIsInstalling(isInstall);
      setIsUninstalling(!isInstall);
      setInstallPhase("running");
      setInstallMessage(copy.start);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (json.success === false) {
          const msg = json.detail || json.error || copy.spawnFailed;
          setError(msg);
          setInstallMessage(msg);
          setInstallPhase("error");
          return false;
        }
        if (json.status === "already") {
          if (isInstall) {
            setInstallPhase("complete");
            setInstallMessage(copy.already);
          }
          // Uninstall flavor: leave zero residue — if the binary was already
          // gone the onboarding card must render exactly like a fresh install.
          await fetchStatus(true);
          return true;
        }

        // Poll install_status to completion.
        // Liveness-aware: the CGI reports worker_alive (spawned PID still
        // running), so a dead worker surfaces immediately instead of idling
        // to a blind timeout — while a genuinely slow download (curl allows
        // ~330s) keeps polling well past the old fixed 180s cap.
        let sawWorker = true; // the spawn itself reported success
        for (let i = 0; i < 300; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!mountedRef.current) return false;
          const stResp = await authFetch(`${CGI_ENDPOINT}?action=install_status`);
          if (!stResp.ok) continue;
          let st: {
            status?: string;
            message?: string;
            detail?: string;
            worker_alive?: boolean;
          };
          try {
            st = await stResp.json();
          } catch {
            // Truncated/half-written marker file — transient. Keep the last
            // known message on screen rather than blanking it.
            continue;
          }
          if (!mountedRef.current) return false;

          if (!st.status || st.status === "idle") {
            // No usable marker content. If the worker is gone too, it died
            // before recording anything — say so instead of idling.
            if (sawWorker && st.worker_alive === false) {
              setInstallPhase("error");
              const msg = isInstall
                ? "Installer exited unexpectedly (no status recorded)"
                : "Removal exited unexpectedly (no status recorded)";
              setError(msg);
              setInstallMessage(msg);
              await fetchStatus(true);
              return false;
            }
            continue;
          }

          sawWorker = true;
          setInstallPhase(st.status as InstallPhase);
          setInstallMessage(st.message || st.detail || null);
          if (st.status === "complete" || st.status === "error") {
            if (st.status === "error") {
              const msg = st.detail || st.message || copy.failed;
              setError(msg);
              setInstallMessage(msg);
            }
            await fetchStatus(true);
            if (!isInstall && st.status === "complete") {
              // Removal finished: clear phase/message residue. The onboarding
              // card reappearing after a successful removal must look exactly
              // like a fresh install — "complete" would render as the green
              // "Engine ready" alert with the removal log line beneath it.
              setInstallPhase("idle");
              setInstallMessage(null);
            }
            return st.status === "complete";
          }
        }
        setInstallPhase("error");
        setError(copy.timeout);
        setInstallMessage(copy.timeout);
        return false;
      } catch (err) {
        if (!mountedRef.current) return false;
        const msg = err instanceof Error ? err.message : copy.spawnFailed;
        setError(msg);
        setInstallPhase("error");
        setInstallMessage(msg);
        return false;
      } finally {
        opBusyRef.current = false;
        if (mountedRef.current) {
          setIsInstalling(false);
          setIsUninstalling(false);
        }
      }
    },
    [fetchStatus],
  );

  const installBinary = useCallback(
    () => runBinaryOperation("install"),
    [runBinaryOperation],
  );

  const uninstallBinary = useCallback(
    () => runBinaryOperation("uninstall"),
    [runBinaryOperation],
  );

  // A failed install/uninstall must stay on screen until the user dismisses
  // it: the status/onboarding surfaces hide phase state once the binary is
  // installed, so without an explicit dismissal path errors would either
  // never show or blink out with the next poll.
  const dismissBinaryOpError = useCallback(() => {
    setError(null);
    setInstallPhase("idle");
    setInstallMessage(null);
  }, []);

  return {
    data,
    isLoading,
    isSaving,
    isInstalling,
    isUninstalling,
    installPhase,
    installMessage,
    error,
    saveEnabled,
    installBinary,
    uninstallBinary,
    dismissBinaryOpError,
    refresh: fetchStatus,
  };
}
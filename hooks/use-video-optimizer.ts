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
  installPhase: InstallPhase;
  installMessage: string | null;
  error: string | null;
  saveEnabled: (enabled: boolean) => Promise<boolean>;
  installBinary: () => Promise<boolean>;
  refresh: () => void;
}

export function useVideoOptimizer(): UseVideoOptimizerReturn {
  const [data, setData] = useState<VideoOptimizerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

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
  // Install lifecycle — spawn, then poll install_status until terminal
  // ---------------------------------------------------------------------------
  const installBinary = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsInstalling(true);
    setInstallPhase("running");
    setInstallMessage("Starting zapret download...");
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json = await resp.json();
      if (!mountedRef.current) return false;

      if (json.success === false) {
        setError(json.detail || json.error || "Failed to start install");
        setInstallPhase("error");
        return false;
      }
      if (json.status === "already") {
        setInstallPhase("complete");
        setInstallMessage("tpws already installed");
        setIsInstalling(false);
        await fetchStatus(true);
        return true;
      }

      // Poll install_status to completion.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!mountedRef.current) return false;
        const stResp = await authFetch(`${CGI_ENDPOINT}?action=install_status`);
        if (!stResp.ok) continue;
        const st = await stResp.json();
        if (!mountedRef.current) return false;
        setInstallPhase(st.status);
        setInstallMessage(st.message || st.detail || null);
        if (st.status === "complete" || st.status === "error") {
          if (st.status === "error") setError(st.detail || st.message || "Install failed");
          await fetchStatus(true);
          return st.status === "complete";
        }
      }
      setInstallPhase("error");
      setError("Install timed out");
      return false;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(err instanceof Error ? err.message : "Failed to start install");
      setInstallPhase("error");
      return false;
    } finally {
      if (mountedRef.current) setIsInstalling(false);
    }
  }, [fetchStatus]);

  return {
    data,
    isLoading,
    isSaving,
    isInstalling,
    installPhase,
    installMessage,
    error,
    saveEnabled,
    installBinary,
    refresh: fetchStatus,
  };
}
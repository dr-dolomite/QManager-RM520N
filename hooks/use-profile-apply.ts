"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProfileApplyState, ApplyStatus } from "@/types/sim-profile";

// =============================================================================
// useProfileApply — Profile Apply Lifecycle Hook
// =============================================================================
// Manages the async profile apply lifecycle:
//   1. POST to apply.sh to spawn the detached apply process
//   2. Poll apply_status.sh every 500ms while applying
//   3. Surface step-by-step progress and final result
//
// Mirrors the speedtest hook pattern (setsid + status polling).
//
// Usage:
//   const { applyState, isApplying, applyProfile, reset } = useProfileApply();
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/profiles";
const POLL_INTERVAL_MS = 500;

export interface UseProfileApplyReturn {
  /** Current apply state (null before first apply or after reset) */
  applyState: ProfileApplyState | null;
  /** Whether an apply is actively in progress */
  isApplying: boolean;
  /** Start applying a profile by ID */
  applyProfile: (id: string) => Promise<void>;
  /** Reset state (dismiss results) */
  reset: () => void;
  /** Error message from the start request (not step-level errors) */
  error: string | null;
}

export function useProfileApply(): UseProfileApplyReturn {
  const [applyState, setApplyState] = useState<ProfileApplyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Stop polling
  // ---------------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Poll apply status
  // ---------------------------------------------------------------------------
  const pollStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${CGI_BASE}/apply_status.sh`);
      if (!resp.ok) return;

      const data: ProfileApplyState = await resp.json();
      if (!mountedRef.current) return;

      setApplyState(data);

      // Stop polling on terminal states
      const terminalStates: ApplyStatus[] = [
        "complete",
        "partial",
        "failed",
        "idle",
      ];
      if (terminalStates.includes(data.status)) {
        stopPolling();
      }
    } catch {
      // Network error during poll — not critical, retry next interval
    }
  }, [stopPolling]);

  // ---------------------------------------------------------------------------
  // Start polling
  // ---------------------------------------------------------------------------
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollStatus(); // Immediate first poll
    pollRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
  }, [pollStatus]);

  // ---------------------------------------------------------------------------
  // Apply a profile
  // ---------------------------------------------------------------------------
  const applyProfile = useCallback(
    async (id: string) => {
      setError(null);
      setApplyState(null);

      try {
        const resp = await fetch(`${CGI_BASE}/apply.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });

        if (!resp.ok) {
          setError("Failed to start profile apply (HTTP error)");
          return;
        }

        const data = await resp.json();
        if (!mountedRef.current) return;

        if (!data.success) {
          if (data.error === "apply_in_progress") {
            // Another apply is running — follow along
            startPolling();
            return;
          }
          setError(data.detail || data.error || "Failed to start apply");
          return;
        }

        // Success — begin polling for progress
        startPolling();
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : "Failed to start profile apply"
          );
        }
      }
    },
    [startPolling]
  );

  // ---------------------------------------------------------------------------
  // Reset (dismiss results)
  // ---------------------------------------------------------------------------
  const reset = useCallback(() => {
    stopPolling();
    setApplyState(null);
    setError(null);
  }, [stopPolling]);

  // ---------------------------------------------------------------------------
  // Check for in-progress apply on mount (in case user navigated away)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const checkExisting = async () => {
      try {
        const resp = await fetch(`${CGI_BASE}/apply_status.sh`);
        if (!resp.ok) return;
        const data: ProfileApplyState = await resp.json();
        if (!mountedRef.current) return;

        if (data.status === "applying") {
          setApplyState(data);
          startPolling();
        } else if (
          data.status === "complete" ||
          data.status === "partial" ||
          data.status === "failed"
        ) {
          // Show previous result
          setApplyState(data);
        }
      } catch {
        // Silent
      }
    };
    checkExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isApplying = applyState?.status === "applying";

  return {
    applyState,
    isApplying,
    applyProfile,
    reset,
    error,
  };
}

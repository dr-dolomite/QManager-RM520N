"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/known_sims.sh";

/** Envelope returned by both the GET and the clear POST. */
interface KnownSimsResponse {
  success: boolean;
  count: number;
  /**
   * False when the set was cleared but the sim_registry.json sidecar write
   * failed, so the Tracked SIMs list may still show forgotten SIMs. Absent on
   * devices running a backend that predates the two-store clear.
   */
  registry_cleared?: boolean;
  error?: string;
  detail?: string;
}

/** Outcome of a clear, detailed enough for the caller to tell the truth. */
export interface ClearKnownSimsResult {
  ok: boolean;
  /** True only when BOTH the known-SIMs set and the registry were cleared. */
  registryCleared: boolean;
  detail?: string;
}

export interface UseKnownSimsReturn {
  /** How many SIMs the device will not flag as new. */
  count: number;
  isLoading: boolean;
  isClearing: boolean;
  refresh: () => Promise<void>;
  clear: () => Promise<ClearKnownSimsResult>;
}

/**
 * Reads and clears the known-SIMs set at /etc/qmanager/known_iccids.
 *
 * This is the "is this SIM new" store, and it is deliberately separate from
 * the registry sidecar behind `useSimRegistry` — one is a membership set, the
 * other is per-SIM metadata. Clearing spans both on the device, so a caller
 * that shows the list must refresh it after a successful clear or the two
 * halves of the same card will disagree.
 *
 * The count is small and changes only on SIM insertion or an explicit clear,
 * so this fetches on mount rather than polling.
 */
export function useKnownSims(): UseKnownSimsReturn {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return;
      if (json.success) setCount(json.count ?? 0);
    } catch {
      // Silent by design: the count is supporting information next to the
      // list, and clearing still works without it. The list's own error
      // handling owns the visible failure state for this card.
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = useCallback(async (): Promise<ClearKnownSimsResult> => {
    setIsClearing(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return { ok: false, registryCleared: false };

      if (!json.success) {
        return { ok: false, registryCleared: false, detail: json.detail };
      }

      setCount(json.count ?? 0);
      return {
        ok: true,
        // A backend without the field predates the two-store clear; treat it
        // as "not cleared" so the caller warns instead of over-promising.
        registryCleared: json.registry_cleared === true,
      };
    } catch {
      return { ok: false, registryCleared: false };
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  }, []);

  return { count, isLoading, isClearing, refresh, clear };
}

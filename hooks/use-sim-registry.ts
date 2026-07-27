"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SimRegistryAction,
  SimRegistryEntry,
  SimRegistryResponse,
} from "@/types/sim-registry";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/sim_registry.sh";

/**
 * Flip one SIM's dismissed flag on the device.
 *
 * Standalone so the globally-mounted SIM-swap banner can dismiss a SIM without
 * pulling the whole registry on every page; the card's hook uses it too, so
 * both callers speak to the endpoint through one place.
 *
 * Resolves `false` on any transport or envelope failure — callers decide
 * whether that is worth surfacing.
 */
export async function postSimDismissal(
  iccid: string,
  dismissed: boolean,
): Promise<boolean> {
  const action: SimRegistryAction = dismissed ? "dismiss" : "undismiss";
  try {
    const resp = await authFetch(CGI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, iccid }),
    });
    if (!resp.ok) return false;
    const json: SimRegistryResponse = await resp.json();
    return json.success === true;
  } catch {
    return false;
  }
}

export interface UseSimRegistryReturn {
  sims: SimRegistryEntry[];
  isLoading: boolean;
  /** Non-null when the last fetch failed and no data is available to show. */
  error: string | null;
  /** ICCID whose dismiss/undismiss request is currently in flight, if any. */
  pendingIccid: string | null;
  refresh: () => Promise<void>;
  setDismissed: (iccid: string, dismissed: boolean) => Promise<boolean>;
}

/**
 * Reads the persistent SIM registry and mutates a single SIM's dismissed flag.
 *
 * The registry is small and changes only when a SIM is inserted or a user acts
 * on it, so this fetches on mount and after each mutation rather than polling.
 * Mutations update the local row optimistically, then reconcile with a refetch
 * so a rejected write can't leave the UI lying about server state.
 */
export function useSimRegistry(): UseSimRegistryReturn {
  const [sims, setSims] = useState<SimRegistryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingIccid, setPendingIccid] = useState<string | null>(null);

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
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const json: SimRegistryResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to read the SIM registry");
        return;
      }

      setSims(Array.isArray(json.sims) ? json.sims : []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to read the SIM registry",
      );
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setDismissed = useCallback(
    async (iccid: string, dismissed: boolean): Promise<boolean> => {
      setPendingIccid(iccid);

      // Optimistic: flip the row now so the control feels immediate. The
      // refresh below is the reconciliation.
      setSims((prev) =>
        prev.map((s) => (s.iccid === iccid ? { ...s, dismissed } : s)),
      );

      const ok = await postSimDismissal(iccid, dismissed);
      // Refetch either way: on success to pick up any server-side derivation,
      // on failure to roll the optimistic flip back to real device state.
      await refresh();
      if (mountedRef.current) setPendingIccid(null);
      return ok;
    },
    [refresh],
  );

  return { sims, isLoading, error, pendingIccid, refresh, setDismissed };
}

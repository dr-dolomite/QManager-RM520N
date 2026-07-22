"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  ApnSetting,
  CidContext,
  ApnSettingsResponse,
  ApnSaveRequest,
  ApnSaveResponse,
} from "@/types/apn-settings";

// =============================================================================
// useApnSettings — Single-APN Settings Hook
// =============================================================================
// Fetches the single stored APN setting + the modem's live PDP contexts on
// mount. save() POSTs action:"save" and triggers a COPS detach/attach cycle
// (brief WAN drop). deactivate() POSTs action:"deactivate" and reverts the
// modem to the carrier-default APN (active=0).
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/apn.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/apn.sh";

// save() runs AT+COPS=2 → AT+CGDCONT → AT+COPS=0 so the new APN is negotiated
// at re-attach. AT+COPS=0 returns OK before the attach fully completes, so the
// fresh active_cid/cids state isn't readable immediately — a short delayed
// silent refresh reconciles the optimistic patch.
const RECONCILE_DELAY_MS = 1500;

export interface UseApnSettingsReturn {
  /** The stored single APN setting (null before first fetch). */
  apn: ApnSetting | null;
  /** The modem's live PDP contexts (1-6), tagged for the CID picker. */
  cids: CidContext[] | null;
  /** 1 = custom APN live, 0 = carrier default, null before first fetch. */
  active: number | null;
  /** The live WAN-bearing CID, or null before first fetch. */
  activeCid: number | null;
  /** True while initial fetch is in progress. */
  isLoading: boolean;
  /** True while a save/deactivate operation is in progress. */
  isSaving: boolean;
  /** Error message if fetch or a mutation failed. */
  error: string | null;
  /** Persist the APN configuration and apply it. Returns true on success. */
  save: (request: ApnSaveRequest) => Promise<boolean>;
  /** Revert to carrier-default APN (active=0). Returns true on success. */
  deactivate: () => Promise<boolean>;
  /** Re-fetch the APN setting + CID contexts. */
  refresh: () => void;
}

export function useApnSettings(): UseApnSettingsReturn {
  const [apn, setApn] = useState<ApnSetting | null>(null);
  const [cids, setCids] = useState<CidContext[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [activeCid, setActiveCid] = useState<number | null>(null);
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
  // Fetch the APN setting + live CID contexts
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ApnSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error ?? "Failed to fetch APN settings");
        return;
      }

      setApn(data.apn);
      setCids(data.cids ?? []);
      setActive(typeof data.active === "number" ? data.active : null);
      setActiveCid(
        typeof data.active_cid === "number" ? data.active_cid : null
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch APN settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Optimistically reflect a just-applied APN on its live CID so the honest
  // badge doesn't flash "Not live" against a stale cids[] snapshot during the
  // ~1.5s before the reconcile confirms. The reconcile is the source of truth —
  // if the carrier overrode the APN, it flips back to "Not live" with the real
  // value.
  // ---------------------------------------------------------------------------
  const patchCidApn = useCallback((cid: number, newApn: string) => {
    setCids((prev) =>
      prev ? prev.map((c) => (c.cid === cid ? { ...c, apn: newApn } : c)) : prev
    );
  }, []);

  const scheduleReconcile = useCallback(() => {
    setTimeout(() => {
      if (mountedRef.current) fetchSettings(true);
    }, RECONCILE_DELAY_MS);
  }, [fetchSettings]);

  // Shared POST wrapper. Returns the parsed body on HTTP success, or throws.
  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<ApnSaveResponse> => {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return (await resp.json()) as ApnSaveResponse;
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Save — writes the APN and runs a COPS cycle (brief WAN drop).
  // ---------------------------------------------------------------------------
  const save = useCallback(
    async (request: ApnSaveRequest): Promise<boolean> => {
      setError(null);
      setIsSaving(true);
      try {
        const data = await postAction({ action: "save", ...request });
        if (!mountedRef.current) return false;
        if (!data.success) {
          setError(data.error ?? "Failed to save APN");
          return false;
        }
        // Optimistic update: reflect the stored setting immediately.
        setApn(request);
        setActive(1);
        // Reflect on the live CID so the "Active vs Not live" badge doesn't
        // flash "Not live" before the reconcile picks up the modem's response.
        patchCidApn(request.cid, request.apn);
        scheduleReconcile();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to save APN");
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [postAction, patchCidApn, scheduleReconcile]
  );

  // ---------------------------------------------------------------------------
  // Deactivate — revert to carrier-default APN (active=0).
  // ---------------------------------------------------------------------------
  const deactivate = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsSaving(true);
    try {
      const data = await postAction({ action: "deactivate" });
      if (!mountedRef.current) return false;
      if (!data.success) {
        setError(data.error ?? "Failed to use carrier default");
        return false;
      }
      setActive(0);
      scheduleReconcile();
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(
        err instanceof Error ? err.message : "Failed to use carrier default"
      );
      return false;
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [postAction, scheduleReconcile]);

  return {
    apn,
    cids,
    active,
    activeCid,
    isLoading,
    isSaving,
    error,
    save,
    deactivate,
    refresh: fetchSettings,
  };
}

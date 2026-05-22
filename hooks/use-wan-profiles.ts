"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  WanProfile,
  WanProfilesResponse,
  WanProfileSaveRequest,
  WanProfileSaveResponse,
  WanProfileToggleRequest,
} from "@/types/wan-profiles";

// =============================================================================
// useWanProfiles — WAN Profile Management Hook
// =============================================================================
// Fetches WAN profiles (up to 6 slots) on mount. The backend reports its
// data source: "rdb" (Casa wmmd) or "at" (AT-only, e.g. RM520N-GL).
// Provides saveProfile and toggleProfile for configuration changes via POST.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/apn.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/apn.sh";

// After a successful POST on the RDB path, optimistically merge the request
// into local state so the UI updates instantly, then kick off a background
// reconciliation fetch as a safety net against a racing wmmd readback.
//
// On the AT path the reconcile is skipped entirely: the CGI write is fully
// synchronous and there is no daemon to race. A reconcile would also be
// wasteful — an AT `list` runs ~5+ serialized AT commands (2-4 s), so a
// short-delay fetch would just pull stale data mid-flight.
const RECONCILE_DELAY_MS = 1000;

export interface UseWanProfilesReturn {
  /** All WAN profiles from RDB (null before first fetch) */
  profiles: WanProfile[] | null;
  /** Maximum number of profile slots (typically 6) */
  maxProfiles: number;
  /** Backend data source ("rdb" or "at"); drives which controls the UI shows */
  dataSource: "rdb" | "at";
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save/toggle operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Save a profile's configuration. Returns true on success. */
  saveProfile: (index: number, request: WanProfileSaveRequest) => Promise<boolean>;
  /** Toggle a profile's enabled state. Returns true on success. */
  toggleProfile: (index: number, enabled: boolean) => Promise<boolean>;
  /** Re-fetch all WAN profiles from RDB */
  refresh: () => void;
}

export function useWanProfiles(): UseWanProfilesReturn {
  const [profiles, setProfiles] = useState<WanProfile[] | null>(null);
  const [maxProfiles, setMaxProfiles] = useState(6);
  const [dataSource, setDataSource] = useState<"rdb" | "at">("at");
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
  // Fetch WAN profiles
  // ---------------------------------------------------------------------------
  const fetchProfiles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: WanProfilesResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch WAN profiles");
        return;
      }

      setProfiles(data.profiles);
      setMaxProfiles(data.max_profiles);
      setDataSource(data.data_source === "rdb" ? "rdb" : "at");
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch WAN profiles"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // ---------------------------------------------------------------------------
  // Merge a partial update into the matching profile slot. Returns immediately;
  // a background fetch reconciles with reality shortly after.
  // ---------------------------------------------------------------------------
  const applyOptimistic = useCallback(
    (index: number, patch: Partial<WanProfile>) => {
      setProfiles((prev) =>
        prev ? prev.map((p) => (p.index === index ? { ...p, ...patch } : p)) : prev
      );
    },
    []
  );

  // Fire-and-forget background fetch to reconcile optimistic state against
  // the canonical read. On the RDB path this is a safety net against a
  // racing wmmd readback. On the AT path the CGI write is synchronous and
  // there is no racing daemon, so the reconcile is skipped entirely.
  const scheduleReconcile = useCallback(() => {
    if (dataSource === "at") return;
    setTimeout(() => {
      if (mountedRef.current) fetchProfiles(true);
    }, RECONCILE_DELAY_MS);
  }, [fetchProfiles, dataSource]);

  // ---------------------------------------------------------------------------
  // Save profile configuration
  // ---------------------------------------------------------------------------
  const saveProfile = useCallback(
    async (index: number, request: WanProfileSaveRequest): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", index, ...request }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: WanProfileSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.error || "Failed to save WAN profile");
          return false;
        }

        // Optimistically reflect the save in local state for 0ms perceived
        // feedback. On RDB a background reconcile follows; on AT the write
        // is synchronous so the optimistic patch is already canonical.
        applyOptimistic(index, {
          name: request.name,
          apn: request.apn,
          pdp_type: request.pdp_type,
          auth_type: request.auth_type,
          username: request.username,
          mtu: request.mtu,
          ip_passthrough: request.ip_passthrough,
          modem_profile: request.modem_profile,
          default_route: request.default_route,
          vlan_index: request.vlan_index,
        });
        scheduleReconcile();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save WAN profile"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [applyOptimistic, scheduleReconcile]
  );

  // ---------------------------------------------------------------------------
  // Toggle profile enabled/disabled
  // ---------------------------------------------------------------------------
  const toggleProfile = useCallback(
    async (index: number, enabled: boolean): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", index, enabled } as WanProfileToggleRequest & { action: string }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: WanProfileSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.error || "Failed to toggle WAN profile");
          return false;
        }

        applyOptimistic(index, { enabled });
        scheduleReconcile();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to toggle WAN profile"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [applyOptimistic, scheduleReconcile]
  );

  return {
    profiles,
    maxProfiles,
    dataSource,
    isLoading,
    isSaving,
    error,
    saveProfile,
    toggleProfile,
    refresh: fetchProfiles,
  };
}

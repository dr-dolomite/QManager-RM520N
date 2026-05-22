"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SimProfile,
  ProfileSummary,
  ProfileListResponse,
  ProfileApiResponse,
} from "@/types/sim-profile";

// =============================================================================
// useSimProfiles — CRUD Hook for QManager Custom SIM Profiles
// =============================================================================
// Manages the full profile lifecycle: list, create, update, delete.
// Reads from /cgi-bin/quecmanager/profiles/ endpoints.
//
// No modem interaction — all operations read/write flash only.
// Apply operations are handled by the separate useProfileApply hook.
//
// Usage:
//   const {
//     profiles, activeProfileId, isLoading, error,
//     createProfile, updateProfile, deleteProfile, refresh
//   } = useSimProfiles();
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/profiles";

export interface UseSimProfilesReturn {
  /** Array of profile summaries (for list view) */
  profiles: ProfileSummary[];
  /** Currently active profile ID, or null */
  activeProfileId: string | null;
  /** True during initial fetch */
  isLoading: boolean;
  /** Error message from the last operation */
  error: string | null;
  /** Create a new profile. Returns the new profile ID on success. */
  createProfile: (data: ProfileFormData) => Promise<string | null>;
  /** Update an existing profile. Returns success boolean. */
  updateProfile: (id: string, data: ProfileFormData) => Promise<boolean>;
  /** Delete a profile by ID. Returns success boolean. */
  deleteProfile: (id: string) => Promise<boolean>;
  /** Fetch a single profile by ID (full data for edit form). */
  getProfile: (id: string) => Promise<SimProfile | null>;
  /** Deactivate the current active profile (clears marker only, no modem changes). */
  deactivateProfile: () => Promise<boolean>;
  /** Manually refresh the profile list */
  refresh: () => void;
}

/**
 * Flat form data shape that the backend save.sh endpoint expects.
 * This matches the jq field keys in profile_mgr.sh's profile_save().
 */
export interface ProfileFormData {
  name: string;
  mno: string;
  sim_iccid: string;
  /** APN context ID (1-15) */
  cid: number;
  /** APN name */
  apn_name: string;
  pdp_type: string;
  imei: string;
  ttl: number;
  hl: number;
  /**
   * Connection Scenario binding. Empty string = no scenario (profile won't
   * manage radio config). Valid IDs: "balanced" | "gaming" | "streaming" |
   * "custom-<ts>". Sent to backend as the `scenario_id` JSON field.
   */
  scenario_id: string;
}

export function useSimProfiles(): UseSimProfilesReturn {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch profile list
  // ---------------------------------------------------------------------------
  const fetchProfiles = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ProfileListResponse = await resp.json();
      if (!mountedRef.current) return;

      setProfiles(data.profiles || []);
      setActiveProfileId(data.active_profile_id || null);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load profiles"
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // ---------------------------------------------------------------------------
  // Create profile
  // ---------------------------------------------------------------------------
  const createProfile = useCallback(
    async (data: ProfileFormData): Promise<string | null> => {
      setError(null);
      try {
        const resp = await authFetch(`${CGI_BASE}/save.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: ProfileApiResponse = await resp.json();

        if (!result.success) {
          setError(result.detail || result.error || "Failed to create profile");
          return null;
        }

        // Refresh the list to pick up the new profile
        await fetchProfiles();
        return result.id || null;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create profile";
        setError(msg);
        return null;
      }
    },
    [fetchProfiles]
  );

  // ---------------------------------------------------------------------------
  // Update profile
  // ---------------------------------------------------------------------------
  const updateProfile = useCallback(
    async (id: string, data: ProfileFormData): Promise<boolean> => {
      setError(null);
      try {
        // Include the existing ID so profile_save() knows it's an update
        const payload = { ...data, id };
        const resp = await authFetch(`${CGI_BASE}/save.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: ProfileApiResponse = await resp.json();

        if (!result.success) {
          setError(result.detail || result.error || "Failed to update profile");
          return false;
        }

        await fetchProfiles();
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to update profile";
        setError(msg);
        return false;
      }
    },
    [fetchProfiles]
  );

  // ---------------------------------------------------------------------------
  // Delete profile
  // ---------------------------------------------------------------------------
  const deleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const resp = await authFetch(`${CGI_BASE}/delete.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: ProfileApiResponse = await resp.json();

        if (!result.success) {
          setError(result.detail || result.error || "Failed to delete profile");
          return false;
        }

        await fetchProfiles();
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to delete profile";
        setError(msg);
        return false;
      }
    },
    [fetchProfiles]
  );

  // ---------------------------------------------------------------------------
  // Deactivate active profile
  // ---------------------------------------------------------------------------
  const deactivateProfile = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const resp = await authFetch(`${CGI_BASE}/deactivate.sh`, {
        method: "POST",
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const result: ProfileApiResponse = await resp.json();

      if (!result.success) {
        setError(
          result.detail || result.error || "Failed to deactivate profile"
        );
        return false;
      }

      await fetchProfiles();
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to deactivate profile";
      setError(msg);
      return false;
    }
  }, [fetchProfiles]);

  // ---------------------------------------------------------------------------
  // Get single profile (for edit form)
  // ---------------------------------------------------------------------------
  const getProfile = useCallback(
    async (id: string): Promise<SimProfile | null> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/get.sh?id=${encodeURIComponent(id)}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();

        // The get endpoint returns the full profile on success,
        // or { success: false, error: "..." } on failure.
        if (data.success === false) {
          setError(data.detail || data.error || "Profile not found");
          return null;
        }

        return data as SimProfile;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to load profile";
        setError(msg);
        return null;
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    activeProfileId,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    deactivateProfile,
    getProfile,
    refresh,
  };
}

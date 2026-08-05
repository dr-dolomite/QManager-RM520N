"use client";

import {
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
  createContext,
  createElement,
  type ReactNode,
} from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SimProfile,
  ProfileSummary,
  ProfileListResponse,
  ProfileApiResponse,
  ProfileScenarioBinding,
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
//
// OPTIONAL SHARED FETCH. Wrapping a subtree in {@link SimProfilesProvider}
// makes every `useSimProfiles()` inside it — and `useActiveProfile()`, which
// derives from the same list — share ONE fetch of `profiles/list.sh`. Strictly
// opt-in: callers mounted without a provider (the APN page, the TTL card, band
// locking) keep fetching for themselves, unchanged.
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/profiles";

// =============================================================================
// DEACTIVATE RECONCILIATION — surviving the LAN link drop
// =============================================================================
// `deactivate.sh` is the only modem mutation on this surface that answers its
// own HTTP request (apply spawns a detached worker and the UI polls a state
// file). That matters because of a stock-firmware behaviour measured on a live
// RM520N-GL: every time `apn_apply_write` re-attaches the data call, the modem
// restarts dnsmasq twice and BOUNCES THE ETHERNET PHY for ~4 seconds.
//
//   13:33:42  Profile deactivate request
//   13:33:49  r8125: eth0: link down        <- browser's TCP connection dies
//   13:33:50  EVENT [apn_apply_done] CID 1 reverted to carrier default
//   13:33:52  EVENT [profile_deactivated] Profile 'Globe' deactivated
//   13:33:53  r8125: eth0: link up
//
// The work always finishes; the RESPONSE is written into a socket that no
// longer exists, ~3s into a ~4s outage. The browser surfaces that as a bare
// `TypeError` ("NetworkError when attempting to fetch resource"), and the old
// code reported it as `network_error` — a failure toast on an operation that
// had in fact succeeded, on essentially every run.
//
// A transport failure here is therefore not evidence of anything. It is the
// EXPECTED shape of a successful deactivate, and the only honest response is to
// go and look: `list.sh` is a plain disk read (no AT lock, no modem contact),
// and the active-profile marker it reports is the device's own answer.
//
//   marker cleared   -> the run reached `clear_active_profile`; success.
//   still set at the -> either the APN revert failed (the endpoint exits before
//   ceiling             clearing the marker) or the box never came back. Those
//                       are indistinguishable from here, so we say exactly that
//                       and never guess — see `link_lost` in the caller.
//
// The ceiling covers the endpoint's own worst case (~33s of AT timings, per the
// note on `DeactivateProgressDialog`) plus the link outage, with headroom.
const DEACTIVATE_RECONCILE_TIMEOUT_MS = 45_000;
const DEACTIVATE_RECONCILE_INTERVAL_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The outcome of a deactivate attempt, structured rather than boolean.
 *
 * WHY THIS IS NOT A BOOLEAN. `deactivate.sh` distinguishes five materially
 * different failures, and flattening them into one `error` string made a
 * retryable "the modem was busy and nothing was touched" render identically to
 * "your WAN may be down". The caller needs the CODE to pick a tone, and the
 * `detail` string to tell the two `cops_attach_failed` sub-cases apart:
 *
 *   apn_busy            rc=7. Another APN bracket holds the lock; NO AT command
 *                       was issued at all. Fully retryable, nothing changed.
 *   cops_attach_failed  rc=3 (detail says "may be DEREGISTERED") — `AT+COPS=0`
 *                       failed all three retries and the modem may have no data.
 *                       The one case that earns a destructive tone.
 *                       rc=5 (detail says "returned no data after") — it DID
 *                       re-attach but `AT+CGCONTRDP` never confirmed. Ambiguous,
 *                       so warning, not destructive.
 *   cgdcont_failed      rc=1. The write failed; the modem is untouched.
 *   cops_detach_failed  rc=2. The detach failed; the modem is untouched.
 *   apn_revert_failed   catch-all.
 *
 * Two codes are synthesised client-side, both for the case where the request
 * never produced a JSON envelope at all (see the RECONCILIATION block at the
 * top of this file — the modem drops the LAN link mid-request, so this is the
 * NORMAL outcome of a successful deactivate, not an edge case):
 *
 *   link_lost           the connection dropped AND the marker was still set
 *                       when the reconcile poll gave up. Genuinely unknown:
 *                       could be a failed APN revert, could be a box that never
 *                       came back. The copy says so and tells the user to look.
 *   network_error       the connection dropped and the reconcile poll itself
 *                       could not be run (kept for callers branching on it).
 */
export interface DeactivateResult {
  ok: boolean;
  /** The backend's `error` code, or a synthesised one. Absent on success. */
  error?: string;
  /** The backend's `detail` message. Absent on success. */
  detail?: string;
}

/** Optional callbacks for a deactivate round trip. */
export interface DeactivateOptions {
  /**
   * Fires ONCE, when the request has failed at the transport layer and the
   * hook has begun reconciling against `list.sh`. The caller uses it to tell
   * the user what the pause is — the modem's own LAN link is down, which is
   * both the reason the answer was lost and the reason it takes a few seconds
   * to get one. It is never called on a clean request.
   */
  onReconcile?: () => void;
}

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
  /**
   * Deactivate the current active profile.
   *
   * NOT a marker-only write, despite what this line used to claim:
   * `deactivate.sh` reverts CID 1's APN to the carrier default through the
   * shared attach-cycle primitive BEFORE it clears any profile state, so it
   * costs a full detach/attach round trip on the modem.
   */
  deactivateProfile: (opts?: DeactivateOptions) => Promise<DeactivateResult>;
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
   * Connection-scenario binding (nested object the backend save.sh accepts).
   * Always sent — defaults to {@link DEFAULT_SCENARIO_BINDING} in the form.
   * The backend mirrors `scenario.default` onto `settings.scenario_id`
   * server-side (single chokepoint in profile_save()).
   */
  scenario: ProfileScenarioBinding;
}

/**
 * The real implementation.
 *
 * `enabled` gates the FETCH EFFECT only — never the hook itself. The public
 * `useSimProfiles` below always calls this; skipping a hook when a context is
 * present would break the Rules of Hooks.
 */
function useSimProfilesInternal({
  enabled,
}: {
  enabled: boolean;
}): UseSimProfilesReturn {
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
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial load — suppressed when a provider above us already owns one. The
  // early return is inside the effect, not before the hook.
  useEffect(() => {
    if (!enabled) return;
    fetchProfiles();
  }, [enabled, fetchProfiles]);

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
    [fetchProfiles],
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
    [fetchProfiles],
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
    [fetchProfiles],
  );

  // ---------------------------------------------------------------------------
  // Deactivate active profile
  // ---------------------------------------------------------------------------
  /**
   * Poll `list.sh` until the active-profile marker clears, or give up.
   *
   * Deliberately does NOT touch hook state on the way — every intermediate
   * response is a snapshot of a device mid-mutation, and pushing those into
   * `profiles` would flicker the list while the user watches a modal. Only the
   * verdict matters, and the caller runs one final `fetchProfiles()` on it.
   *
   * Each poll can itself fail (the link is, by construction, down when this
   * starts) — a failed poll is not an answer, so it is swallowed and retried.
   */
  const reconcileDeactivate = useCallback(async (): Promise<
    "cleared" | "still_active"
  > => {
    const deadline = Date.now() + DEACTIVATE_RECONCILE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(DEACTIVATE_RECONCILE_INTERVAL_MS);
      if (!mountedRef.current) return "still_active";
      try {
        const resp = await authFetch(`${CGI_BASE}/list.sh`);
        if (!resp.ok) continue;
        const data: ProfileListResponse = await resp.json();
        if (!data.active_profile_id) return "cleared";
      } catch {
        // The LAN link is still down. Not an answer — keep asking.
      }
    }
    return "still_active";
  }, []);

  const deactivateProfile = useCallback(
    async (opts?: DeactivateOptions): Promise<DeactivateResult> => {
      setError(null);
      // Distinguishes "the server answered and said no" from "we never heard
      // back at all". Only the second is reconcilable: a status line is a real
      // answer from a reachable device, and re-reading state for 45s to
      // second-guess it would turn a plain 500 into a long silent hang. A
      // dropped connection, by contrast, never produces a status at all — it
      // rejects the fetch — so the two cases are cleanly separable here.
      let sawHttpStatusError = false;
      try {
        const resp = await authFetch(`${CGI_BASE}/deactivate.sh`, {
          method: "POST",
        });

        if (!resp.ok) {
          sawHttpStatusError = true;
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: ProfileApiResponse = await resp.json();

        if (!result.success) {
          setError(
            result.detail || result.error || "Failed to deactivate profile",
          );
          // DELIBERATELY RETURNS BEFORE `fetchProfiles()`, and no `finally` may
          // ever be added here. `deactivate.sh` exits 0 on any APN-revert failure
          // BEFORE `clear_active_profile` runs, so on this path the profile
          // genuinely IS still active and its schedule timer is still armed. A
          // blanket refetch would be honest by accident at best; leaving the list
          // untouched keeps the hero showing exactly what the device still has.
          return {
            ok: false,
            error: result.error || "deactivate_failed",
            detail: result.detail,
          };
        }

        await fetchProfiles();
        return { ok: true };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to deactivate profile";

        // The device answered, it just answered badly. Report that, unchanged.
        if (sawHttpStatusError) {
          setError(msg);
          return { ok: false, error: "network_error", detail: msg };
        }

        // No answer at all. Per the RECONCILIATION block at the top of this file, that
        // is what a SUCCESSFUL deactivate looks like from the browser, so the one
        // thing we must not do is call it a failure. Go and read the device.
        opts?.onReconcile?.();
        const outcome = await reconcileDeactivate();

        if (outcome === "cleared") {
          await fetchProfiles();
          return { ok: true };
        }

        // Still marked active at the ceiling. Two very different causes — a
        // failed APN revert (the endpoint exits before clearing the marker) or a
        // device still unreachable — and nothing here can tell them apart, so
        // the code says "unknown" rather than picking one. No refetch: the list
        // is either already current or unreadable.
        setError(msg);
        return { ok: false, error: "link_lost", detail: msg };
      }
    },
    [fetchProfiles, reconcileDeactivate],
  );

  // ---------------------------------------------------------------------------
  // Get single profile (for edit form)
  // ---------------------------------------------------------------------------
  const getProfile = useCallback(
    async (id: string): Promise<SimProfile | null> => {
      try {
        const resp = await authFetch(
          `${CGI_BASE}/get.sh?id=${encodeURIComponent(id)}`,
        );
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
    [],
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

// =============================================================================
// Shared-fetch context
// =============================================================================

const SimProfilesContext = createContext<UseSimProfilesReturn | null>(null);

/**
 * Wrap a subtree so every `useSimProfiles()` inside it — and every
 * `useActiveProfile()`, which derives from the same list — shares ONE fetch of
 * `profiles/list.sh`.
 *
 * `createElement` rather than JSX so this module stays a `.ts` file.
 */
export function SimProfilesProvider({ children }: { children: ReactNode }) {
  const value = useSimProfilesInternal({ enabled: true });
  return createElement(SimProfilesContext.Provider, { value }, children);
}

/**
 * The shared instance, or `null` when no provider is mounted above.
 * Exported for `use-active-profile.ts`.
 */
export function useSharedSimProfiles(): UseSimProfilesReturn | null {
  return useContext(SimProfilesContext);
}

export function useSimProfiles(): UseSimProfilesReturn {
  const shared = useContext(SimProfilesContext);
  // Both are ALWAYS evaluated — see the note in use-connection-scenarios.ts.
  const own = useSimProfilesInternal({ enabled: shared === null });
  return shared ?? own;
}

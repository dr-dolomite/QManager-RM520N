"use client";

import { useCallback, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  matchCarrierSuggestions,
  iccidMatches,
  canonicalizeIccid,
} from "@/lib/carrier-match";
import { type ProfileSuggestion } from "@/constants/profile-suggestions";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import {
  DEFAULT_SCENARIO_BINDING,
  type ProfileSummary,
} from "@/types/sim-profile";
import type {
  ScenarioApiResponse,
  ScenarioListResponse,
} from "@/types/connection-scenario";

// =============================================================================
// useProfileSuggestions — "Recommended for your SIM" logic
// =============================================================================
// Adds NO endpoint and NO poll. Everything it needs already exists on the page:
// the PLMN + ICCID from profiles/current_settings.sh, the saved-profile list
// from profiles/list.sh, and the modem's supported band lists from the status
// poll. The caller injects all of it, which keeps this hook a pure decision
// layer over data that is already on screen and avoids a second 2s poller.
//
// Visibility is deliberately derived, never persisted. There is no "dismissed"
// flag: config.sh's qm_config_init only seeds an empty file and the project has
// no key-migration primitive, so a new persisted key would silently do nothing
// on every OTA-upgraded device. Instead the section hides the moment a profile
// exists for the inserted SIM, and reappears by itself if that profile is
// deleted.
// =============================================================================

const SCENARIO_BASE = "/cgi-bin/quecmanager/scenarios";

/**
 * Scenario bound when a suggestion recommends no band lock.
 *
 * `"balanced"` is a BUILT-IN scenario, and that is the whole point. Binding a
 * `custom-*` scenario disables the Band Locking page — client-side and again
 * server-side in `scenarios/activate.sh` — so a profile that locks nothing
 * must not bind one. Otherwise an APN-only suggestion would silently cost the
 * user their manual band controls in exchange for nothing at all.
 */
const NO_BAND_SCENARIO_ID = DEFAULT_SCENARIO_BINDING.default;

/** Colon-delimited band string → sorted unique numbers. Tolerates junk. */
function parseBandList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const out = new Set<number>();
  for (const part of raw.split(":")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Bands as the backend stores them: bare ascending decimals, colon-joined. */
export function bandsToColonString(bands: number[]): string {
  return [...bands].sort((a, b) => a - b).join(":");
}

/**
 * Intersect a recommendation with what the modem reports it supports.
 *
 * Locking a band the radio cannot use is worse than not locking at all: the
 * scenario would narrow the radio to a set it can never camp on. When the
 * supported list is unknown (status has not landed yet, or the field is empty)
 * we return an empty set, and the caller omits the lock entirely — Auto bands,
 * which is always safe.
 */
function intersectSupported(
  recommended: number[],
  supportedRaw: string | null | undefined,
): number[] {
  const supported = parseBandList(supportedRaw);
  if (supported.length === 0) return [];
  const set = new Set(supported);
  return recommended.filter((b) => set.has(b)).sort((a, b) => a - b);
}

/** A suggestion plus the band lock that would actually be written for it. */
export interface SuggestionView {
  suggestion: ProfileSuggestion;
  /** NSA bands after intersection with modem support. Empty = no lock (Auto). */
  nsaBands: number[];
  /** SA bands after intersection with modem support. Empty = no lock (Auto). */
  saBands: number[];
}

export interface UseProfileSuggestionsInput {
  /** Mobile country code from current_settings.sh. */
  mcc: string | null | undefined;
  /** Mobile network code from current_settings.sh. */
  mnc: string | null | undefined;
  /**
   * EF_SPN service-provider name from current_settings.sh. Used only to
   * SUPPRESS suggestions when the SIM names a known reseller — never to
   * produce them. Optional; `""` is normal and means "SIM did not say".
   */
  spn?: string | null;
  /** EF_PNN full network name from current_settings.sh. Same role as `spn`. */
  networkName?: string | null;
  /**
   * Live SIM ICCID. Prefer current_settings.sh's value — it is already
   * canonicalized backend-side — over modem status's raw copy.
   */
  currentIccid: string | null | undefined;
  /** Saved profiles, so we can tell whether this SIM is already covered. */
  profiles: ProfileSummary[];
  /** `device.supported_nsa_nr5g_bands` from modem status (colon-delimited). */
  supportedNsaBands?: string | null;
  /** `device.supported_sa_nr5g_bands` from modem status (colon-delimited). */
  supportedSaBands?: string | null;
  /** The page's existing create path (POST profiles/save.sh). */
  createProfile: (data: ProfileFormData) => Promise<string | null>;
}

export interface UseProfileSuggestionsReturn {
  /** Suggestions to render. Empty whenever the section should not appear. */
  suggestions: SuggestionView[];
  /** Convenience: true when there is something to show. */
  hasSuggestions: boolean;
  /** Suggestion id currently being created, or null. */
  creatingId: string | null;
  /** Backend error from the last create attempt (already human-readable). */
  error: string | null;
  /** Clear the error banner. */
  clearError: () => void;
  /** Materialize a suggestion as a real profile. Returns the new profile id. */
  createFromSuggestion: (suggestionId: string) => Promise<string | null>;
}

export function useProfileSuggestions({
  mcc,
  mnc,
  spn,
  networkName,
  currentIccid,
  profiles,
  supportedNsaBands,
  supportedSaBands,
  createProfile,
}: UseProfileSuggestionsInput): UseProfileSuggestionsReturn {
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const iccid = canonicalizeIccid(currentIccid);

  // A SIM is "covered" once any saved profile carries its ICCID. This single
  // test satisfies both requirements at once — hide after a suggestion was
  // created, and hide when a profile already exists for the inserted SIM — and
  // it self-heals when that profile is deleted.
  const simAlreadyCovered = useMemo(
    () => profiles.some((p) => iccidMatches(p.sim_iccid, iccid)),
    [profiles, iccid],
  );

  const suggestions = useMemo<SuggestionView[]>(() => {
    if (!iccid) return [];
    if (simAlreadyCovered) return [];
    return matchCarrierSuggestions(mcc ?? "", mnc ?? "", spn, networkName).map(
      (suggestion) => ({
        suggestion,
        nsaBands: intersectSupported(suggestion.nsa_nr_bands, supportedNsaBands),
        saBands: intersectSupported(suggestion.sa_nr_bands, supportedSaBands),
      }),
    );
  }, [
    iccid,
    simAlreadyCovered,
    mcc,
    mnc,
    spn,
    networkName,
    supportedNsaBands,
    supportedSaBands,
  ]);

  const clearError = useCallback(() => setError(null), []);

  // ---------------------------------------------------------------------------
  // Create — one call, or two when a band lock is involved.
  //
  // When the suggestion carries bands, the scenario must land BEFORE the
  // profile: profile_mgr.sh rejects a save naming a scenario id that does not
  // exist yet ("Unknown connection scenario: <id>."). When it carries none,
  // there is no scenario call at all and the profile binds the built-in.
  // ---------------------------------------------------------------------------
  const createFromSuggestion = useCallback(
    async (suggestionId: string): Promise<string | null> => {
      const view = suggestions.find((v) => v.suggestion.id === suggestionId);
      if (!view || creatingId) return null;

      const { suggestion, nsaBands, saBands } = view;
      setError(null);
      setCreatingId(suggestionId);

      // Tracked so rollback only ever deletes a scenario WE created. A reused
      // scenario may be bound to other profiles and must never be removed.
      let createdScenarioId: string | null = null;

      // A scenario is worth creating ONLY when there is an actual band lock to
      // put in it. Two ways that fails, and both must land on the built-in:
      //
      //   1. The suggestion recommends no bands at all (every carrier except
      //      the T-Mobile pair) — `scenario_name` is undefined.
      //   2. The suggestion recommends bands, but none survived intersection
      //      with what the modem reports it supports.
      //
      // Case 2 is the subtle one. Before this check, a T-Mobile suggestion on a
      // modem whose supported-band list had not yet landed would create a
      // `custom-*` scenario containing two EMPTY band strings — locking
      // nothing, while still tripping the `custom-*` gate that disables the
      // Band Locking page. Strictly worse than binding the built-in.
      const hasBandLock = nsaBands.length > 0 || saBands.length > 0;
      const scenarioName = suggestion.scenario_name;
      const wantsScenario = hasBandLock && !!scenarioName;

      try {
        // -- Step 1: reuse an existing scenario with the same name if present --
        let scenarioId: string = NO_BAND_SCENARIO_ID;

        if (wantsScenario) {
          let foundId: string | null = null;
          try {
            const listResp = await authFetch(`${SCENARIO_BASE}/list.sh`);
            if (listResp.ok) {
              const listData: ScenarioListResponse = await listResp.json();
              const existing = (listData.scenarios || []).find(
                (s) => s.name === scenarioName,
              );
              if (existing) foundId = existing.id;
            }
          } catch {
            // A failed lookup is not fatal — fall through and create a new one.
          }

          // -- Step 2: create the scenario if it does not exist yet -----------
          if (foundId) {
            scenarioId = foundId;
          } else {
            const scenarioBody = {
              name: scenarioName,
              description: `${suggestion.mno} recommended 5G bands`,
              // Auto-created from a carrier recommendation rather than picked
              // in the dialog, so it takes a fixed glyph.
              icon: "rocket",
              config: {
                atModeValue: "AUTO",
                mode: "Auto",
                optimization: "Custom",
                lte_bands: "",
                nsa_nr_bands: bandsToColonString(nsaBands),
                sa_nr_bands: bandsToColonString(saBands),
              },
            };

            const resp = await authFetch(`${SCENARIO_BASE}/save.sh`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(scenarioBody),
            });
            if (!resp.ok) {
              throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }
            const result: ScenarioApiResponse = await resp.json();
            if (!result.success || !result.id) {
              // Surfaces the real backend detail, including the
              // MAX_SCENARIOS=20 limit_reached case.
              throw new Error(
                result.detail || result.error || "Failed to create scenario",
              );
            }
            scenarioId = result.id;
            createdScenarioId = result.id;
          }
        }

        // -- Step 3: create the profile bound to that scenario -----------------
        const formData: ProfileFormData = {
          name: suggestion.label,
          mno: suggestion.mno,
          sim_iccid: iccid,
          cid: suggestion.cid,
          apn_name: suggestion.apn_name,
          pdp_type: suggestion.pdp_type,
          imei: "",
          ttl: suggestion.ttl,
          hl: suggestion.hl,
          scenario: {
            default: scenarioId,
            schedule: { enabled: false, blocks: [] },
          },
        };

        const newId = await createProfile(formData);

        if (!newId) {
          // -- Step 4: rollback ----------------------------------------------
          // Only the scenario this call created gets removed, so a failed
          // profile save never leaves an orphan on flash — and never deletes a
          // scenario other profiles may be bound to.
          if (createdScenarioId) {
            try {
              await authFetch(`${SCENARIO_BASE}/delete.sh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: createdScenarioId }),
              });
            } catch {
              // Best effort — the profile error below is the one that matters.
            }
          }
          // The profile error itself lives on useSimProfiles (it holds the
          // backend detail, incl. the MAX_PROFILES=10 limit). We only note that
          // the rollback happened, so the two errors never contradict.
          setError(null);
          return null;
        }

        return newId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || null);
        return null;
      } finally {
        setCreatingId(null);
      }
    },
    [suggestions, creatingId, iccid, createProfile],
  );

  return {
    suggestions,
    hasSuggestions: suggestions.length > 0,
    creatingId,
    error,
    clearError,
    createFromSuggestion,
  };
}

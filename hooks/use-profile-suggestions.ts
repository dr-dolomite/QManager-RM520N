"use client";

import { useCallback, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  matchCarrierSuggestions,
  iccidMatches,
  canonicalizeIccid,
} from "@/lib/carrier-match";
import {
  TMOBILE_SCENARIO_NAME,
  type ProfileSuggestion,
} from "@/constants/profile-suggestions";
import type { ProfileFormData } from "@/hooks/use-sim-profiles";
import type { ProfileSummary } from "@/types/sim-profile";
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
    return matchCarrierSuggestions(mcc ?? "", mnc ?? "").map((suggestion) => ({
      suggestion,
      nsaBands: intersectSupported(suggestion.nsa_nr_bands, supportedNsaBands),
      saBands: intersectSupported(suggestion.sa_nr_bands, supportedSaBands),
    }));
  }, [iccid, simAlreadyCovered, mcc, mnc, supportedNsaBands, supportedSaBands]);

  const clearError = useCallback(() => setError(null), []);

  // ---------------------------------------------------------------------------
  // Create — a two-call sequence, ordered because the backend requires it.
  // profile_mgr.sh rejects a save whose scenario id does not exist yet
  // ("Unknown connection scenario: <id>."), so the scenario must land first.
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

      try {
        // -- Step 1: reuse an existing scenario with the same name if present --
        let scenarioId: string | null = null;
        try {
          const listResp = await authFetch(`${SCENARIO_BASE}/list.sh`);
          if (listResp.ok) {
            const listData: ScenarioListResponse = await listResp.json();
            const existing = (listData.scenarios || []).find(
              (s) => s.name === TMOBILE_SCENARIO_NAME,
            );
            if (existing) scenarioId = existing.id;
          }
        } catch {
          // A failed lookup is not fatal — fall through and create a new one.
        }

        // -- Step 2: create the scenario if it does not exist yet -------------
        if (!scenarioId) {
          const scenarioBody = {
            name: TMOBILE_SCENARIO_NAME,
            description: `${suggestion.mno} recommended 5G bands`,
            gradient: "from-fuchsia-500 via-pink-600 to-rose-600",
            config: {
              atModeValue: "AUTO",
              mode: "Auto",
              optimization: "Custom",
              lte_bands: "",
              // An empty intersection means "we could not confirm the modem
              // supports these" — write no lock rather than a lock it cannot use.
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
            // Surfaces the real backend detail, including the MAX_SCENARIOS=20
            // limit_reached case.
            throw new Error(
              result.detail || result.error || "Failed to create scenario",
            );
          }
          scenarioId = result.id;
          createdScenarioId = result.id;
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

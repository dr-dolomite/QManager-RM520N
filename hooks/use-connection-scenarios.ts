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
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  ScenarioListResponse,
  ScenarioActivateResponse,
  ScenarioApiResponse,
  ScenarioConfig,
  StoredScenario,
} from "@/types/connection-scenario";

// =============================================================================
// useConnectionScenarios — Active Scenario State, Activation & CRUD Hook
// =============================================================================
// Manages the full lifecycle: list custom scenarios, track which scenario is
// active, handle activation (AT commands), and CRUD for custom scenarios.
//
// All custom scenario definitions are stored on the modem (not localStorage)
// so they persist across browsers/devices.
//
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/scenarios/list.sh      → custom scenarios + active ID
//   POST /cgi-bin/quecmanager/scenarios/activate.sh   → apply scenario
//   POST /cgi-bin/quecmanager/scenarios/save.sh       → save custom scenario
//   POST /cgi-bin/quecmanager/scenarios/delete.sh     → delete custom scenario
//
// OPTIONAL SHARED FETCH. `/cellular/custom-profiles` mounts four consumers of
// `scenarios/list.sh` on one page (the hero, the scenarios card, the profile
// list's `nameForId`, and the wizard's ScenarioPicker), so it fired the same
// endpoint four times per mount. Wrapping a subtree in
// {@link ConnectionScenariosProvider} collapses that to ONE instance that every
// consumer inside reads. The provider is strictly opt-in: any caller mounted
// without one (e.g. `components/cellular/band-locking/band-locking.tsx`) still
// owns its own fetch and behaves exactly as before.
//
// The shared instance is also what makes mutations correct rather than merely
// cheap: under a provider `saveCustomScenario`/`deleteCustomScenario` refresh
// the single state the page hero ALSO reads, so a scenario renamed in the card
// can no longer leave the hero showing the old name.
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/scenarios";

/** Mutation outcomes; `error` is already translated and safe to toast. */
export type ScenarioActionResult = { ok: true } | { ok: false; error: string };
export type ScenarioSaveResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export interface UseConnectionScenariosReturn {
  /** Currently active scenario ID (defaults to "balanced") */
  activeScenarioId: string;
  /** Custom scenarios loaded from backend */
  customScenarios: StoredScenario[];
  /** True during initial fetch of scenarios + active state */
  isLoading: boolean;
  /** True while an activation request is in flight */
  isActivating: boolean;
  /** Error message from the last operation */
  error: string | null;
  /**
   * Activate a scenario by ID.
   * For custom scenarios, pass the config so mode + bands are sent to backend.
   * Returns the outcome; a failure carries a translated reason.
   */
  activateScenario: (id: string, config?: ScenarioConfig) => Promise<ScenarioActionResult>;
  /**
   * Save a custom scenario definition to the backend.
   * Pass an id to update, omit id for create.
   * Returns the scenario ID on success, or a translated failure reason.
   */
  saveCustomScenario: (scenario: Omit<StoredScenario, "id"> & { id?: string }) => Promise<ScenarioSaveResult>;
  /**
   * Delete a custom scenario by ID.
   * Returns the outcome; a failure carries a translated reason.
   */
  deleteCustomScenario: (id: string) => Promise<ScenarioActionResult>;
  /** Manually refresh all data (scenarios list + active state) */
  refresh: () => void;
}

/**
 * The real implementation.
 *
 * `enabled` gates the FETCH EFFECT only — never the hook itself. The public
 * `useConnectionScenarios` below always calls this, because skipping a hook when
 * a context happens to be present would break the Rules of Hooks. When disabled
 * this instance issues no network request and its returned object is discarded
 * by the caller, so its `isLoading` staying `true` is unobservable.
 */
function useConnectionScenariosInternal({
  enabled,
}: {
  enabled: boolean;
}): UseConnectionScenariosReturn {
  const [activeScenarioId, setActiveScenarioId] = useState("balanced");
  const [customScenarios, setCustomScenarios] = useState<StoredScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // `t` is read through a ref so the callbacks stay stable across a language
  // switch (a new `t` identity would otherwise re-run the fetch effect).
  const { t } = useTranslation("cellular");
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const tr = useCallback((key: string) => tRef.current(`scenarios.errors.${key}`), []);
  const resolved = useCallback(
    (code: string | undefined, detail: string | undefined, key: string) =>
      resolveErrorMessage(tRef.current, code, detail, tr(key)),
    [tr],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch scenarios list + active scenario from backend
  // ---------------------------------------------------------------------------
  const fetchScenarios = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ScenarioListResponse = await resp.json();
      if (!mountedRef.current) return;

      setCustomScenarios(data.scenarios || []);
      setActiveScenarioId(data.active_scenario_id || "balanced");
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      // Only a failed READ sets `error`: the card swaps to its error screen on it.
      setError(tr("load_failed"));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [tr]);

  // Initial fetch — suppressed entirely when a provider above us already owns
  // one. This early return is inside the effect, not before the hook.
  useEffect(() => {
    if (!enabled) return;
    fetchScenarios();
  }, [enabled, fetchScenarios]);

  // ---------------------------------------------------------------------------
  // Activate a scenario
  // ---------------------------------------------------------------------------
  const activateScenario = useCallback(
    async (id: string, config?: ScenarioConfig): Promise<ScenarioActionResult> => {
      setIsActivating(true);

      try {
        // Build POST body — default scenarios only need id,
        // custom scenarios include full config for backend to apply
        const body: Record<string, string> = { id };

        if (config && id.startsWith("custom-")) {
          body.mode = config.atModeValue;
          if (config.lte_bands) body.lte_bands = config.lte_bands;
          if (config.nsa_nr_bands) body.nsa_nr_bands = config.nsa_nr_bands;
          if (config.sa_nr_bands) body.sa_nr_bands = config.sa_nr_bands;
        }

        const resp = await authFetch(`${CGI_BASE}/activate.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioActivateResponse = await resp.json();
        if (!data.success) {
          return { ok: false, error: resolved(data.error, data.detail, "activate_failed") };
        }

        // Optimistic update — backend confirmed success
        if (mountedRef.current) setActiveScenarioId(id);
        return { ok: true };
      } catch {
        return { ok: false, error: tr("activate_failed") };
      } finally {
        if (mountedRef.current) {
          setIsActivating(false);
        }
      }
    },
    [resolved, tr],
  );

  // ---------------------------------------------------------------------------
  // Save a custom scenario (create or update)
  // ---------------------------------------------------------------------------
  const saveCustomScenario = useCallback(
    async (scenario: Omit<StoredScenario, "id"> & { id?: string }): Promise<ScenarioSaveResult> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/save.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scenario),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioApiResponse = await resp.json();

        if (!data.success) {
          return { ok: false, error: resolved(data.error, data.detail, "save_failed") };
        }

        // Refresh the list from backend to pick up the new/updated scenario
        if (mountedRef.current) await fetchScenarios();
        return { ok: true, id: data.id || scenario.id || null };
      } catch {
        return { ok: false, error: tr("save_failed") };
      }
    },
    [fetchScenarios, resolved, tr],
  );

  // ---------------------------------------------------------------------------
  // Delete a custom scenario
  // ---------------------------------------------------------------------------
  const deleteCustomScenario = useCallback(
    async (id: string): Promise<ScenarioActionResult> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/delete.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioApiResponse = await resp.json();

        if (!data.success) {
          return { ok: false, error: resolved(data.error, data.detail, "delete_failed") };
        }

        // Refresh the list from backend
        if (mountedRef.current) await fetchScenarios();
        return { ok: true };
      } catch {
        return { ok: false, error: tr("delete_failed") };
      }
    },
    [fetchScenarios, resolved, tr],
  );

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchScenarios();
  }, [fetchScenarios]);

  return {
    activeScenarioId,
    customScenarios,
    isLoading,
    isActivating,
    error,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
    refresh,
  };
}

// =============================================================================
// Shared-fetch context
// =============================================================================

const ConnectionScenariosContext =
  createContext<UseConnectionScenariosReturn | null>(null);

/**
 * Wrap a subtree so every `useConnectionScenarios()` inside it — and every
 * `useScenarioList()`, which derives from the same records — shares ONE fetch of
 * `scenarios/list.sh`.
 *
 * Written with `createElement` rather than JSX purely so this module can stay a
 * `.ts` file alongside the other hooks.
 */
export function ConnectionScenariosProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useConnectionScenariosInternal({ enabled: true });
  return createElement(
    ConnectionScenariosContext.Provider,
    { value },
    children,
  );
}

/**
 * The shared instance, or `null` when no provider is mounted above.
 *
 * Exported for `use-scenario-list.ts`, which builds its lightweight `{id,name}`
 * options out of these same records instead of fetching for itself.
 */
export function useSharedConnectionScenarios(): UseConnectionScenariosReturn | null {
  return useContext(ConnectionScenariosContext);
}

export function useConnectionScenarios(): UseConnectionScenariosReturn {
  const shared = useContext(ConnectionScenariosContext);
  // Both are ALWAYS evaluated — the Rules of Hooks forbid calling one
  // conditionally. `enabled` gates the fetch effect, not the hook, so the
  // instance we throw away costs a few `useState`s and zero requests.
  const own = useConnectionScenariosInternal({ enabled: shared === null });
  return shared ?? own;
}

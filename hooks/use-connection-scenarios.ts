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
   * Returns success boolean.
   */
  activateScenario: (id: string, config?: ScenarioConfig) => Promise<boolean>;
  /**
   * Save a custom scenario definition to the backend.
   * Pass an id to update, omit id for create.
   * Returns the scenario ID on success, null on failure.
   */
  saveCustomScenario: (scenario: Omit<StoredScenario, "id"> & { id?: string }) => Promise<string | null>;
  /**
   * Delete a custom scenario by ID.
   * Returns success boolean.
   */
  deleteCustomScenario: (id: string) => Promise<boolean>;
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
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load scenarios",
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

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
    async (id: string, config?: ScenarioConfig): Promise<boolean> => {
      setError(null);
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
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to activate scenario");
          return false;
        }

        // Optimistic update — backend confirmed success
        setActiveScenarioId(id);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to activate scenario",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsActivating(false);
        }
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Save a custom scenario (create or update)
  // ---------------------------------------------------------------------------
  const saveCustomScenario = useCallback(
    async (scenario: Omit<StoredScenario, "id"> & { id?: string }): Promise<string | null> => {
      setError(null);

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
        if (!mountedRef.current) return null;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to save scenario");
          return null;
        }

        // Refresh the list from backend to pick up the new/updated scenario
        await fetchScenarios();
        return data.id || null;
      } catch (err) {
        if (!mountedRef.current) return null;
        setError(
          err instanceof Error ? err.message : "Failed to save scenario",
        );
        return null;
      }
    },
    [fetchScenarios],
  );

  // ---------------------------------------------------------------------------
  // Delete a custom scenario
  // ---------------------------------------------------------------------------
  const deleteCustomScenario = useCallback(
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

        const data: ScenarioApiResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!data.success) {
          setError(data.detail || data.error || "Failed to delete scenario");
          return false;
        }

        // Refresh the list from backend
        await fetchScenarios();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to delete scenario",
        );
        return false;
      }
    },
    [fetchScenarios],
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

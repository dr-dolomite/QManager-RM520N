"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { useSharedConnectionScenarios } from "@/hooks/use-connection-scenarios";
import type {
  ScenarioListResponse,
  StoredScenario,
} from "@/types/connection-scenario";

// =============================================================================
// useScenarioList — Lightweight read of selectable connection scenarios
// =============================================================================
// Provides the {id,name} options for the scenario pickers in the profile form's
// Scenario section. Decoupled from useConnectionScenarios (which carries the
// full activation/CRUD surface) so the form stays light. Built-in defaults
// (balanced/gaming/streaming) are always present; custom scenarios come from
// scenarios/list.sh.
//
// SHARED FETCH. When a `ConnectionScenariosProvider` is mounted above (as it is
// on /cellular/custom-profiles), the custom records are DERIVED from that one
// shared instance and this hook issues no request of its own. Without a
// provider it fetches for itself exactly as before. Either way the public
// return shape is identical, so neither call site changes.
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/scenarios";

export interface ScenarioOption {
  id: string;
  name: string;
  /** True for the built-in balanced/gaming/streaming scenarios. */
  isDefault: boolean;
}

export interface UseScenarioListReturn {
  scenarios: ScenarioOption[];
  isLoading: boolean;
  /** Resolve an id → display name, with a graceful fallback for stale ids. */
  nameForId: (id: string) => string;
  refresh: () => void;
}

export function useScenarioList(): UseScenarioListReturn {
  const { t } = useTranslation("cellular");
  const shared = useSharedConnectionScenarios();
  // Gate for our OWN fetch. Hooks below are still called unconditionally.
  const enabled = shared === null;
  const [custom, setCustom] = useState<StoredScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchList = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: ScenarioListResponse = await resp.json();
      if (!mountedRef.current) return;
      setCustom(data.scenarios || []);
    } catch {
      // Keep defaults-only on failure; the picker still works.
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchList();
  }, [enabled, fetchList]);

  // Under a provider these are the shared instance's records; otherwise our own.
  const customScenarios = shared ? shared.customScenarios : custom;

  // Memoized so the array identity is stable across renders. Without this the
  // list rebuilt every render, giving nameForId — and every value derived from
  // it (e.g. the scenario section's live-readout effect deps) — a new identity
  // each render, which drove an infinite setState loop the moment a schedule
  // rule made the readout active.
  //
  // The three built-ins stay written out here rather than mapped from
  // `DEFAULT_SCENARIOS`: that constant carries hardcoded English `name`s for the
  // scenario *tiles*, and sourcing the picker from it would silently
  // un-translate every locale.
  const scenarios = useMemo<ScenarioOption[]>(
    () => [
      { id: "balanced", name: t("scenarios.default_balanced_name"), isDefault: true },
      { id: "gaming", name: t("scenarios.default_gaming_name"), isDefault: true },
      { id: "streaming", name: t("scenarios.default_streaming_name"), isDefault: true },
      ...customScenarios.map((s) => ({
        id: s.id,
        name: s.name,
        isDefault: false,
      })),
    ],
    [customScenarios, t],
  );

  const nameForId = useCallback(
    (id: string): string => {
      const match = scenarios.find((s) => s.id === id);
      if (match) return match.name;
      return t("custom_profiles.form.scenario.deleted_scenario");
    },
    [scenarios, t],
  );

  return {
    scenarios,
    isLoading: shared ? shared.isLoading : isLoading,
    nameForId,
    // Under a provider, refreshing means refreshing the SHARED instance — a
    // private refetch here would leave the page's other consumers stale.
    refresh: shared ? shared.refresh : fetchList,
  };
}

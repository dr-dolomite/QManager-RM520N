"use client";

import { useEffect, useRef, useState } from "react";

// =============================================================================
// usePublicUnitPreferences — Pre-auth unit preferences for the splash screen.
// =============================================================================
// Returns the SAME shape as useUnitPreferences (hooks/use-system-settings.ts)
// so the splash can format temperature/distance identically to the dashboard.
//
// WHY a separate hook: the authenticated useUnitPreferences uses authFetch,
// which hard-redirects to /login/ on the 401 a logged-out visitor gets — that
// would make the public splash unreachable. This variant uses a PLAIN fetch
// with `credentials: "omit"` against the unauthenticated units CGI, and never
// throws or redirects. Any failure (missing CGI, network blip, 401) resolves
// to `null`, and the consumer falls back to its own defaults.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/public/units.sh";

interface UnitPreferences {
  tempUnit: "celsius" | "fahrenheit";
  distanceUnit: "km" | "miles";
}

interface PublicUnitsResponse {
  settings?: {
    temp_unit?: "celsius" | "fahrenheit";
    distance_unit?: "km" | "miles";
  };
}

export function usePublicUnitPreferences(): UnitPreferences | null {
  const [prefs, setPrefs] = useState<UnitPreferences | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(FETCH_ENDPOINT, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PublicUnitsResponse;
        if (!mountedRef.current || controller.signal.aborted) return;
        setPrefs({
          tempUnit: json?.settings?.temp_unit || "celsius",
          distanceUnit: json?.settings?.distance_unit || "km",
        });
      } catch {
        // Silent failure is the contract: any error resolves to null, and the
        // consumer falls back to its own defaults. Never throws, never redirects.
        if (!mountedRef.current) return;
        setPrefs(null);
      }
    })();

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  return prefs;
}

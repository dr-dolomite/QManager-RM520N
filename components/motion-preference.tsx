"use client";

import * as React from "react";

import {
  applyMotionPreference,
  isMotionReduced,
  persistMotionPreference,
  readMotionPreference,
  subscribeToOsMotion,
  type MotionPreference,
} from "@/lib/motion-preference";

// The persisted animations choice, mirrored onto <html> as data-motion (what CSS and MotionProvider read).
// Hydrates in an effect (no localStorage at prerender), so its first render says "system".

interface MotionPreferenceContextValue {
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
}

const MotionPreferenceContext =
  React.createContext<MotionPreferenceContextValue | null>(null);

export function MotionPreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] =
    React.useState<MotionPreference>("system");

  React.useEffect(() => {
    const stored = readMotionPreference();
    setPreferenceState(stored);
    // Re-stamp rather than trust the boot script blindly: if the script was
    // blocked (CSP, a stripped export) this is the recovery path, and it is a
    // no-op when the script did run.
    applyMotionPreference(stored);
  }, []);

  const setPreference = React.useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    applyMotionPreference(next);
    persistMotionPreference(next);
  }, []);

  const value = React.useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference]
  );

  return (
    <MotionPreferenceContext.Provider value={value}>
      {children}
    </MotionPreferenceContext.Provider>
  );
}

/**
 * Read/write the animations preference.
 *
 * Falls back to a no-op "system" reading rather than throwing when the provider
 * is absent, so a component rendered outside the root layout (a test harness, a
 * throwaway preview route) degrades to current behaviour instead of crashing.
 */
export function useMotionPreference(): MotionPreferenceContextValue {
  const context = React.useContext(MotionPreferenceContext);
  return context ?? FALLBACK;
}

const FALLBACK: MotionPreferenceContextValue = {
  preference: "system",
  setPreference: () => {},
};

const serverSnapshot = () => false;

/**
 * Live "should motion be reduced?" for components: Reduced → true, Full → false,
 * System → the OS query, re-rendering when either changes. Prerender reads false.
 */
export function useMotionReduced(): boolean {
  const { preference } = useMotionPreference();
  // isMotionReduced reads the pre-paint attribute, which covers the render before
  // the provider's hydrate effect has run.
  const resolved = React.useSyncExternalStore(
    subscribeToOsMotion,
    isMotionReduced,
    serverSnapshot
  );
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return resolved;
}

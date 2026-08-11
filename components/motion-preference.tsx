"use client";

import * as React from "react";

import {
  applyMotionPreference,
  persistMotionPreference,
  readMotionPreference,
  type MotionPreference,
} from "@/lib/motion-preference";

// =============================================================================
// MotionPreferenceProvider — the user-level animations choice
// =============================================================================
// Structural twin of components/theme-provider.tsx: a thin client provider that
// owns one persisted preference and mirrors it onto <html>. It is mounted
// OUTSIDE MotionProvider in app/layout.tsx so MotionProvider can read it and
// translate it into MotionConfig's `reducedMotion` prop, while globals.css
// reads the same choice off the DOM attribute.
//
// Two consumers, one source of truth:
//   - CSS   → the `data-motion` attribute (stamped pre-paint by MOTION_BOOT_SCRIPT)
//   - JS    → this context, consumed by MotionProvider and the sidebar row
//
// The state is hydrated in an effect rather than a lazy initializer on purpose.
// next.config.ts is `output: "export"`, so every page is prerendered in Node at
// build time with no localStorage; reading it during the first client render
// would produce markup that disagrees with the prerendered HTML wherever the
// label is displayed. The attribute is already correct before paint, so the one
// extra render costs nothing visually.
// =============================================================================

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

// The animations preference (System / Full / Reduced) as one attribute on <html>:
// absent = "system" (the OS media query decides), or data-motion="full" | "reduced".
// Never write data-motion="system". Not "use client": app/layout.tsx imports the boot script.

/** localStorage key. Mirrors LANG_STORAGE_KEY's `qmanager_*` convention. */
export const MOTION_STORAGE_KEY = "qmanager_motion";

/** The attribute stamped on <html>. Absent means "system". */
export const MOTION_ATTRIBUTE = "data-motion";

/** The OS query. Read only through isMotionReduced() / useMotionReduced(). */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type MotionPreference = "system" | "full" | "reduced";

/** Cycle order for the sidebar row: least → most opinionated, then back. */
export const MOTION_PREFERENCES = [
  "system",
  "full",
  "reduced",
] as const satisfies readonly MotionPreference[];

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "full" || value === "reduced";
}

/**
 * Read the persisted choice. Safe to call during prerender (`output: "export"`
 * builds this app with no browser present) — it returns the default there.
 */
export function readMotionPreference(): MotionPreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return isMotionPreference(stored) ? stored : "system";
  } catch {
    // Private-mode / disabled storage. The OS default is a fine fallback.
    return "system";
  }
}

/**
 * True when motion should be reduced right now. The attribute outranks the OS query;
 * safe during prerender (false). Components use `useMotionReduced()`, which re-renders.
 */
export function isMotionReduced(): boolean {
  if (typeof window === "undefined") return false;
  const attr = document.documentElement.getAttribute(MOTION_ATTRIBUTE);
  if (attr === "reduced") return true;
  if (attr === "full") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Calls `onChange` when the OS reduced-motion setting flips. Returns the unsubscribe. */
export function subscribeToOsMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Stamp (or clear) the attribute. The clear branch is the "system" contract. */
export function applyMotionPreference(preference: MotionPreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute(MOTION_ATTRIBUTE);
  } else {
    root.setAttribute(MOTION_ATTRIBUTE, preference);
  }
}

export function persistMotionPreference(preference: MotionPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, preference);
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

/**
 * Render-blocking boot script, injected by app/layout.tsx.
 *
 * Without it the attribute would only land in a mount effect, i.e. AFTER first
 * paint — a user on "reduced" would see one frame of every entrance animation
 * before it was suppressed, which is precisely the frame they asked not to see.
 * next-themes solves the identical problem the identical way.
 *
 * Kept to one statement with no external references so it cannot throw on a
 * browser that lacks localStorage.
 */
export const MOTION_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  MOTION_STORAGE_KEY
)});var e=document.documentElement;if(p==="full"||p==="reduced"){e.setAttribute(${JSON.stringify(
  MOTION_ATTRIBUTE
)},p)}else{e.removeAttribute(${JSON.stringify(
  MOTION_ATTRIBUTE
)})}}catch(_){}})();`;

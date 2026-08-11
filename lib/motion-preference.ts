// =============================================================================
// motion-preference — the storage/DOM contract for the animations preference
// =============================================================================
// QManager already honours the OS-level `prefers-reduced-motion` media query in
// four hand-written blocks in globals.css and in ~64 `motion-reduce:` /
// `motion-safe:` utilities. What this module adds is a USER-level choice that
// can outrank the OS one in either direction.
//
// The whole contract is one attribute on <html>:
//
//   (no attribute)          → "system": the media query decides. Default.
//   data-motion="full"      → animate, whatever the OS says.
//   data-motion="reduced"   → suppress, whatever the OS says.
//
// The absence of the attribute is LOAD-BEARING — globals.css's redefined
// `motion-reduce` / `motion-safe` variants key off `[data-motion="full"]` and
// `[data-motion="reduced"]` and fall through to the bare media query when
// neither is present. Never write `data-motion="system"`.
//
// This module is deliberately NOT "use client": app/layout.tsx is a server
// component and imports BOOT_SCRIPT from here to stamp the attribute before
// first paint. Keeping the key, the type, and the boot script in one non-client
// module means the string "qmanager_motion" is written exactly once.
// =============================================================================

/** localStorage key. Mirrors LANG_STORAGE_KEY's `qmanager_*` convention. */
export const MOTION_STORAGE_KEY = "qmanager_motion";

/** The attribute stamped on <html>. Absent means "system". */
export const MOTION_ATTRIBUTE = "data-motion";

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

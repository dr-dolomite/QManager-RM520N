import * as React from "react";

// The page's first paint has no status yet. Which skeleton to show depends on
// whether Tailscale was installed last time, so the last answer is remembered
// per tab. It is a hint for a placeholder only: the live read always wins, and
// a blocked or empty storage just means the default skeleton.

const KEY = "qm-tailscale-installed";

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Records the live answer. A no-op when it has not changed. */
export function rememberTailscaleInstalled(installed: boolean) {
  const next = installed ? "1" : "0";
  if (read() === next) return;
  try {
    window.sessionStorage.setItem(KEY, next);
  } catch {
    return;
  }
  listeners.forEach((l) => l());
}

/**
 * The remembered answer, or null when there is none. The server snapshot is
 * null, so the static export hydrates on the default skeleton and then settles.
 */
export function useLastKnownInstalled(): boolean | null {
  const raw = React.useSyncExternalStore(subscribe, read, () => null);
  return raw === null ? null : raw === "1";
}

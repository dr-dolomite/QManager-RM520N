import * as React from "react";

// The first paint has no status, so whether Tailscale was installed last time
// picks the skeleton. A hint only: the live read wins, and blocked storage means the default.

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

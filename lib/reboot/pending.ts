// lib/reboot/pending.ts
//
// Local-storage flag for a queued modem reboot (e.g. after a config restore). It persists
// across navigation and reload until the user reboots or dismisses it.

import type { RebootSource } from "./index";

const STORAGE_KEY = "qmanager_pending_reboot";

export interface PendingReboot {
  since: number;
  source: RebootSource;
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parsePendingReboot(raw: string | null): PendingReboot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingReboot;
    if (typeof parsed?.since !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readPendingReboot(): PendingReboot | null {
  return parsePendingReboot(readRaw());
}

export function setPendingReboot(source: RebootSource = "config_restore"): void {
  if (typeof window === "undefined") return;
  const value: PendingReboot = { since: Date.now(), source };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    // Notify same-tab listeners — the storage event only fires cross-tab
    window.dispatchEvent(new Event("qmanager:pending-reboot-changed"));
  } catch {
    /* localStorage unavailable — silently degrade */
  }
}

export function clearPendingReboot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("qmanager:pending-reboot-changed"));
  } catch {
    /* noop */
  }
}

// React-style subscription hook for the pending-reboot flag
import { useMemo, useSyncExternalStore } from "react";

function subscribePendingReboot(onChange: () => void): () => void {
  window.addEventListener("storage", onChange); // cross-tab updates
  window.addEventListener("qmanager:pending-reboot-changed", onChange); // same-tab updates
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("qmanager:pending-reboot-changed", onChange);
  };
}

// Server/prerender snapshot: the static export renders no banner; the client
// reads localStorage after hydration.
const getServerRaw = () => null;

export function usePendingReboot(): PendingReboot | null {
  // Snapshot the raw string (stable between reads) and parse it per change, so
  // useSyncExternalStore never sees a fresh object on an unchanged store.
  const raw = useSyncExternalStore(subscribePendingReboot, readRaw, getServerRaw);
  return useMemo(() => parsePendingReboot(raw), [raw]);
}

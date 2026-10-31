// lib/reboot/connection.ts
//
// Reconnecting-banner signal: use-auto-logout reports an offline poll through
// reportConnectionState(bool); the banner reads it via useConnectionStatus (same-tab event).

// ── Reconnecting-status signal (same-tab event, mirrors pending-reboot) ──────

const RECONNECTING_KEY = "qm_reconnecting";
const RECONNECTING_EVENT = "qmanager:connection-changed";

/** Publish whether the "reconnecting" banner should currently show. */
export function reportConnectionState(reconnecting: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (reconnecting) {
      window.sessionStorage.setItem(RECONNECTING_KEY, "1");
    } else {
      window.sessionStorage.removeItem(RECONNECTING_KEY);
    }
    window.dispatchEvent(new Event(RECONNECTING_EVENT));
  } catch {
    /* sessionStorage unavailable — banner simply won't show */
  }
}

function readReconnecting(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(RECONNECTING_KEY) === "1";
  } catch {
    return false;
  }
}

// React subscription hook for the reconnecting flag. (Imported lazily by the
// banner component.)
import { useSyncExternalStore } from "react";

function subscribeReconnecting(onChange: () => void): () => void {
  window.addEventListener(RECONNECTING_EVENT, onChange);
  return () => window.removeEventListener(RECONNECTING_EVENT, onChange);
}

// Server/prerender snapshot: the static export renders "not reconnecting"; the
// client reads sessionStorage after hydration.
const getReconnectingServerSnapshot = () => false;

export function useConnectionStatus(): { reconnecting: boolean } {
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    readReconnecting,
    getReconnectingServerSnapshot,
  );
  return { reconnecting };
}

// lib/reboot/index.ts
//
// Modem reboot intent: rebootNow (immediate) and requestRebootLater (persisted banner flag).
// enterRebootFlow is the shared tail; callers with their own reboot request call it directly.

export type RebootSource =
  | "config_restore"
  | "imei"
  | "tailscale"
  | "mbn"
  | "manual"
  | "software_update"
  | "ip_passthrough";

const REBOOT_CGI = "/cgi-bin/quecmanager/system/reboot.sh";

/** sessionStorage key the /reboot/ countdown page reads-and-clears on mount. */
export const REBOOT_SESSION_KEY = "qm_rebooting";

/** Delay before navigating, so the fire-and-forget reboot POST reaches the device first. */
export const REBOOT_NAV_DELAY_MS = 2000;

/** True if a reboot we initiated is in flight (countdown not yet consumed). */
export function isRebooting(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(REBOOT_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Shared UX tail: mark the in-flight flag with its source, clear the logged-in cookie,
 * then navigate to /reboot/. Fires no reboot request itself.
 */
export function enterRebootFlow(source: RebootSource): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    try {
      window.sessionStorage.setItem(REBOOT_SESSION_KEY, source);
    } catch {
      /* sessionStorage unavailable — countdown guard will bounce home, acceptable */
    }
    document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
    window.location.href = "/reboot/";
  }, REBOOT_NAV_DELAY_MS);
}

/** Immediate reboot: fire-and-forget POST to reboot.sh, then the countdown. Errors are swallowed since the reboot may have started. */
export function rebootNow(source: RebootSource): void {
  if (typeof window === "undefined") return;
  void fetch(REBOOT_CGI, { method: "POST" }).catch(() => {});
  enterRebootFlow(source);
}

/** Deferred reboot: persist the banner flag for the user to action later. */
export { setPendingReboot as requestRebootLater } from "./pending";

// Re-export the rest of the pending API so consumers have one import path.
export {
  readPendingReboot,
  clearPendingReboot,
  usePendingReboot,
  type PendingReboot,
} from "./pending";

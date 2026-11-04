"use client";

import { useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { startVisibleInterval } from "@/lib/visible-interval";
import { reportConnectionState } from "@/lib/reboot/connection";

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";

/** How often to ping check.sh while the dashboard is open (ms) */
const POLL_INTERVAL_MS = 10_000;

/**
 * How long the device must be continuously unreachable before we give up
 * and redirect to login. 90s is generous enough to survive normal slowness
 * but tight enough that reboots (typically 30–60s) are caught promptly once
 * they finish — the 401 on the first successful response handles the actual
 * session-gone redirect; this threshold only fires if the device never comes
 * back (e.g. power loss, long watchdog reboot).
 */
const OFFLINE_THRESHOLD_MS = 90_000;

function clearSessionCookie() {
  document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
}

/**
 * Polls auth/check.sh every POLL_INTERVAL_MS while the dashboard is mounted and visible.
 *
 * - 401 response   → authFetch already redirects to /login/ (session gone after reboot)
 * - Network error  → starts the offline clock
 * - Still offline after OFFLINE_THRESHOLD_MS → redirects to /login/?reason=offline
 * - Successful response → resets the offline clock
 */
export function useAutoLogout() {
  const offlineSinceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        // authFetch handles 401 → redirect internally
        await authFetch(CHECK_ENDPOINT);
        // Any successful response: device is reachable, reset clock
        offlineSinceRef.current = null;
        reportConnectionState(false);
      } catch {
        // Network error: one missed check already spans 10 s, so warn at once.
        reportConnectionState(true);
        if (offlineSinceRef.current === null) {
          offlineSinceRef.current = Date.now();
        } else if (Date.now() - offlineSinceRef.current >= OFFLINE_THRESHOLD_MS) {
          clearSessionCookie();
          reportConnectionState(false);
          window.location.href = "/login/?reason=offline";
        }
      }
    };

    // Paused while hidden (check.sh never answers 401, so nothing is missed); the
    // offline clock restarts on hide because nobody was watching the gap.
    const stop = startVisibleInterval(
      () => {
        if (!cancelled) tick();
      },
      POLL_INTERVAL_MS,
      {
        onHide: () => {
          offlineSinceRef.current = null;
          reportConnectionState(false);
        },
      },
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, []);
}

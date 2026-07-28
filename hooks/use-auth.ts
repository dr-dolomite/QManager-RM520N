"use client";

import { useCallback, useEffect, useState } from "react";

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";
const LOGIN_ENDPOINT = "/cgi-bin/quecmanager/auth/login.sh";
const LOGOUT_ENDPOINT = "/cgi-bin/quecmanager/auth/logout.sh";
const PASSWORD_ENDPOINT = "/cgi-bin/quecmanager/auth/password.sh";
const SSH_PASSWORD_ENDPOINT = "/cgi-bin/quecmanager/auth/ssh_password.sh";

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export function isLoggedIn(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("qm_logged_in=1");
}

function clearIndicatorCookie() {
  document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
}

// ---------------------------------------------------------------------------
// Hook for login page (setup detection + login/setup actions)
// ---------------------------------------------------------------------------

export type LoginStatus = "loading" | "ready" | "setup_required";

/**
 * Machine-readable failure sentinels emitted by auth/login.sh. The UI branches
 * on these and supplies its own translated copy; `detail` is the backend's
 * English fallback, not something to render when a locale string exists.
 */
export type LoginError =
  | "invalid_password"
  | "rate_limited"
  | "setup_required"
  | "network";

export interface LoginResult {
  success: boolean;
  error?: LoginError;
  /** Backend's English detail. Diagnostic fallback only. */
  detail?: string;
  /** Seconds until the lockout lifts. Present when error is "rate_limited". */
  retry_after?: number;
  /**
   * Free attempts left before the ladder engages. Present on both
   * "invalid_password" and "rate_limited".
   *
   * NOTE: this reaches 0 while the form is still USABLE — once a user is on
   * the lockout ladder, the backend's count stays at the maximum until either
   * a successful login or an hour of quiet. Zero here means "the next wrong
   * password re-locks immediately", not "you cannot try". Callers must not
   * render it as a countdown at 0.
   */
  attempts_remaining?: number;
}

export interface LockoutState {
  active: boolean;
  retryAfter: number;
  attemptsRemaining: number;
}

/**
 * Mirrors MAX_ATTEMPTS in scripts/usr/lib/qmanager/cgi_auth.sh. Only used as an
 * optimistic pre-flight value before check.sh answers; every real number the UI
 * shows comes from the backend, so a drift here cannot mislead a user mid-flow.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

const NO_LOCKOUT: LockoutState = {
  active: false,
  retryAfter: 0,
  attemptsRemaining: DEFAULT_MAX_ATTEMPTS,
};

export function useLogin() {
  const [status, setStatus] = useState<LoginStatus>("loading");
  const [lockout, setLockout] = useState<LockoutState>(NO_LOCKOUT);

  useEffect(() => {
    // If already logged in, redirect to dashboard
    if (isLoggedIn()) {
      window.location.href = "/dashboard/";
      return;
    }

    // Check if first-time setup is needed. `no-store` matters here: the
    // response now carries live lockout state, and a cached copy would show an
    // enabled button during a lockout the server is still enforcing.
    fetch(CHECK_ENDPOINT, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.setup_required ? "setup_required" : "ready");

        // Seeding from check.sh is what makes a lockout survive a page reload.
        // The countdown itself is component state; without this the button
        // would re-enable on refresh and simply earn another 429.
        if (data.rate_limited) {
          setLockout({
            active: true,
            retryAfter: Number(data.retry_after) || 0,
            attemptsRemaining: 0,
          });
        } else {
          setLockout({
            active: false,
            retryAfter: 0,
            attemptsRemaining:
              typeof data.attempts_remaining === "number"
                ? data.attempts_remaining
                : DEFAULT_MAX_ATTEMPTS,
          });
        }
      })
      .catch(() => {
        // Backend unreachable on a fresh install likely means setup hasn't
        // completed yet (e.g. lighttpd started before qmanager-setup).
        // Default to setup_required so onboarding isn't silently skipped.
        setStatus("setup_required");
      });
  }, []);

  const login = useCallback(
    async (password: string): Promise<LoginResult> => {
      try {
        const resp = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await resp.json();

        if (data.success) {
          // Cookie is set by the backend — just redirect
          window.location.href = "/dashboard/";
          return { success: true };
        }

        if (data.error === "setup_required") {
          setStatus("setup_required");
          return { success: false, error: "setup_required" };
        }

        const attemptsRemaining =
          typeof data.attempts_remaining === "number"
            ? data.attempts_remaining
            : undefined;

        if (data.error === "rate_limited") {
          const retryAfter = Number(data.retry_after) || 0;
          setLockout({ active: true, retryAfter, attemptsRemaining: 0 });
          return {
            success: false,
            error: "rate_limited",
            detail: data.detail,
            retry_after: retryAfter,
            attempts_remaining: 0,
          };
        }

        if (attemptsRemaining !== undefined) {
          setLockout((prev) => ({ ...prev, attemptsRemaining }));
        }

        // The sentinel is preserved in `error` rather than being overwritten
        // by `detail`. Collapsing the two used to make "rate_limited"
        // indistinguishable from any other failure at the call site.
        return {
          success: false,
          error: "invalid_password",
          detail: data.detail || data.error,
          attempts_remaining: attemptsRemaining,
        };
      } catch {
        return { success: false, error: "network", detail: "Connection failed" };
      }
    },
    []
  );

  const setup = useCallback(
    async (
      password: string,
      confirm: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const resp = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirm }),
        });
        const data = await resp.json();

        if (data.success) {
          window.location.href = "/dashboard/";
          return { success: true };
        }

        return {
          success: false,
          error: data.detail || data.error || "Setup failed",
        };
      } catch {
        return { success: false, error: "Connection failed" };
      }
    },
    []
  );

  return { status, login, setup, lockout };
}

// ---------------------------------------------------------------------------
// Standalone setup (used by onboarding wizard — does NOT redirect on success)
// ---------------------------------------------------------------------------

/**
 * Creates the initial password and session without redirecting.
 * Used by the onboarding wizard so it can advance steps instead of
 * immediately sending the user to the dashboard.
 */
export async function setupPassword(
  password: string,
  confirm: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(LOGIN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm }),
    });
    const data = await resp.json();

    if (data.success) {
      return { success: true };
    }

    return {
      success: false,
      error: data.detail || data.error || "Setup failed",
    };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

// ---------------------------------------------------------------------------
// Actions (used by sidebar menu / change password dialog)
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  try {
    await fetch(LOGOUT_ENDPOINT, { method: "POST" });
  } catch {
    // Ignore network errors on logout
  } finally {
    clearIndicatorCookie();
    window.location.href = "/";
  }
}

export async function changePassword(
  current: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(PASSWORD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: current,
        new_password: newPassword,
      }),
    });
    const data = await resp.json();

    if (data.success) {
      clearIndicatorCookie();
      window.location.href = "/login/";
      return { success: true };
    }

    return {
      success: false,
      error: data.detail || data.error || "Password change failed",
    };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

// ---------------------------------------------------------------------------
// SSH password management
// ---------------------------------------------------------------------------

export async function changeSSHPassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(SSH_PASSWORD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    });
    const data = await resp.json();

    if (data.success) {
      return { success: true };
    }

    return {
      success: false,
      error: data.detail || data.error || "SSH password change failed",
    };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

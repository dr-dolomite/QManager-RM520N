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

export function useLogin() {
  const [status, setStatus] = useState<LoginStatus>("loading");

  useEffect(() => {
    // If already logged in, redirect to dashboard
    if (isLoggedIn()) {
      window.location.href = "/dashboard/";
      return;
    }

    // Check if first-time setup is needed
    fetch(CHECK_ENDPOINT)
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.setup_required ? "setup_required" : "ready");
      })
      .catch(() => {
        // Backend unreachable on a fresh install likely means setup hasn't
        // completed yet (e.g. lighttpd started before qmanager-setup).
        // Default to setup_required so onboarding isn't silently skipped.
        setStatus("setup_required");
      });
  }, []);

  const login = useCallback(
    async (
      password: string
    ): Promise<{ success: boolean; error?: string; retry_after?: number }> => {
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

        return {
          success: false,
          error: data.detail || data.error || "Invalid password",
          retry_after: data.retry_after,
        };
      } catch {
        return { success: false, error: "Connection failed" };
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

  return { status, login, setup };
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
    window.location.href = "/login/";
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

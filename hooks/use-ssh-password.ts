"use client";

import { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SshPasswordChangeRequest,
  SshPasswordChangeResponse,
  SshPasswordVerifyRequest,
} from "@/types/ssh-password";
import type {
  PasswordActionResult,
  PasswordActions,
} from "@/types/password-change";

// useSshPassword: posts to auth/ssh_password.sh and resolves to a result object (the card toasts its reason).
// `verifyPassword` is the same endpoint in `verify_only` mode; the web session is unaffected by a change.

const CGI_ENDPOINT = "/cgi-bin/quecmanager/auth/ssh_password.sh";

/** A failed password call as one translated sentence, or undefined for the caller's own line. */
export function resolvePasswordFailure(
  t: TFunction,
  failure: {
    error?: string;
    detail?: string;
    retry_after?: number;
    attempts_remaining?: number;
  },
): string | undefined {
  // 0 left falls through to the plain line, as on the login page.
  if (failure.error === "invalid_password" && (failure.attempts_remaining ?? 0) > 0) {
    return t("passwords.errors.invalid_password", {
      ns: "system-settings",
      count: failure.attempts_remaining,
    });
  }
  // The lockout carries its own countdown; the shared errors line has none.
  if (failure.error === "rate_limited" && (failure.retry_after ?? 0) > 0) {
    return t("passwords.errors.rate_limited", {
      ns: "system-settings",
      count: failure.retry_after,
    });
  }
  const message = resolveErrorMessage(t, failure.error, failure.detail, "");
  return message || undefined;
}

export function useSshPassword(): PasswordActions {
  const { t } = useTranslation("errors");
  const [isPending, setIsPending] = useState(false);

  const post = useCallback(
    async (
      body: SshPasswordChangeRequest | SshPasswordVerifyRequest,
    ): Promise<PasswordActionResult> => {
      setIsPending(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        // A refusal answers 200 or 429 (lockout) with a JSON reason; anything
        // else has no body worth reading.
        if (!resp.ok && resp.status !== 400 && resp.status !== 429) {
          return { success: false };
        }

        const data = (await resp.json()) as SshPasswordChangeResponse;

        if (!data.success) {
          return { success: false, message: resolvePasswordFailure(t, data) };
        }

        return { success: true };
      } catch {
        return { success: false };
      } finally {
        setIsPending(false);
      }
    },
    [t],
  );

  const changePassword = useCallback(
    (
      currentPassword: string,
      newPassword: string,
      enforceStrong: boolean,
    ) =>
      post({
        current_password: currentPassword,
        new_password: newPassword,
        enforce_strong: enforceStrong,
      }),
    [post],
  );

  const verifyPassword = useCallback(
    (currentPassword: string) =>
      post({ current_password: currentPassword, verify_only: true }),
    [post],
  );

  return { changePassword, verifyPassword, isPending };
}

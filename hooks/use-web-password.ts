"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  changePassword as changeWebPassword,
  verifyPassword as verifyWebPassword,
  type PasswordCallResult,
} from "@/hooks/use-auth";
import { resolvePasswordFailure } from "@/hooks/use-ssh-password";
import type {
  PasswordActionResult,
  PasswordActions,
} from "@/types/password-change";

// =============================================================================
// useWebPassword — the QManager (web) password, as the Passwords card's tab
// =============================================================================
// Wraps the two `use-auth` calls in the same result shape as `useSshPassword`,
// so the card treats both tabs alike. A successful change destroys the session
// on the device and `changePassword` sends the browser to /login/, so the page
// is already leaving when this resolves.
// =============================================================================

export function useWebPassword(): PasswordActions {
  const { t } = useTranslation("errors");
  const [isPending, setIsPending] = useState(false);

  const resolve = useCallback(
    (result: PasswordCallResult): PasswordActionResult =>
      result.success
        ? { success: true }
        : { success: false, message: resolvePasswordFailure(t, result) },
    [t],
  );

  const verifyPassword = useCallback(
    async (currentPassword: string) => {
      setIsPending(true);
      try {
        return resolve(await verifyWebPassword(currentPassword));
      } finally {
        setIsPending(false);
      }
    },
    [resolve],
  );

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      enforceStrong: boolean,
    ) => {
      setIsPending(true);
      try {
        return resolve(
          await changeWebPassword(currentPassword, newPassword, enforceStrong),
        );
      } finally {
        setIsPending(false);
      }
    },
    [resolve],
  );

  return { changePassword, verifyPassword, isPending };
}

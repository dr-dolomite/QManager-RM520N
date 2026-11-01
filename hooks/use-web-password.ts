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

// useWebPassword: wraps the `use-auth` calls in `useSshPassword`'s result shape so both tabs behave alike.
// A successful change destroys the session and redirects to /login/ before this resolves.

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

"use client";

import { useCallback, useId, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  PASSWORD_MIN_LENGTH,
  PasswordRequirements,
  isPasswordValid,
} from "@/components/auth/password-requirements";
import { StrongPasswordToggle } from "@/components/auth/strong-password-toggle";
import { cn } from "@/lib/utils";

import { PasswordInput } from "./password-input";

// Second step of the Passwords card: collects and pre-validates the new password after the current one verified.
// The card owns the call, toasts and reset (Toast-Confirms Rule).

interface PasswordChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** A call is in flight, or the page is already leaving after a success. */
  busy: boolean;
  onSubmit: (newPassword: string, enforceStrong: boolean) => Promise<void>;
}

export function PasswordChangeDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  onSubmit,
}: PasswordChangeDialogProps) {
  const { t } = useTranslation("system-settings");
  const uid = useId();
  const newId = `${uid}-new`;
  const confirmId = `${uid}-confirm`;
  const reqsId = `${uid}-reqs`;
  const hintId = `${uid}-hint`;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [enforceStrong, setEnforceStrong] = useState(true);
  const [error, setError] = useState("");
  // Remounts the fields on close so each one's show/hide state resets too.
  const [formKey, setFormKey] = useState(0);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (busy && !next) return;
      if (!next) {
        setNewPassword("");
        setConfirmPassword("");
        setEnforceStrong(true);
        setError("");
        setFormKey((k) => k + 1);
      }
      onOpenChange(next);
    },
    [busy, onOpenChange],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");

      if (!isPasswordValid(newPassword, enforceStrong)) {
        setError(
          t(
            enforceStrong
              ? "passwords.errors.weak"
              : "passwords.errors.too_short",
            { min: PASSWORD_MIN_LENGTH },
          ),
        );
        return;
      }
      // The live hint under the confirm field already says so; a second
      // message here would only repeat it.
      if (newPassword !== confirmPassword) return;

      await onSubmit(newPassword, enforceStrong);
    },
    [newPassword, confirmPassword, enforceStrong, onSubmit, t],
  );

  const confirmTouched = confirmPassword.length > 0;
  const confirmMatches = newPassword === confirmPassword;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form key={formKey} onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <Field>
              <FieldLabel htmlFor={newId}>
                {t("passwords.dialog.new_label")}
              </FieldLabel>
              <PasswordInput
                id={newId}
                autoComplete="new-password"
                autoFocus
                describedBy={reqsId}
                value={newPassword}
                onChange={setNewPassword}
                disabled={busy}
              />
              <PasswordRequirements
                id={reqsId}
                password={newPassword}
                enforceStrong={enforceStrong}
                className="pt-1"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={confirmId}>
                {t("passwords.dialog.confirm_label")}
              </FieldLabel>
              <PasswordInput
                id={confirmId}
                autoComplete="new-password"
                describedBy={confirmTouched ? hintId : undefined}
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={busy}
              />
              {confirmTouched ? (
                <p
                  id={hintId}
                  className={cn(
                    "text-xs",
                    confirmMatches ? "text-success" : "text-destructive",
                  )}
                >
                  {t(
                    confirmMatches
                      ? "passwords.dialog.match"
                      : "passwords.dialog.mismatch",
                  )}
                </p>
              ) : null}
            </Field>

            <StrongPasswordToggle
              id={`${uid}-strong`}
              checked={enforceStrong}
              onCheckedChange={setEnforceStrong}
              disabled={busy}
            />

            {error ? <FieldError>{error}</FieldError> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {t("passwords.dialog.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy || newPassword.length === 0 || confirmPassword.length === 0
              }
            >
              {busy ? <Spinner /> : null}
              {t("passwords.dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

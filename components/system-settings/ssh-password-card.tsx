"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, TerminalIcon } from "lucide-react";
import { changeSSHPassword } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function SSHPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError("");
  }, []);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    confirmPassword.length > 0 &&
    !isSubmitting;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (newPassword.length < 6) {
        setError("SSH password must be at least 6 characters.");
        return;
      }

      if (newPassword !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await changeSSHPassword(
          currentPassword,
          newPassword,
          confirmPassword
        );
        if (result.success) {
          toast.success("SSH password updated successfully.");
          reset();
        } else {
          setError(result.error || "SSH password change failed.");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, reset]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>SSH Password</CardTitle>
        <CardDescription>
          Set the root password used for SSH access to the modem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <TerminalIcon className="size-4 shrink-0" />
            <span>
              SSH uses the system root password, separate from the web UI
              password. Connect via{" "}
              <code className="text-xs">ssh root@192.168.225.1</code>
            </span>
          </div>

          <Field>
            <FieldLabel htmlFor="ssh-current-password">
              Current Web UI Password
            </FieldLabel>
            <FieldDescription>
              Required to authorize SSH password changes.
            </FieldDescription>
            <div className="relative">
              <Input
                id="ssh-current-password"
                type={showCurrentPassword ? "text" : "password"}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowCurrentPassword((v) => !v)}
                tabIndex={-1}
                aria-label={
                  showCurrentPassword ? "Hide password" : "Show password"
                }
              >
                {showCurrentPassword ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="ssh-new-password">
              New SSH Password
            </FieldLabel>
            <div className="relative">
              <Input
                id="ssh-new-password"
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNewPassword((v) => !v)}
                tabIndex={-1}
                aria-label={
                  showNewPassword ? "Hide password" : "Show password"
                }
              >
                {showNewPassword ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="ssh-confirm-password">
              Confirm SSH Password
            </FieldLabel>
            <div className="relative">
              <Input
                id="ssh-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirmPassword((v) => !v)}
                tabIndex={-1}
                aria-label={
                  showConfirmPassword ? "Hide password" : "Show password"
                }
              >
                {showConfirmPassword ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </Button>
            </div>
          </Field>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {isSubmitting ? (
              <>
                <Spinner className="mr-2" />
                Updating...
              </>
            ) : (
              "Update SSH Password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

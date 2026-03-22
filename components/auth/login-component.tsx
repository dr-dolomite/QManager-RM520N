"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useLogin } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

// =============================================================================
// LoginComponent
// =============================================================================

export default function LoginComponent() {
  const { status, login } = useLogin();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  const wasOffline =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("reason") === "offline";

  // Redirect to dedicated onboarding wizard when this is a fresh install
  useEffect(() => {
    if (status === "setup_required") {
      window.location.href = "/setup/";
    }
  }, [status]);

  // Rate limit countdown timer
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => {
      setRetryAfter((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setIsSubmitting(true);
      try {
        const result = await login(password);
        if (!result.success) {
          if (result.retry_after) {
            setRetryAfter(result.retry_after);
            setError(
              `Too many failed attempts. Try again in ${result.retry_after} seconds.`
            );
          } else {
            setError(result.error || "Invalid password.");
          }
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [password, login]
  );

  // Show spinner while detecting setup status or during redirect to /setup/
  if (status === "loading" || status === "setup_required") {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-col gap-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* Offline session-loss banner */}
      {wasOffline && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Your session ended because the device was unreachable for too long.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-16 p-1 items-center justify-center rounded-md">
              <img
                src="/qmanager-logo.svg"
                alt="QManager Logo"
                className="size-full"
              />
            </div>
            <h1 className="text-xl font-bold">Welcome to QManager</h1>
            <FieldDescription>
              Enter your QManager password to continue.
            </FieldDescription>
          </div>

          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>
          </Field>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Field>
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || retryAfter > 0}
            >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2" />
                  Logging in...
                </>
              ) : retryAfter > 0 ? (
                `Locked (${retryAfter}s)`
              ) : (
                "Login"
              )}
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        QManager — Quectel Modem Management
      </FieldDescription>
    </motion.div>
  );
}

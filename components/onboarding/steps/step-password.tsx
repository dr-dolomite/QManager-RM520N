"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { setupPassword } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

// =============================================================================
// StepPassword — Onboarding step 2: create password (required)
// =============================================================================

// ---------------------------------------------------------------------------
// Password strength
// ---------------------------------------------------------------------------

function getStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length === 0) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 12) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"] as const;

function strengthColorClass(strength: number) {
  if (strength === 1) return "bg-destructive";
  if (strength === 2) return "bg-warning";
  if (strength === 3) return "bg-warning";
  return "bg-success";
}

function strengthTextClass(strength: number) {
  if (strength === 1) return "text-destructive";
  if (strength === 2) return "text-warning";
  if (strength === 3) return "text-warning";
  return "text-success";
}

// ---------------------------------------------------------------------------

interface StepPasswordProps {
  onSuccess: () => void;
  onLoadingChange: (loading: boolean) => void;
  onSubmitRef: (fn: () => Promise<void>) => void;
}

export function StepPassword({ onSuccess, onLoadingChange, onSubmitRef }: StepPasswordProps) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = getStrength(password);

  const handleSubmit = useCallback(async () => {
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    onLoadingChange(true);
    try {
      const result = await setupPassword(password, confirm);
      if (result.success) {
        const name = displayName.trim();
        if (name) {
          // Save display name as device hostname
          try {
            await authFetch("/cgi-bin/quecmanager/system/settings.sh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save_settings", hostname: name }),
            });
          } catch {
            // Non-fatal — hostname save is best-effort during onboarding
          }
        }
        onSuccess();
      } else {
        setError(result.error || "Setup failed. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
      onLoadingChange(false);
    }
  }, [displayName, password, confirm, onSuccess, onLoadingChange]);

  useEffect(() => {
    onSubmitRef(handleSubmit);
  }, [handleSubmit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Secure your setup</h2>
        <p className="text-sm text-muted-foreground">
          Choose a password to protect access to your modem interface.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboard-name">Your name <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
            <Input
              id="onboard-name"
              type="text"
              placeholder="e.g. Alex"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isSubmitting}
            />
            <FieldDescription>Shown in the sidebar. You can change this anytime.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="onboard-password">Password</FieldLabel>
            <div className="relative">
              <Input
                id="onboard-password"
                type={showPassword ? "text" : "password"}
                placeholder="Create a password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

            {/* Strength bar — appears as soon as typing starts */}
            <AnimatePresence>
              {password.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2 pt-1"
                >
                  {/* Segmented bar */}
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3, 4].map((seg) => (
                      <div
                        key={seg}
                        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                      >
                        <motion.div
                          className={cn(
                            "h-full rounded-full transition-colors duration-500",
                            seg <= strength
                              ? strengthColorClass(strength)
                              : "bg-transparent"
                          )}
                          animate={{ scaleX: seg <= strength ? 1 : 0 }}
                          initial={{ scaleX: 0 }}
                          style={{ originX: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 30, delay: (seg - 1) * 0.04 }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* Label */}
                  <span
                    className={cn(
                      "text-xs font-medium w-10 text-right transition-colors duration-300",
                      strengthTextClass(strength)
                    )}
                  >
                    {STRENGTH_LABELS[strength]}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <FieldDescription>Minimum 6 characters</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="onboard-confirm">Confirm Password</FieldLabel>
            <div className="relative">
              <Input
                id="onboard-confirm"
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm your password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>
          </Field>

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </form>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { setupPassword } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import {
  PASSWORD_MIN_LENGTH,
  PasswordRequirements,
  isPasswordValid,
} from "@/components/auth/password-requirements";
import { StrongPasswordToggle } from "@/components/auth/strong-password-toggle";
import { cn } from "@/lib/utils";
import { DUR, EASE_QUICK, EASE_STANDARD, STAGGER_STEP_ROWS } from "@/lib/motion";
import { STEP_DESCRIPTION, STEP_HEADING } from "../shapes";

function getStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length === 0) return 0;
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

function strengthColorClass(strength: number) {
  if (strength === 1) return "bg-destructive";
  if (strength === 2) return "bg-warning";
  return "bg-success";
}

function strengthTextClass(strength: number) {
  if (strength === 1) return "text-destructive-on-surface";
  if (strength === 2) return "text-warning-on-surface";
  return "text-success-on-surface";
}

interface StepPasswordProps {
  onSuccess: () => void;
  onLoadingChange: (loading: boolean) => void;
  onSubmitRef: (fn: () => Promise<void>) => void;
  onValidityChange: (valid: boolean) => void;
}

export function StepPassword({ onSuccess, onLoadingChange, onSubmitRef, onValidityChange }: StepPasswordProps) {
  const { t } = useTranslation("onboarding");

  const strengthLabels = [
    "",
    t("password.strength_weak"),
    t("password.strength_fair"),
    t("password.strength_good"),
    t("password.strength_strong"),
  ];

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [useStrongPassword, setUseStrongPassword] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = getStrength(password);
  const canContinue = isPasswordValid(password, useStrongPassword) && confirm.length > 0 && password === confirm;

  useEffect(() => {
    onValidityChange(canContinue);
  }, [canContinue, onValidityChange]);

  const handleSubmit = useCallback(async () => {
    setError("");

    // Rules live in components/auth/password-requirements.tsx; auth/login.sh mirrors them.
    if (!isPasswordValid(password, useStrongPassword)) {
      setError(
        useStrongPassword
          ? t("password.error_strong_requirements")
          : t("password.error_basic_requirements")
      );
      return;
    }
    if (password !== confirm) {
      setError(t("password.error_mismatch"));
      return;
    }

    setIsSubmitting(true);
    onLoadingChange(true);
    try {
      const result = await setupPassword(password, confirm, useStrongPassword);
      if (result.success) {
        // The password is set either way; a failed SSH root sync is a warning that outlives the step.
        if (result.sshSynced === false) {
          toast.warning(t("login.ssh_sync_failed", { ns: "common" }), { duration: 20000 });
        }
        const name = displayName.trim();
        if (name) {
          try {
            await authFetch("/cgi-bin/quecmanager/system/settings.sh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save_settings", hostname: name }),
            });
          } catch {
            // Best-effort: the hostname never blocks onboarding.
          }
        }
        onSuccess();
      } else {
        // The step advance is the success signal; a failed write toasts.
        toast.error(resolveErrorMessage(t, result.error, result.detail, t("password.error_setup_failed")));
      }
    } finally {
      setIsSubmitting(false);
      onLoadingChange(false);
    }
  }, [displayName, password, confirm, useStrongPassword, onSuccess, onLoadingChange, t]);

  useEffect(() => {
    onSubmitRef(handleSubmit);
  }, [handleSubmit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className={STEP_HEADING}>{t("password.heading")}</h2>
        <p className={STEP_DESCRIPTION}>{t("password.description")}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboard-name">
              {t("password.label_name")}{" "}
              <span className="font-normal text-on-surface-variant">{t("password.label_name_optional_suffix")}</span>
            </FieldLabel>
            <Input
              id="onboard-name"
              type="text"
              placeholder={t("password.placeholder_name")}
              autoComplete="name"
              aria-describedby="onboard-name-desc"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isSubmitting}
            />
            <FieldDescription id="onboard-name-desc">{t("password.hint_name")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="onboard-password">{t("password.label_password")}</FieldLabel>
            <div className="relative">
              <Input
                id="onboard-password"
                type={showPassword ? "text" : "password"}
                placeholder={t("password.placeholder_password")}
                autoComplete="new-password"
                required
                aria-describedby="onboard-password-reqs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? t("password.aria_hide_password") : t("password.aria_show_password")}
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>

            {/* Strength bar appears once typing starts; no exit (Enter-Only Rule) */}
            {password.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
                className="flex items-center gap-2 pt-1"
              >
                <div className="flex flex-1 gap-1">
                  {[1, 2, 3, 4].map((seg) => (
                    <div
                      key={seg}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-surface-container-high"
                    >
                      <motion.div
                        className={cn(
                          "h-full rounded-full transition-colors duration-[var(--duration-standard)] ease-standard",
                          seg <= strength ? strengthColorClass(strength) : "bg-transparent"
                        )}
                        animate={{ scaleX: seg <= strength ? 1 : 0 }}
                        initial={{ scaleX: 0 }}
                        style={{ originX: 0 }}
                        transition={{ duration: DUR.standard, ease: EASE_STANDARD, delay: (seg - 1) * STAGGER_STEP_ROWS }}
                      />
                    </div>
                  ))}
                </div>
                <span
                  className={cn(
                    "shrink-0 text-right text-xs font-medium transition-colors duration-[var(--duration-standard)] ease-standard",
                    strengthTextClass(strength)
                  )}
                >
                  {strengthLabels[strength]}
                </span>
              </motion.div>
            )}

            <PasswordRequirements password={password} enforceStrong={useStrongPassword} id="onboard-password-reqs" className="pt-1" />
          </Field>

          <Field>
            <FieldLabel htmlFor="onboard-confirm">{t("password.label_confirm")}</FieldLabel>
            <div className="relative">
              <Input
                id="onboard-confirm"
                type={showConfirm ? "text" : "password"}
                placeholder={t("password.placeholder_confirm")}
                autoComplete="new-password"
                required
                aria-describedby={confirm.length > 0 ? "onboard-confirm-hint" : undefined}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={isSubmitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? t("password.aria_hide_password") : t("password.aria_show_password")}
              >
                {showConfirm ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>
            {confirm.length > 0 && (
              <p
                id="onboard-confirm-hint"
                className={cn(
                  "text-xs transition-colors duration-[var(--duration-quick)] ease-out",
                  password === confirm ? "text-success-on-surface" : "text-destructive-on-surface"
                )}
              >
                {password === confirm ? t("password.hint_match_success") : t("password.hint_match_error")}
              </p>
            )}
          </Field>

          <StrongPasswordToggle
            id="onboard-strong-password"
            checked={useStrongPassword}
            onCheckedChange={setUseStrongPassword}
            disabled={isSubmitting}
          />

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </form>
    </div>
  );
}

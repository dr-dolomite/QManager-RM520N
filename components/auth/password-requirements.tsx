"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// Live checklist under a new-password field. Keep RULES in step with
// auth/login.sh and auth/password.sh (minimum length 6 on RM520N).

type RuleKey = "length" | "uppercase" | "lowercase" | "number";

interface Rule {
  key: RuleKey;
  test: (pw: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 6;

const RULES: Rule[] = [
  { key: "length",    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { key: "uppercase", test: (pw) => /[A-Z]/.test(pw) },
  { key: "lowercase", test: (pw) => /[a-z]/.test(pw) },
  { key: "number",    test: (pw) => /[0-9]/.test(pw) },
];

/** Returns true when the password satisfies every rule shown in the checklist. */
export function isPasswordValid(pw: string, enforceStrong: boolean = true): boolean {
  if (!enforceStrong) return pw.length >= PASSWORD_MIN_LENGTH;
  return RULES.every((r) => r.test(pw));
}

export function PasswordRequirements({
  password,
  enforceStrong = true,
  className,
  id,
}: {
  password: string;
  enforceStrong?: boolean;
  className?: string;
  id?: string;
}) {
  const { t } = useTranslation("common");
  const activeRules = enforceStrong ? RULES : RULES.filter((r) => r.key === "length");

  return (
    <ul
      id={id}
      className={cn("flex flex-col gap-1 text-xs", className)}
      aria-label={t("password_rules.requirements_label")}
    >
      {activeRules.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.key} className="flex items-center gap-2">
            <CheckCircle2Icon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)]",
                met ? "text-success" : "text-muted-foreground/40"
              )}
            />
            <span
              className={cn(
                "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)]",
                met ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {t(`password_rules.rule.${rule.key}`)}
            </span>
            <span className="sr-only">
              {met ? t("password_rules.met") : t("password_rules.not_met")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

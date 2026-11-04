"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input, type FieldHostProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { COARSE_TARGET } from "./shapes";

// The toggle sits inside the field (32px); `COARSE_TARGET` reaches 44px via a pseudo-element.
const TOGGLE = `text-on-surface-variant hover:text-on-surface ${COARSE_TARGET}`;

interface PasswordInputProps extends FieldHostProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Password field with its own show/hide state; `host` picks the fill one step above its backdrop. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  disabled,
  invalid,
  describedBy,
  autoFocus,
  host,
  className,
}: PasswordInputProps) {
  const { t } = useTranslation("system-settings");
  const [visible, setVisible] = useState(false);
  const Glyph = visible ? EyeOffIcon : EyeIcon;

  return (
    <div className="relative w-full">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        host={host}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        disabled={disabled}
        className={cn("pr-11", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(TOGGLE, "absolute top-1/2 right-1.5 -translate-y-1/2")}
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={t(visible ? "passwords.toggle.hide" : "passwords.toggle.show")}
      >
        <Glyph className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

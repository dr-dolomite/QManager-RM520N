"use client";

import * as React from "react";
import { CheckCircle2Icon, EyeIcon, EyeOffIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  FIELD,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_TONE,
  SWITCH_ROW,
  type NoticeTone,
} from "./shapes";

// The channel form's controls. One box shape, one label/hint stack, one
// switch row — shared by all three channels so a field cannot drift per tab.

/** A 42px pill action. The coarse-pointer bump is what clears the 44px floor. */
export const CHANNEL_BUTTON =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold pointer-coarse:h-11";

/** The adornment sitting inside the field box, right-aligned. */
const ADORNMENT = "absolute top-1/2 right-3 flex -translate-y-1/2 items-center";

// -----------------------------------------------------------------------------
// ChannelSwitchRow — a channel's master enable, tinted by its own state.
// -----------------------------------------------------------------------------
export interface ChannelSwitchRowProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

export function ChannelSwitchRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
}: ChannelSwitchRowProps) {
  return (
    <div
      className={cn(
        SWITCH_ROW.ROOT,
        SWITCH_ROW.TRANSITION,
        checked ? SWITCH_ROW.ON : SWITCH_ROW.REST,
      )}
    >
      <div className={SWITCH_ROW.TEXT}>
        <label htmlFor={id} className={cn(SWITCH_ROW.TITLE, "block")}>
          {title}
        </label>
        <p className={SWITCH_ROW.DESC}>{description}</p>
      </div>
      {/* The pseudo-element target reaches 44px without a layout box, so the
          label above keeps its baseline. */}
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative flex-none before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']"
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChannelField — label, 42px box, then either a hint or an inline error.
// -----------------------------------------------------------------------------
export interface ChannelFieldProps {
  id: string;
  label: string;
  hint: React.ReactNode;
  /** Present means invalid: it replaces the hint and rings the box. */
  error?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: React.ComponentProps<"input">["type"];
  inputMode?: React.ComponentProps<"input">["inputMode"];
  autoComplete?: string;
  /** Machine voice: a phone number, an address, a Discord id. */
  mono?: boolean;
  /** A figure the user types. */
  numeric?: boolean;
  narrow?: boolean;
  /** Static text riding inside the box, e.g. a unit. */
  unit?: string;
  min?: string;
  max?: string;
}

export function ChannelField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  mono,
  numeric,
  narrow,
  unit,
  min,
  max,
}: ChannelFieldProps) {
  const describedBy = `${id}-note`;
  return (
    <div className={cn(FIELD.ROW, narrow && FIELD.NARROW)}>
      <label htmlFor={id} className={FIELD.LABEL}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            FIELD.SHELL,
            FIELD.INVALID,
            mono && FIELD.MONO,
            numeric && FIELD.NUM,
            unit && "pr-24",
          )}
        />
        {unit ? (
          <span
            aria-hidden
            className={cn(ADORNMENT, "text-on-surface-variant text-sm")}
          >
            {unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={describedBy} className={FIELD.ERROR}>
          {error}
        </p>
      ) : (
        <p id={describedBy} className={FIELD.HINT}>
          {hint}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChannelSecretField — a write-only credential. Never pre-filled; a stored
// secret shows a "Saved" chip and is kept by leaving the box empty.
// -----------------------------------------------------------------------------
export interface ChannelSecretFieldProps {
  id: string;
  label: string;
  hint: React.ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  isSet: boolean;
  savedLabel: string;
  placeholder: string;
  autoComplete: string;
  showLabel: string;
  hideLabel: string;
}

export function ChannelSecretField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  disabled,
  isSet,
  savedLabel,
  placeholder,
  autoComplete,
  showLabel,
  hideLabel,
}: ChannelSecretFieldProps) {
  const [revealed, setRevealed] = React.useState(false);
  const describedBy = `${id}-note`;
  return (
    <div className={FIELD.ROW}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={FIELD.LABEL}>
          {label}
        </label>
        {isSet ? (
          <Badge variant="success">
            <CheckCircle2Icon className="size-3" />
            {savedLabel}
          </Badge>
        ) : null}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            FIELD.SHELL,
            FIELD.INVALID,
            FIELD.MONO,
            "pr-12",
          )}
        />
        <button
          type="button"
          aria-label={revealed ? hideLabel : showLabel}
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
          disabled={disabled}
          className={cn(
            ADORNMENT,
            "text-on-surface-variant hover:text-on-surface focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background size-8 justify-center rounded-pill focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50",
            "transition-colors duration-[var(--duration-quick)] ease-out motion-reduce:transition-none",
          )}
        >
          {revealed ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </button>
      </div>
      {error ? (
        <p id={describedBy} className={FIELD.ERROR}>
          {error}
        </p>
      ) : (
        <p id={describedBy} className={FIELD.HINT}>
          {hint}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChannelNotice — a non-blocking line above the thing it is about.
// -----------------------------------------------------------------------------
export interface ChannelNoticeProps {
  tone: NoticeTone;
  icon: LucideIcon;
  children: React.ReactNode;
  /** Failures announce; a standing condition does not. */
  live?: boolean;
}

export function ChannelNotice({
  tone,
  icon: Icon,
  children,
  live,
}: ChannelNoticeProps) {
  return (
    <p
      className={cn(NOTICE, NOTICE_TONE[tone])}
      role={live ? "alert" : "status"}
    >
      <Icon className={NOTICE_GLYPH} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

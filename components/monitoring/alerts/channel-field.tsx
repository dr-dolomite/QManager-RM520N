"use client";

import * as React from "react";
import { CheckCircle2Icon, CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  SegmentedField,
  SEGMENTED,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";

import {
  FIELD,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PANEL,
  type NoticeTone,
} from "./shapes";

// The channel form's controls, shared by all three channels so a field cannot drift per tab.

/** The adornment sitting inside the field box, right-aligned. */
const ADORNMENT = "absolute top-1/2 right-3 flex -translate-y-1/2 items-center";

/** The lucide check that SegmentedField reserves on every segment. */
export const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// -----------------------------------------------------------------------------
// ChannelPanelHead — the channel's name, one line of what it does, and Off/On.
// -----------------------------------------------------------------------------
export interface ChannelPanelHeadProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

export function ChannelPanelHead({
  title,
  description,
  checked,
  onCheckedChange,
}: ChannelPanelHeadProps) {
  const { t } = useTranslation("common");
  const options: SegmentedOption<"on" | "off">[] = [
    { value: "off", label: t("state.off") },
    { value: "on", label: t("state.on") },
  ];
  return (
    <div className={PANEL.HEAD}>
      <div className={PANEL.HEAD_TEXT}>
        <p className={PANEL.TITLE}>{title}</p>
        <p className={PANEL.SUB}>{description}</p>
      </div>
      <SegmentedField
        value={checked ? "on" : "off"}
        onValueChange={(next) => onCheckedChange(next === "on")}
        options={options}
        ariaLabel={title}
        breakpoint="never"
        glyph={renderCheckGlyph}
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
  /** A `HintIcon` riding beside the label, for a hint that is not a consequence. */
  labelAddon?: React.ReactNode;
  hint?: React.ReactNode;
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
}

export function ChannelField({
  id,
  label,
  labelAddon,
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
}: ChannelFieldProps) {
  const describedBy = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={FIELD.ROW}>
      <div className={FIELD.LABEL_ROW}>
        <label htmlFor={id} className={FIELD.LABEL}>
          {label}
        </label>
        {labelAddon}
      </div>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={note ? describedBy : undefined}
        className={cn(FIELD.SHELL, FIELD.INVALID, mono && FIELD.MONO)}
      />
      {note ? (
        <p id={describedBy} className={error ? FIELD.ERROR : FIELD.HINT}>
          {note}
        </p>
      ) : null}
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
      <div className={FIELD.LABEL_ROW}>
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

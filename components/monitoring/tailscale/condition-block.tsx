"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CONDITION, CONDITION_TONE, type ConditionTone } from "./shapes";

// A condition REPLACES the surface rather than sitting above it. The block is
// the state, which is why it is one of the sanctioned container uses.
export interface ConditionBlockProps {
  tone: ConditionTone;
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: LucideIcon;
  actionDisabled?: boolean;
  /** One line beneath the action — on this surface, only the auth wait. */
  footer?: React.ReactNode;
  className?: string;
}

export function ConditionBlock({
  tone,
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  actionDisabled = false,
  footer,
  className,
}: ConditionBlockProps) {
  const skin = CONDITION_TONE[tone];
  return (
    <div className={cn(CONDITION.ROOT, skin.ROOT, className)} role="status">
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <Icon className={CONDITION.GLYPH} />
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAction}
          disabled={actionDisabled}
          className={cn(CONDITION.ACTION, skin.ACTION)}
        >
          {ActionIcon ? <ActionIcon className="size-4" /> : null}
          {actionLabel}
        </Button>
      ) : null}
      {footer ? <div className={CONDITION.FOOT}>{footer}</div> : null}
    </div>
  );
}

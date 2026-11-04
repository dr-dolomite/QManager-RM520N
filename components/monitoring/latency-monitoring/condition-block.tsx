"use client";

import { Loader2Icon, type LucideIcon } from "lucide-react";

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
  /** `tonal` for an action that changes a setting rather than retrying a read. */
  actionVariant?: "pill" | "tonal";
  /** Disables the action and swaps its glyph for a spinner while it runs. */
  actionBusy?: boolean;
}

export function ConditionBlock({
  tone,
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  actionVariant = "pill",
  actionBusy = false,
}: ConditionBlockProps) {
  const skin = CONDITION_TONE[tone];
  return (
    <div className={cn(CONDITION.ROOT, skin.ROOT)} role="status">
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <Icon className={CONDITION.GLYPH} />
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant={actionVariant === "tonal" ? "tonal" : "ghost"}
          onClick={onAction}
          disabled={actionBusy}
          className={cn(
            CONDITION.ACTION,
            actionVariant === "pill" && skin.ACTION,
          )}
        >
          {actionBusy ? (
            <Loader2Icon className="size-4 motion-safe:animate-spin" />
          ) : ActionIcon ? (
            <ActionIcon className="size-4" />
          ) : null}
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

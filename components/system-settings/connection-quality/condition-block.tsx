"use client";

import type * as React from "react";
import type { LucideIcon } from "lucide-react";

import {
  CONDITION_TONE,
  type ConditionTone,
} from "@/components/cellular/condition-screen";
import { cn } from "@/lib/utils";

import { CONDITION, FOCUS_RING, PILL_GLYPH } from "./shapes";

// The surface's state block: geometry from `./shapes`, colour from the shared
// `CONDITION_TONE`, glyph from lucide — this route's icon family.

export interface ConditionBlockProps {
  tone: ConditionTone;
  glyph: LucideIcon;
  ariaRole: "alert" | "status";
  title: string;
  description: string;
  /** Omit to render no affordance. */
  onAction?: () => void;
  actionLabel?: string;
  actionGlyph?: LucideIcon;
  className?: string;
}

export function ConditionBlock({
  tone,
  glyph: Glyph,
  ariaRole,
  title,
  description,
  onAction,
  actionLabel,
  actionGlyph: ActionGlyph,
  className,
}: ConditionBlockProps): React.JSX.Element {
  const spec = CONDITION_TONE[tone];

  return (
    <div
      role={ariaRole}
      className={cn(CONDITION.ROOT, spec.container, className)}
    >
      <span className={cn(CONDITION.DISC, spec.disc)}>
        <Glyph className={CONDITION.GLYPH} aria-hidden="true" />
      </span>
      <div className={CONDITION.TEXT}>
        <p className={CONDITION.TITLE}>{title}</p>
        <p className={CONDITION.BODY}>{description}</p>
      </div>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "inline-flex items-center transition-[background-color,color] duration-[var(--duration-quick)] ease-out",
            FOCUS_RING,
            CONDITION.ACTION,
            spec.action,
          )}
        >
          {ActionGlyph ? (
            <ActionGlyph className={PILL_GLYPH} aria-hidden="true" />
          ) : null}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default ConditionBlock;

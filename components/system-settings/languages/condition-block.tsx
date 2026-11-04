"use client";

import type * as React from "react";
import { RefreshCcwIcon } from "lucide-react";
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
  /**
   * The disc's tone when it must differ from the block's. A standing condition
   * takes a neutral ground and carries its tone on the disc alone, so a state
   * every device sits in permanently does not paint half a phone screen.
   */
  discTone?: ConditionTone;
  glyph: LucideIcon;
  ariaRole: "alert" | "status";
  title: string;
  description: string;
  /** Omit to render no retry affordance. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ConditionBlock({
  tone,
  discTone,
  glyph: Glyph,
  ariaRole,
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ConditionBlockProps): React.JSX.Element {
  const spec = CONDITION_TONE[tone];
  const disc = CONDITION_TONE[discTone ?? tone].disc;

  return (
    <div
      role={ariaRole}
      className={cn(CONDITION.ROOT, spec.container, className)}
    >
      <span className={cn(CONDITION.DISC, disc)}>
        <Glyph className={CONDITION.GLYPH} aria-hidden="true" />
      </span>
      <div className={CONDITION.TEXT}>
        <p className={CONDITION.TITLE}>{title}</p>
        <p className={CONDITION.BODY}>{description}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "inline-flex items-center transition-[background-color,color] duration-[var(--duration-quick)] ease-out",
            FOCUS_RING,
            CONDITION.ACTION,
            spec.action,
          )}
        >
          <RefreshCcwIcon className={PILL_GLYPH} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default ConditionBlock;

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useMotionReduced } from "@/components/motion-preference";
import { cn } from "@/lib/utils";

export interface ResetButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Discards the draft. Icon-only at rest, the label unfolds on hover or keyboard
 * focus (same reveal as the Cellular Settings `RefreshButton`). It animates
 * `grid-template-columns`, which `MotionConfig` cannot see, so the transition is
 * dropped under reduced motion. The accessible name is always the label.
 */
export function ResetButton({ label, onClick, disabled }: ResetButtonProps) {
  const reduceMotion = useMotionReduced();

  return (
    <Button
      type="button"
      variant="tonal-neutral"
      size="action"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group/reset gap-0"
    >
      <MaterialSymbol name="restart_alt" size={18} aria-hidden />
      <span
        aria-hidden
        className={cn(
          "grid grid-cols-[0fr] group-hover/reset:grid-cols-[1fr] group-focus-visible/reset:grid-cols-[1fr]",
          !reduceMotion &&
            "transition-[grid-template-columns] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
        )}
      >
        <span className="min-w-0 overflow-hidden">
          <span className="block pl-2">{label}</span>
        </span>
      </span>
    </Button>
  );
}

export default ResetButton;

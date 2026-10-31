"use client";

import type * as React from "react";
import type { LucideIcon } from "lucide-react";

import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The lucide glyph inside an action pill. */
const PILL_GLYPH = "size-4";

/**
 * Action pill, icon-only at rest; its label unfolds on hover or focus (lucide twin of
 * `RefreshButton`). Easing is dropped under reduced motion; the accessible name is the full label.
 */
export function RevealLabelButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "tonal-neutral",
  spinning = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  /** Spins the glyph while the action runs (Refresh). */
  spinning?: boolean;
}) {
  const reduceMotion = useMotionReduced();

  return (
    <Button
      type="button"
      variant={variant}
      size="action"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="group/reveal gap-0"
    >
      <Icon
        className={cn(PILL_GLYPH, spinning && "motion-safe:animate-spin")}
        aria-hidden="true"
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid grid-cols-[0fr] group-hover/reveal:grid-cols-[1fr] group-focus-visible/reveal:grid-cols-[1fr]",
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

export default RevealLabelButton;

"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useMotionReduced } from "@/components/motion-preference";
import { cn } from "@/lib/utils";

const K = "core_settings.basic";

export interface RefreshButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Re-reads the modem. The same tonal-neutral action button Band Locking uses for
 * its Refresh, but icon-only at rest: the label unfolds on hover or keyboard
 * focus. It animates `grid-template-columns`, which `MotionConfig` cannot see, so
 * the transition is dropped under reduced motion (the label still reveals, just
 * without easing). The accessible name is always the full label.
 */
export function RefreshButton({ onClick, disabled }: RefreshButtonProps) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useMotionReduced();
  const label = t(`${K}.footer.refresh`);

  return (
    <Button
      type="button"
      variant="tonal-neutral"
      size="action"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="group/refresh gap-0"
    >
      <MaterialSymbol name="refresh" size={18} aria-hidden />
      <span
        aria-hidden
        className={cn(
          "grid grid-cols-[0fr] group-hover/refresh:grid-cols-[1fr] group-focus-visible/refresh:grid-cols-[1fr]",
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

export default RefreshButton;

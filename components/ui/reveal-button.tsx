"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// RevealButton: an icon button that reveals its label on hover or focus, pushing its
// neighbour along. `blockedReason` blocks the click without `disabled` (same contract as `SaveButton`).

export interface RevealButtonProps
  extends Omit<ComponentProps<typeof Button>, "children" | "size"> {
  glyph: MaterialSymbolName;
  label: string;
  blockedReason?: string | null;
}

export function RevealButton({
  glyph,
  label,
  blockedReason = null,
  variant = "tonal-neutral",
  className,
  onClick,
  ...props
}: RevealButtonProps) {
  const blocked = Boolean(blockedReason);

  const button = (
    <Button
      type="button"
      variant={variant}
      aria-label={blockedReason ? `${label} — ${blockedReason}` : label}
      aria-disabled={blocked || undefined}
      data-blocked={blocked || undefined}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        "group/reveal h-[2.625rem] gap-0 px-3 data-[blocked]:cursor-not-allowed data-[blocked]:opacity-55",
        className,
      )}
      {...props}
    >
      <MaterialSymbol name={glyph} size={18} className="flex-none" />
      <span className="max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-[var(--duration-standard)] ease-[var(--ease-standard)] group-hover/reveal:max-w-40 group-hover/reveal:opacity-100 group-focus-visible/reveal:max-w-40 group-focus-visible/reveal:opacity-100 motion-reduce:transition-none">
        <span className="block whitespace-nowrap pl-2 pr-0.5 text-sm font-semibold">
          {label}
        </span>
      </span>
    </Button>
  );

  if (!blockedReason) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent className="max-w-72">{blockedReason}</TooltipContent>
    </Tooltip>
  );
}

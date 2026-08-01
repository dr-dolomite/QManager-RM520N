"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"

import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol"
import { cn } from "@/lib/utils"

function Checkbox({
  className,
  glyph,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** Material glyph to render inside the indicator on Material-Symbols routes. Omit on lucide routes. */
  glyph?: MaterialSymbolName
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {/* 14px is size-3.5 in pixels, and MaterialSymbol sizes itself with an
            inline fontSize no utility can override — so the box owns the size,
            not the call site, or a defaulted 20px glyph overflows the size-4 root. */}
        {glyph ? (
          <MaterialSymbol name={glyph} size={14} />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

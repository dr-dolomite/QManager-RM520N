"use client"

import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The transition is written out longhand because it runs on TWO clocks, and no
 * single Tailwind duration utility can express that. This is the same recipe
 * `badge.tsx` uses, for the same reason and against the same property pair.
 *
 *   color       -> `standard` (600ms). The ink swap. Two of the four consumers
 *                  (segmented-field.tsx, signal-history.tsx) put a `layoutId`
 *                  thumb underneath it at `transitionStandard`, so matching that
 *                  clock is what makes the label finish changing colour as the
 *                  pill lands rather than while it is still moving.
 *   box-shadow  -> `quick` (360ms). This is the `focus-visible:ring-[3px]` ring,
 *                  a pointer/keyboard state. At the longer duration it lags
 *                  visibly while tabbing through a settings form — badge.tsx
 *                  documents the same finding.
 *
 * WHAT WAS HERE BEFORE, and why it was a bug: `transition-[color,box-shadow]`
 * with no `duration-*` and no `ease-*`. `app/globals.css` does not override
 * `--default-transition-duration`, so Tailwind's own 150ms default applied —
 * off the shipped 360/600/800 scale, and immune to a retune of `lib/motion.ts`
 * plus the `--duration-*` properties. That is DESIGN.md > The One-Scale Rule,
 * and it leaked into all four consumers at once because none of them overrides
 * this string. Pinned by `scripts/test/toggle-primitive-one-scale.sh`.
 *
 * `background-color` is deliberately NOT in the list. It is live and still cuts
 * instantly on the two `variant="outline"` consumers (`hover:bg-accent`,
 * `data-[state=on]:bg-primary/10`) — badge.tsx calls the identical omission a
 * bug in its own case. Adding it here is a behaviour change rather than a leak
 * fix, so it was scoped out at the approval gate rather than smuggled in.
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary/10 data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none [transition:color_var(--duration-standard)_var(--ease-standard),box-shadow_var(--duration-quick)_var(--ease-quick)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-[var(--duration-quick)] ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Tonal secondary actions: a role container plus its own `on-` ink. Never
        // build this by hand as `variant="ghost"` plus a `bg-*-container`
        // override — `ghost`'s own `dark:hover:bg-accent/50` compiles to a
        // `:is(.dark *)`-qualified selector, which outranks a plain `hover:`
        // override on specificity alone, so the intended tonal hover silently
        // loses to ghost's neutral one in dark mode. These variants carry no
        // conflicting hover class, so there is nothing to lose to.
        tonal:
          "bg-primary-container text-on-primary-container hover:bg-primary-container/80",
        "tonal-destructive":
          "bg-destructive-container text-on-destructive-container hover:bg-destructive-container/80",
        "tonal-neutral":
          "bg-surface-container text-on-surface hover:bg-surface-container-high",
      },
      // The `has-[>svg]:` padding rules tighten a button that carries an icon
      // beside its label. `MaterialSymbol` renders a <span>, so each one is
      // mirrored for `>[data-slot=material-symbol]` or an icon+label button on a
      // Material route silently keeps the wider text-only padding — a quiet 8px
      // width shift, consistent across a page and therefore easy to miss.
      // See docs/reference/icon-system.md > The sizing gotcha for why the
      // `size-*` rules above are NOT mirrored (an inline fontSize outranks them).
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 has-[>[data-slot=material-symbol]]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 has-[>[data-slot=material-symbol]]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 has-[>[data-slot=material-symbol]]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 has-[>[data-slot=material-symbol]]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// The canon field (DESIGN.md > Inputs / Fields): 10px, no rest border, fill one step above its host.
// The transparent border is kept so `aria-invalid` can draw one without moving the box.
const fieldVariants = cva(
  "w-full min-w-0 rounded-field border border-transparent text-on-surface placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground transition-[color,box-shadow] duration-[var(--duration-quick)] ease-out outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      host: {
        surface: "bg-surface-container",
        container: "bg-surface-container-high",
      },
    },
    defaultVariants: { host: "surface" },
  }
)

type FieldHostProps = VariantProps<typeof fieldVariants>

function Input({
  className,
  type,
  host,
  ...props
}: React.ComponentProps<"input"> & FieldHostProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldVariants({ host }),
        "h-[2.625rem] px-3.5 py-1 text-base md:text-sm file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldVariants, type FieldHostProps }

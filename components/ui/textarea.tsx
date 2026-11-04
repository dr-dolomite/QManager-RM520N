import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldVariants, type FieldHostProps } from "@/components/ui/input"

function Textarea({
  className,
  host,
  ...props
}: React.ComponentProps<"textarea"> & FieldHostProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldVariants({ host }),
        "flex field-sizing-content min-h-16 px-3.5 py-2.5 text-base md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

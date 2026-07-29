import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Every `>svg` selector below is mirrored for `>[data-slot=material-symbol]`,
// because `MaterialSymbol` renders a <span> and this component's layout is
// CONDITIONAL on finding an icon child: with no match, `grid-cols-[0_1fr]` wins
// and the icon column is zero-width, so a Material glyph paints on top of the
// title instead of beside it. Nothing type-checks or builds differently — the
// only symptom is a broken-looking alert — which is why the mirror is here in
// the primitive rather than left to each call site to rediscover.
//
// `size` is deliberately NOT mirrored. `MaterialSymbol` sets `fontSize` as an
// inline style, which outranks any utility, so `[&>svg]:size-4` has no
// equivalent that could win; every glyph passes `size` explicitly instead. See
// docs/reference/icon-system.md > The sizing gotcha.
const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>[data-slot=material-symbol]]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 has-[>[data-slot=material-symbol]]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>[data-slot=material-symbol]]:translate-y-0.5 [&>svg]:text-current [&>[data-slot=material-symbol]]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive bg-card [&>svg]:text-current [&>[data-slot=material-symbol]]:text-current *:data-[slot=alert-description]:text-destructive/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }

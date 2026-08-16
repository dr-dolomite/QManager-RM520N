import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The chip's transition is written out longhand because it runs on TWO clocks,
 * and no single Tailwind duration utility can express that (DESIGN.md > Motion,
 * "Status chip swap"; Motion Guide recipe 05).
 *
 *   fill + ink  → `standard` (300ms). A container changing colour is a state
 *                 change with mass; at Tailwind's 150ms default it reads as a
 *                 flicker rather than a morph, which is the retired 140ms floor
 *                 the system deliberately moved off.
 *   focus ring  → `quick` (180ms). A ring is a pointer/keyboard state, and at
 *                 300ms it lags visibly while tabbing through a settings form.
 *
 * `background-color` was previously absent from the transition list entirely —
 * `transition-[color,box-shadow]` covers *text* colour and the ring, so every
 * status chip in the product cut straight to its new fill. The half of the
 * two-clock recipe that is supposed to be felt peripherally was never running.
 */
/*
 * Icon slot: `[&>svg]:size-3` auto-sizes a lucide child. It does NOT reach a
 * MaterialSymbol, which renders a <span> and sets fontSize inline — an inline
 * style outranks any utility, so a parallel sizing rule would silently lose.
 * Material glyphs in a Badge therefore pass `size` explicitly — 12 in a dense
 * chip, 16 on the signal-quality chip where the glyph is the only thing
 * carrying quality — which is also what keeps the opsz axis honest. Only
 * pointer-events ports across.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none [&>[data-slot=material-symbol]]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden [transition:color_var(--duration-standard)_var(--ease-standard),background-color_var(--duration-standard)_var(--ease-standard),box-shadow_var(--duration-quick)_ease-out]",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        // ── Status roles: filled tonal chips (the Filled-Chip Rule) ──────────
        // A role container fill, that container's `on-` ink, no visible border,
        // pill radius from the base. These replaced the retired outline-and-tint
        // badge; they are the ONLY correct way to render a status indicator.
        //
        // Colour alone never carries the state. `success-container` (L 0.89) and
        // `warning-container` (L 0.905) measure 1.03:1 apart, so they are the
        // same surface to anyone with deuteranopia and very nearly the same
        // surface to everyone else. The `size-3` glyph is doing the work, which
        // is why the base class reserves a slot for it. Never ship one of these
        // without an icon.
        //
        // Hover is `[a&]:` scoped on purpose: a static status chip that responds
        // to the cursor advertises a click target that does not exist.
        success:
          "border-transparent bg-success-container text-on-success-container [a&]:hover:bg-success-container/80",
        warning:
          "border-transparent bg-warning-container text-on-warning-container [a&]:hover:bg-warning-container/80",
        destructive:
          "border-transparent bg-destructive-container text-on-destructive-container [a&]:hover:bg-destructive-container/80",
        // Info resolves to the brand ramp, not a separate hue (Info-Is-Brand
        // Rule): an informational chip and a primary button differ by shape and
        // glyph, not by owning two different blues.
        info:
          "border-transparent bg-primary-container text-on-primary-container [a&]:hover:bg-primary-container/80",
        // Deliberately-inactive states (Stopped, Disabled, Offline peer) — not
        // failures. Failure is `destructive`.
        muted:
          "border-transparent bg-surface-container-high text-on-surface-variant [a&]:hover:bg-surface-container-high/80",
        // ── Identity roles: NOT status chips ────────────────────────────────
        // These carry which RADIO a chip belongs to — blue is the 5G NR leg,
        // violet the 4G LTE leg — and never vary with health. They exist so a
        // radio-identity tone can key onto `BadgeVariant` like every other tone
        // map, instead of being hand-written as a class string at the call site.
        //
        // They are not interchangeable with the five status roles above: an
        // identity fill says "this is the NR card", not "this is fine". A status
        // indicator must still be `success`/`warning`/`destructive`/`info`/
        // `muted`. Where a chip carries identity, the quality it also reports
        // has to be encoded somewhere non-chromatic — on the signal cards that
        // is the Material glyph's bar count.
        //
        // Carrier Violet ships as `--lte-*`: `secondary` in this codebase is
        // byte-identical to `surface-container`, so `text-secondary` on a row
        // pill would be 1.00:1 — literally invisible (DESIGN.md > Token Names
        // in Code).
        nr:
          "border-transparent bg-primary-container text-on-primary-container [a&]:hover:bg-primary-container/80",
        lte:
          "border-transparent bg-lte-container text-on-lte-container [a&]:hover:bg-lte-container/80",
        // ── Direction roles: also NOT status chips ──────────────────────────
        // Which WAY the bytes are going, and nothing else. They are a separate
        // axis from `nr`/`lte` on purpose: a download figure on the LTE leg is
        // rose-on-violet, and neither hue is guessing about the other.
        //
        // A direction chip must still pair its hue with an arrow glyph. At
        // container lightness in dark mode every tonal pair in this system
        // collapses under deuteranopia and protanopia simulation — measured,
        // including the pairs that already ship — so on a dark tile the hue is
        // decoration and the glyph is the information.
        downlink:
          "border-transparent bg-downlink-container text-on-downlink-container [a&]:hover:bg-downlink-container/80",
        uplink:
          "border-transparent bg-uplink-container text-on-uplink-container [a&]:hover:bg-uplink-container/80",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * The variant names, as a type. Tone maps should key onto this rather than onto
 * a class string, so adding a tone without a matching chip role fails the build.
 */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export { Badge, badgeVariants }
export type { BadgeVariant }

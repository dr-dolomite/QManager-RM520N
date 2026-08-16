import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The outline tag — identity and metadata (DESIGN.md > Components > Chips and
 * tags, and The Two-Form Rule).
 *
 * This is the second of the system's two chip forms, and the split is the whole
 * point. A filled `Badge` says whether a thing is WELL; a `Tag` says what a
 * thing IS — a band number, a radio family, a channel width, a capability. The
 * previous system had one form doing both jobs, which is how "which radio" and
 * "is it healthy" kept getting confused at a glance: an `nr` chip and an `info`
 * chip were byte-identical class strings, so a 5G identity label and a
 * "something is informational" chip were literally the same object.
 *
 * **A tag is never a status indicator.** It has no glyph requirement, because
 * there is no second state for a glyph to disambiguate — a band is not "well"
 * or "unwell", it is n78. Where a surface carries identity AND reports quality,
 * it renders both forms, and the quality is encoded non-chromatically as well
 * (The Identity-Chip Rule).
 *
 * ## Why outline rather than a pale fill
 *
 * Not taste — the fills were measured and they do not fit. In light mode the
 * usable pale-tint band (L 0.83–0.96 at low chroma) is too narrow to hold five
 * identity hues plus `surface-container-high` above the 0.05 separation floor;
 * 8 of 10 identity container pairs collapse there. The functional roles fit
 * because there are fewer of them and they may differ in lightness as well as
 * hue. So identity gets ink and outline, and never a large tinted block
 * (DESIGN.md > The three layers, and The Data-Ink Rule).
 *
 * The `--tag-*-text` values clear 4.5:1 against every card ground and the
 * `--tag-*-border` values clear 3:1; 0 of 6 border pairs collapse under
 * deuteranopia or protanopia simulation, in both themes.
 *
 * ## Why this is the system's one sanctioned border
 *
 * The No-Hairline-On-Fill Rule bans a border on a tonal container, because a
 * hairline over a fill reads as chrome around the colour rather than as the
 * edge of a block. The outline tag is the deliberate exception: there is no
 * fill for the stroke to sit on top of, so here the border IS the component.
 * Do not generalise the technique — DESIGN.md > The Fill-Over-Stroke Rule.
 */
const tagVariants = cva(
  // The base mirrors `Badge`'s geometry exactly — same padding, text step,
  // pill radius, icon slot and focus ring — so the two forms sit on one
  // baseline when a surface renders both. What differs is the fill (none) and
  // the border (visible, and coloured per role).
  //
  // `border-current` is deliberately NOT used: text and border are separate
  // tokens because they sit at different lightnesses to clear different
  // contrast thresholds (4.5:1 for the ink, 3:1 for the stroke). Collapsing
  // them onto one value would fail one of the two.
  //
  // The transition runs on the same two clocks as `Badge`: colour on
  // `standard`, the focus ring on `quick` (The One-Scale Rule). `border-color`
  // is listed explicitly — on this component the border is the fill, so
  // omitting it is the same defect `Badge` had when `background-color` was
  // missing from its own list.
  "inline-flex items-center justify-center rounded-full border bg-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none [&>[data-slot=material-symbol]]:pointer-events-none focus-visible:ring-ring/50 focus-visible:ring-[3px] overflow-hidden [transition:color_var(--duration-standard)_var(--ease-standard),border-color_var(--duration-standard)_var(--ease-standard),box-shadow_var(--duration-quick)_ease-out]",
  {
    variants: {
      variant: {
        /** The 5G NR leg. Brand blue, hue 262. */
        nr: "border-tag-nr-border text-tag-nr-text",
        /** The 4G LTE leg. Carrier Violet, hue 296. Never means healthy. */
        lte: "border-tag-lte-border text-tag-lte-text",
        /**
         * Antenna and spatial-stream metadata — MIMO layer counts, per-antenna
         * chains. A third axis, because a MIMO figure routinely names both
         * radios in one string (`LTE 1x2 | NR 2x4`) and no identity hue is
         * honest about that.
         */
        spatial: "border-tag-spatial-border text-tag-spatial-text",
        /**
         * Metadata with no honest hue — a band number, a channel width, a
         * count, a released carrier. The Neutral-Default Rule: a figure with
         * no honest hue stays neutral, and reaching for a colour because a tag
         * looked plain is the failure this system exists to prevent.
         */
        neutral: "border-tag-neutral-border text-tag-neutral-text",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Tag({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof tagVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="tag"
      className={cn(tagVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * The variant names, as a type. Identity maps key onto this rather than onto a
 * class string, so a new identity tone without a matching role fails the build
 * instead of rendering as a transparent, borderless ghost.
 */
type TagVariant = NonNullable<VariantProps<typeof tagVariants>["variant"]>

export { Tag, tagVariants }
export type { TagVariant }

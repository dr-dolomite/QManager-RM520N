"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

// A single-thumb range control. Always sits beside a numeric input that carries
// the exact value; the slider is the coarse, touch-friendly way to the same
// number. The root is a tap-sized row, the visible track stays slim.
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-10 w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-surface-container-high relative h-2 w-full grow overflow-hidden rounded-pill"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full rounded-pill"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="bg-primary border-background focus-visible:ring-ring focus-visible:ring-offset-background block size-5 shrink-0 rounded-pill border-2 shadow-sm transition-[box-shadow] duration-[var(--duration-quick)] ease-standard outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 disabled:pointer-events-none"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }

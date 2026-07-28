"use client";

import * as React from "react";

import { useValueTick } from "@/hooks/use-value-tick";
import { cn } from "@/lib/utils";

interface TickingValueProps extends React.ComponentProps<"span"> {
  /**
   * The datum whose CHANGE drives the dip — pass the raw value, not the
   * formatted string. `-78` re-rendering as `-78` must stay silent, or the card
   * spends a tick every poll announcing that nothing happened, which is the
   * "don't loop while nothing is happening" rule wearing a different hat.
   */
  value: unknown;
}

/**
 * A live figure that acknowledges its own change with the 180ms opacity dip
 * (Motion Guide recipe 06). Exists as a component rather than a bare hook
 * because the values that need it are almost always rendered inside a `.map`,
 * where a hook cannot go.
 *
 * `tabular-nums` is baked in rather than left to the caller: on proportional
 * figures every tick reflows the row and the dip amplifies the jitter it is
 * meant to absorb, so the two are not separable choices.
 */
export function TickingValue({
  value,
  className,
  children,
  ...props
}: TickingValueProps) {
  const ref = useValueTick(value);

  return (
    <span ref={ref} className={cn("tabular-nums", className)} {...props}>
      {children}
    </span>
  );
}

export default TickingValue;

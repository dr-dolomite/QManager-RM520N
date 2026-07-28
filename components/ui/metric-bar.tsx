"use client";

import * as React from "react";
import { motion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";
import {
  STAGGER_STEP,
  transitionMeterFill,
  transitionStandard,
} from "@/lib/motion";

export function MetricBar({
  value,
  max = 100,
  warnAt,
  dangerAt,
  colorOverride,
  index = 0,
}: {
  value: number;
  max?: number;
  warnAt: number;
  dangerAt: number;
  colorOverride?: "primary" | "warning" | "destructive";
  /** Position in a stack of meters, for the arrival cascade. */
  index?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);

  // First paint travels 0 -> full and takes `emphasized` plus its place in the
  // cascade; every later poll is a small retarget and stays on `standard` with
  // no delay.
  //
  // State rather than a ref, because a ref read during render is a genuine
  // correctness smell (react-hooks/refs) and not merely a lint preference. The
  // extra render this schedules is harmless here: `animate` still resolves to
  // the same `scaleX`, and motion only starts a new animation when the resolved
  // target changes, so swapping the transition mid-flight does not restart or
  // interrupt the arrival.
  const [transition, setTransition] = React.useState<Transition>(() => ({
    ...transitionMeterFill,
    delay: index * STAGGER_STEP,
  }));
  React.useEffect(() => {
    setTransition(transitionStandard);
  }, []);
  const colorClass = colorOverride
    ? `bg-${colorOverride}`
    : value >= dangerAt
      ? "bg-destructive"
      : value >= warnAt
        ? "bg-warning"
        : "bg-primary";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      {/* Meter fill (DESIGN.md > Motion > "Meter fill"): scaleX from the left,
          never width — width relayouts every frame of every meter on the page,
          on a modem SoC.

          This was a spring (`stiffness: 180, damping: 24`), which the
          Settled-Motion Rule bans outright: a spring settles by oscillating,
          so a CPU meter reading 61% overshot to ~64 and rocked back, showing a
          number the device never reported. `transitionStandard` ends at rest
          on the first arrival.

          `initial` runs on mount only; later polls retarget scaleX from
          wherever it currently is, which is the "first paint only, then
          transition" half of the recipe — do not add a key here. The two legs
          now carry different durations (see `transition` above): the arrival is
          `emphasized`, the retarget `standard`. Both were `standard`, which is
          what made a 0 -> full sweep read as a snap. */}
      <motion.div
        className={cn(
          "h-full rounded-full transition-colors duration-(--duration-standard) ease-standard",
          colorClass,
        )}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct / 100 }}
        style={{ originX: 0 }}
        transition={transition}
      />
    </div>
  );
}

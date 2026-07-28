"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { transitionStandard } from "@/lib/motion";

export function MetricBar({
  value,
  max = 100,
  warnAt,
  dangerAt,
  colorOverride,
}: {
  value: number;
  max?: number;
  warnAt: number;
  dangerAt: number;
  colorOverride?: "primary" | "warning" | "destructive";
}) {
  const pct = Math.min((value / max) * 100, 100);
  const colorClass = colorOverride
    ? `bg-${colorOverride}`
    : value >= dangerAt
      ? "bg-destructive"
      : value >= warnAt
        ? "bg-warning"
        : "bg-primary";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      {/* Meter fill (DESIGN.md > Motion > "Meter fill"): scaleX from the left
          on `standard`, never width — width relayouts every frame of every
          meter on the page, on a modem SoC.

          This was a spring (`stiffness: 180, damping: 24`), which the
          Settled-Motion Rule bans outright: a spring settles by oscillating,
          so a CPU meter reading 61% overshot to ~64 and rocked back, showing a
          number the device never reported. `transitionStandard` ends at rest
          on the first arrival.

          `initial` runs on mount only; later polls retarget scaleX from
          wherever it currently is, which is the "first paint only, then
          transition" half of the recipe — do not add a key here. */}
      <motion.div
        className={cn(
          "h-full rounded-full transition-colors duration-(--duration-standard) ease-standard",
          colorClass,
        )}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct / 100 }}
        style={{ originX: 0 }}
        transition={transitionStandard}
      />
    </div>
  );
}

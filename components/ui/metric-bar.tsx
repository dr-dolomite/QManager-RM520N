"use client";

import * as React from "react";
import { motion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";
import {
  STAGGER_STEP,
  transitionMeterFill,
  transitionStandard,
} from "@/lib/motion";

/**
 * The meter's fill tones, as a STATIC lookup.
 *
 * This was `` `bg-${colorOverride}` `` — a dynamic class string, which Tailwind
 * v4's static extractor cannot see. It rendered correctly only by accident:
 * `bg-primary`, `bg-warning` and `bg-destructive` each happen to appear as
 * literals elsewhere in the codebase, so the classes were in the bundle for
 * unrelated reasons. Adding `success` would have been the first tone with no
 * such coincidence backing it, and it would simply have rendered transparent.
 * A map keeps every tone extractable by construction.
 */
const TONE_CLASS = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
} as const;

export type MetricBarTone = keyof typeof TONE_CLASS;

/** Track fills, same static-extraction reasoning as `TONE_CLASS`. */
const TRACK_CLASS = {
  muted: "bg-muted",
  "surface-container-high": "bg-surface-container-high",
} as const;

/** Track heights. `sm` is the historical 1px-ish hairline; `md` is the 8px
 *  track the dashboard mock draws. */
const SIZE_CLASS = {
  sm: "h-1",
  md: "h-2",
} as const;

export function MetricBar({
  value,
  max = 100,
  warnAt,
  dangerAt,
  colorOverride,
  baseTone = "primary",
  size = "sm",
  track = "muted",
  index = 0,
}: {
  value: number;
  max?: number;
  warnAt: number;
  dangerAt: number;
  /** Hard override — pins the fill regardless of where `value` sits. */
  colorOverride?: MetricBarTone;
  /**
   * The tone the fill carries BELOW `warnAt`. Defaults to `primary`; the
   * dashboard's temperature meter passes `success`, because a cool modem is
   * actively good news rather than merely not-yet-bad. The warn/danger steps
   * still take over above their thresholds, so this never suppresses a warning.
   */
  baseTone?: MetricBarTone;
  /** Track height. `sm` (default) keeps every existing call site unchanged. */
  size?: keyof typeof SIZE_CLASS;
  /** Track fill role. Defaults to `muted` so existing call sites are unchanged. */
  track?: keyof typeof TRACK_CLASS;
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
  const tone: MetricBarTone =
    colorOverride ??
    (value >= dangerAt
      ? "destructive"
      : value >= warnAt
        ? "warning"
        : baseTone);
  const colorClass = TONE_CLASS[tone];
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full",
        SIZE_CLASS[size],
        TRACK_CLASS[track],
      )}
    >
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

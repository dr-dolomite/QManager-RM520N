"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { STAGGER_STEP, transitionMeterFill } from "@/lib/motion";

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
      {/* Meter fill (DESIGN.md > Motion > "Meter fill"): the value and the
          entrance are now deliberately split across two different mechanisms.

          The value lives in layout `width` (a plain CSS `transition`, not a
          motion prop), because a CSS `transform` scales the whole box —
          `border-radius` included. At low percentages a `scaleX`-only fill
          squashed the fill's own pill cap into a near-flat ellipse, so the
          leading edge read almost square instead of rounded. `width` resizes
          the box without touching its radius, so the cap stays a true
          semicircle at every value. Width now changes only on a poll retarget
          (~2-3s cadence, see poller-cadence note in CLAUDE.md), not every
          frame, so the old "width relayouts every frame" objection to width
          no longer applies — that concern was about animating width on every
          frame, and nothing here does that anymore.

          The entrance (0 -> current value, once, on mount) stays a pure
          `scaleX` transform for exactly the reason width was avoided
          everywhere else: a transform is compositor-only and doesn't touch
          layout, so the one-time arrival sweep stays cheap on the modem's
          SoC. It also lands at scaleX(1), where the radius distortion is
          zero, so the transient squash during the 300ms sweep is cosmetic
          and matches the design mock's own technique.

          This was a spring (`stiffness: 180, damping: 24`), which the
          Settled-Motion Rule bans outright: a spring settles by oscillating,
          so a CPU meter reading 61% overshot to ~64 and rocked back, showing a
          number the device never reported. `transitionMeterFill` ends at rest.

          `initial` runs on mount only, so the entrance never replays on a
          later width change — do not add a key here.

          `motion-reduce:transition-none` is load-bearing, not decoration.
          The scaleX entrance is a motion prop and so is governed by the app's
          global `<MotionConfig reducedMotion="user">`, but the width retarget
          is now plain CSS and sits entirely outside motion's reach — and
          `globals.css` has only per-component reduced-motion blocks, no
          blanket rule to catch it. Without this variant, moving the value out
          of `animate` would have quietly re-introduced an unstoppable
          animation for reduced-motion users. The bar still lands on the right
          width; it just arrives there instantly. */}
      <motion.div
        className={cn(
          "h-full rounded-full transition-[width,background-color] duration-(--duration-standard) ease-standard motion-reduce:transition-none",
          colorClass,
        )}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        style={{ originX: 0, width: `${pct}%` }}
        transition={{ ...transitionMeterFill, delay: index * STAGGER_STEP }}
      />
    </div>
  );
}

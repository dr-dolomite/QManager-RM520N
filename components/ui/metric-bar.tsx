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
  // Uplink Cyan, added for the SMS Center's SIM-memory meter. It is the only
  // identity hue that may fill a meter here, and it does so because the SM tile
  // it sits in is an `uplink-container` — the fill has to be that container's
  // own strong role or the meter reads as an unrelated colour dropped on a
  // cyan tile. Identity-Never-Acts still holds: this is a readout, not a
  // control.
  uplink: "bg-uplink",

  // The five-stop signal quality ramp (DESIGN.md > The signal quality ramp).
  // These are the `-bar` values, one lightness step bolder than the `--quality-N`
  // numeral ink, because a 4px fill needs more weight than a text figure to read
  // as the same colour.
  //
  // The ramp is a LIGHTNESS STAIRCASE, not a hue wheel: under deuteranopia hues
  // 27/45/72/115/149 collapse onto one yellow axis, so adjacent stops sit
  // deliberately below the 0.05 separation floor. Bar LENGTH is what makes that
  // safe — which is why a ramp tone here is only ever correct on a bar whose
  // length also encodes the value. A ramp tone on a fixed-width fill is a bug.
  "quality-1": "bg-quality-1-bar",
  "quality-2": "bg-quality-2-bar",
  "quality-3": "bg-quality-3-bar",
  "quality-4": "bg-quality-4-bar",
  "quality-5": "bg-quality-5-bar",
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
  /**
   * The measurement, or `null` for "we have no reading" — which renders the
   * track ALONE, with no fill element at all.
   *
   * This is not the same as `value={0}`, and the difference is the whole point
   * (DESIGN.md > Quality bars): an unused antenna drawn as a zero-length red
   * fill labelled "−140 dBm" reads as a signal problem the user should go and
   * fix, when in fact nothing is wrong and nothing was measured. An empty track
   * says "no reading" in the one channel — length — that the colour ramp is
   * explicitly not allowed to carry on its own.
   *
   * Callers get here from `normalizeSignalValue()` / `isPortReporting()` in
   * `types/modem-status.ts`, which are what decide that a value is a sentinel
   * rather than a measurement. Do not re-derive that test locally.
   */
  value: number | null;
  max?: number;
  warnAt: number;
  dangerAt: number;
  /**
   * Hard override — pins the fill regardless of where `value` sits.
   *
   * Accepts `null` so `qualityMeterTone()`'s return type can be passed straight
   * through. That function returns `null` for a missing reading, and threading
   * it through a `?? undefined` at every call site invited exactly the mistake
   * the `null` exists to prevent — one site eventually writes `?? "success"`
   * and paints an unread antenna green again, which is the bug this whole
   * migration removed. `null` and `undefined` mean the same thing here (no
   * override), and neither can paint anything when `value` is also `null`,
   * because no fill element is rendered at all.
   */
  colorOverride?: MetricBarTone | null;
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
  const hasReading = value !== null;
  const pct = hasReading ? Math.min((value / max) * 100, 100) : 0;

  const tone: MetricBarTone = !hasReading
    ? baseTone // unused — no fill is rendered without a reading
    : (colorOverride ??
      (value >= dangerAt
        ? "destructive"
        : value >= warnAt
          ? "warning"
          : baseTone));
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
      {hasReading && (
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
      )}
    </div>
  );
}

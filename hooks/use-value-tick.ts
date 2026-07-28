"use client";

import * as React from "react";

import { EASE_STANDARD_CSS, TICK } from "@/lib/motion";
import { TickGroupContext } from "@/components/ui/tick-group";

/**
 * The live-value tick (DESIGN.md > Motion, "Live value tick"; Motion Guide
 * recipe 06).
 *
 * A value that the device re-reports every couple of seconds needs to
 * acknowledge that it moved, without the acknowledgement becoming the loudest
 * thing on the card. The gesture is a dip to 35% opacity and back. No
 * fade-out-then-in, no slide, no colour flash, no layout shift: at a 2s poll
 * cadence a value cannot afford a gesture, only a flicker of attention.
 *
 * **The dip is asymmetric, and that is the whole recipe.** This originally ran
 * three evenly-spaced keyframes across a single `quick`, which bought 90ms per
 * leg — below the ~100ms floor where the eye reads a transition as motion at all
 * rather than as a state change. It blinked. The Motion Guide's own demo is
 * explicit about the shape: `mg-tick` reaches the dip at 12% of its cycle and
 * spends the remaining 88% coming back. The dip is the event; the return is the
 * settle. So the down leg runs on `quick` and the up leg on `standard`
 * (`TICK`, lib/motion.ts) — 480ms in total, composed from the existing scale
 * rather than a new duration.
 *
 * Five deliberate implementation choices:
 *
 * 1. **Web Animations API, not a keyed remount.** Remounting the node to
 *    restart a CSS animation would churn the DOM inside the dashboard's
 *    `aria-live` region on every poll, and would make the tick fire on values
 *    that merely re-rendered. `element.animate()` targets the live node.
 * 2. **Interrupt and RETARGET, never queue.** The Motion Guide is explicit that
 *    a value changing mid-transition must retarget from where it is rather than
 *    wait in line: "a queue makes the UI drift behind the device, which on a
 *    monitoring tool is the worst failure mode there is." See the retarget note
 *    below — this used to cancel to full opacity, which was survivable only
 *    while the restart was same-frame.
 * 3. **Silent on first paint.** `previous` is seeded with the mount value, so
 *    arriving is the skeleton crossfade's job and this only ever reports change.
 * 4. **Per-keyframe easing, not one curve over the whole run.** A single
 *    `easing` option would stretch one curve across both legs and re-symmetrise
 *    what the offsets just separated. In the Web Animations API an `easing` on
 *    a keyframe governs the interval *from that keyframe to the next*, so the
 *    two legs carry their own tokens' curves in one `animate()` call.
 * 5. **The start is deferred to the group, when there is one.** Inside a
 *    `TickGroup` the dip does not begin on the commit that changed the value;
 *    it begins once the group has counted how many siblings moved in the same
 *    commit and where this one ranks among them (components/ui/tick-group.tsx).
 *    Outside a group the delay is zero and the behaviour is unchanged.
 *
 * **Retargeting, and why the cascade forced it.** The previous implementation
 * `cancel()`ed the running animation, which snaps opacity back to 1 before the
 * replacement starts. That was invisible while every tick began on the frame it
 * was requested: the snap and the new dip happened together. Under a cascade it
 * would not be — a value re-changing mid-dip would snap to full, hold there for
 * its whole delay, and only then dip again, so the fastest-moving figures on a
 * card would get the worst feedback. Two things fix it together: the first
 * keyframe is the element's *current computed* opacity (read before the cancel,
 * since cancelling is what discards it), and `fill: "backwards"` holds that
 * first keyframe through the delay instead of painting the resting state. That
 * is the same construction `.ca-meter` uses in globals.css, where
 * `animation-fill-mode: backwards` stops a staggered meter painting at full
 * scale before its turn arrives.
 *
 * Reduced motion switches it off rather than preserving the opacity half. The
 * usual rule (movement goes, opacity stays) exists because a crossfade still
 * carries information; a repeating luminance flash every two seconds carries
 * none — the new number is already on screen — and it is precisely the kind of
 * repetition the preference is asking to be spared.
 *
 * Returns a ref to attach to the element holding the value. Pair it with
 * `tabular-nums`: on proportional figures the row reflows on every tick and the
 * dip amplifies the jitter instead of absorbing it.
 */
export function useValueTick<T>(value: T): React.RefObject<HTMLSpanElement | null> {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const previous = React.useRef<T>(value);
  const running = React.useRef<Animation | null>(null);
  const group = React.useContext(TickGroupContext);

  const start = React.useCallback((delayMs: number) => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Read before cancelling: cancel() reverts the node to its resting opacity,
    // so asking afterwards always answers 1 and the retarget is lost.
    const from = running.current
      ? Number.parseFloat(window.getComputedStyle(el).opacity) || 1
      : 1;

    running.current?.cancel();
    running.current = el.animate(
      [
        // Down leg: `quick`, on quick's own ease-out. Starts wherever an
        // interrupted dip had reached rather than from full opacity.
        { opacity: from, offset: 0, easing: "ease-out" },
        // Up leg: `standard`, on standard's curve. The dip sits at 37.5% of the
        // run, which is what makes the return read as a settle rather than the
        // second half of a flash.
        { opacity: TICK.opacity, offset: TICK.dipOffset, easing: EASE_STANDARD_CSS },
        { opacity: 1, offset: 1 },
      ],
      {
        duration: TICK.duration * 1000,
        delay: delayMs,
        // Holds the `from` keyframe through the delay. Without it the node
        // paints at full opacity, waits out its rank, then jumps down to begin
        // the dip — a pop followed by a freeze.
        fill: "backwards",
      },
    );
  }, []);

  React.useLayoutEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;

    // A layout effect rather than `useEffect` so the registration lands before
    // the group's microtask drain: that ordering is what lets one commit's
    // worth of changed values be ranked against each other instead of each
    // firing alone.
    if (group) {
      const el = ref.current;
      if (el) group.enqueue({ node: el, start });
      return;
    }

    start(0);
  }, [value, group, start]);

  React.useEffect(() => () => running.current?.cancel(), []);

  return ref;
}

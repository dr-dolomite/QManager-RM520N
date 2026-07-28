"use client";

import * as React from "react";

import { DUR } from "@/lib/motion";

/**
 * The live-value tick (DESIGN.md > Motion, "Live value tick"; Motion Guide
 * recipe 06).
 *
 * A value that the device re-reports every couple of seconds needs to
 * acknowledge that it moved, without the acknowledgement becoming the loudest
 * thing on the card. The whole gesture is a dip to 35% opacity and back over
 * `quick`. No fade-out-then-in, no slide, no colour flash, no layout shift:
 * at a 2s poll cadence a value cannot afford a gesture, only a flicker of
 * attention.
 *
 * Three deliberate implementation choices:
 *
 * 1. **Web Animations API, not a keyed remount.** Remounting the node to
 *    restart a CSS animation would churn the DOM inside the dashboard's
 *    `aria-live` region on every poll, and would make the tick fire on values
 *    that merely re-rendered. `element.animate()` targets the live node.
 * 2. **Interrupt, never queue.** The Motion Guide is explicit that a value
 *    changing mid-transition must retarget from where it is rather than wait in
 *    line: "a queue makes the UI drift behind the device, which on a monitoring
 *    tool is the worst failure mode there is." The previous animation is
 *    cancelled outright.
 * 3. **Silent on first paint.** `previous` is seeded with the mount value, so
 *    arriving is the skeleton crossfade's job and this only ever reports change.
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

  React.useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;

    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    running.current?.cancel();
    running.current = el.animate(
      [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
      { duration: DUR.quick * 1000, easing: "ease-out" },
    );
  }, [value]);

  React.useEffect(() => () => running.current?.cancel(), []);

  return ref;
}

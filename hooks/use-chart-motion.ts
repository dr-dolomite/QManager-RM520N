"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

import { DUR, EASE_STANDARD_CSS } from "@/lib/motion";

// =============================================================================
// Chart motion — the two clocks a live-updating chart runs on
// =============================================================================
// A polling chart has TWO distinct motion jobs and they used to be in conflict:
//
//   ENTRANCE — drawn once, when the chart first appears. Owned by the CSS
//   `.chart-draw` recipe in globals.css (Motion Guide recipe 16): the stroke
//   unwinds its dash on `standard`, the fill follows 80ms behind it.
//
//   UPDATE — the trace moving to a new shape when a poll lands. Owned by
//   recharts, which interpolates each point from its previous position to its
//   new one (`Area.js:250-265`) and is the only thing that can do this, since
//   nothing outside recharts knows where a point sits in plot space.
//
// The conflict: recharts wraps an animated series in `<Animate key={"area-" +
// animationId}>` (`Area.js:245`), and `animationId` is the chart's `updateId`,
// incremented on every data change (`generateCategoricalChart.js:2035`). A
// changed React key remounts the subtree, so each poll produces a BRAND NEW
// path node — and a CSS `@keyframes` fires on element mount. Leave `.chart-draw`
// on the container and every poll replays the entrance: the line re-draws itself
// from zero and the fill flashes transparent, on top of the morph.
//
// That is why both cards shipped with `isAnimationActive={false}`, which bought
// a stable path node and a once-only entrance at the cost of all update motion —
// the poll retarget became a single-frame teleport. This module resolves it by
// making the entrance class TRANSIENT instead of permanent: it is on the
// container for exactly as long as the entrance runs, then removed. After that
// the remounts keep happening and there is simply no CSS left for them to fire.
// =============================================================================

/**
 * How far the area fill trails the stroke, so the line reads as leading it.
 *
 * A FRACTION of the stroke's own duration rather than a fixed millisecond
 * count — the lead-follow only reads correctly if the gap stays proportional,
 * and this constant used to be a bare `80`, which was ~27% of a 300ms stroke by
 * coincidence rather than by construction. `/ 3.75` reproduces that ratio and
 * survives a retune of the scale.
 *
 * Mirrors the `calc(var(--duration-standard) / 3.75)` delay on
 * `.chart-draw .recharts-area-area` in globals.css. Retune both together.
 */
export const CHART_TRAIL_MS = (DUR.standard * 1000) / 3.75;

/**
 * How long the CSS entrance actually occupies the element.
 *
 * The stroke runs `standard` from t=0; the fill runs `standard` from
 * t=`CHART_TRAIL_MS`, so the tail is one `standard` plus the trail. Two frames
 * of slack on top, because removing the class mid-keyframe would snap the fill
 * from part-way-faded to opaque — cheap insurance against a slow frame, and
 * invisible either way since the class does nothing once its animations have
 * finished.
 */
export const CHART_DRAW_MS = DUR.standard * 1000 + CHART_TRAIL_MS + 32;

/**
 * The entrance class, for exactly one entrance.
 *
 * Spread onto the `ChartContainer`'s className. Returns `"chart-draw"` while the
 * entrance is running and `""` afterwards.
 *
 * `resetKey` re-arms it. Signal History puts `key={signalType}` on its
 * `ChartContainer`, so switching metric genuinely remounts the chart and the
 * entrance SHOULD play again — but the component itself does not remount, so
 * this hook's state would otherwise stay retired from the first paint. Pass the
 * same value used as the container key and the two stay in step.
 *
 * Non-load-bearing by construction, in the same sense as the keyframes it
 * gates: if the timer never fires the chart is still fully drawn and correct,
 * it just keeps replaying its entrance. If it fires early the entrance is cut
 * short. Neither can leave the chart in a wrong state.
 */
export function useChartDrawIn(resetKey?: string | number): string {
  const [drawing, setDrawing] = useState(true);
  const [armedFor, setArmedFor] = useState(resetKey);

  // Re-armed DURING RENDER, not in an effect, and that distinction is the whole
  // correctness of the reset path.
  //
  // Effects run after commit and paint. Arming there would order the frames
  // like this on a metric switch: the render that changes `resetKey` also
  // changes the `ChartContainer`'s `key`, so React unmounts the old chart and
  // mounts a new one — carrying `""`, because the effect has not run yet. Those
  // fresh path nodes paint once fully drawn and undashed. Only THEN does the
  // effect fire, put `chart-draw` back, and start the animation. The user sees
  // one frame of the finished chart followed by it redrawing itself: precisely
  // the opposite of an entrance.
  //
  // A render-phase update to this component's own state is the sanctioned React
  // pattern for deriving state from a changed input. React re-runs the render
  // immediately, before touching the DOM, so the remounted chart commits with
  // the class already on it and the keyframes fire on mount as intended.
  if (resetKey !== armedFor) {
    setArmedFor(resetKey);
    setDrawing(true);
  }

  // Keyed on `armedFor` as well as `drawing` so a reset that lands MID-entrance
  // restarts the clock. Without it, `setDrawing(true)` above would be a no-op
  // on an already-true value, the effect would not re-run, and the in-flight
  // timer would cut the new entrance short by however far the old one had run.
  useEffect(() => {
    if (!drawing) return;
    const id = window.setTimeout(() => setDrawing(false), CHART_DRAW_MS);
    return () => window.clearTimeout(id);
  }, [drawing, armedFor]);

  return drawing ? "chart-draw" : "";
}

/**
 * The shared animation props for a recharts series (`<Area>` / `<Line>`).
 * Spread onto every series in a live-updating chart, so the whole product's
 * charts move on one clock and one curve.
 *
 * Reduced motion is handled HERE rather than by `<MotionConfig>`: recharts
 * animates through react-smooth, which is a separate engine that motion/react
 * knows nothing about, so the global switch cannot reach it. `useReducedMotion`
 * reads the same media query, and turning the flag off does not degrade the
 * chart — recharts then renders the series statically, which is the correct end
 * state, reached instantly.
 *
 * Known upstream limitation: `useReducedMotion` resolves during the first
 * render but does not subscribe to later changes of the OS setting, so toggling
 * it mid-session is not picked up until a reload (a motion/react TODO, not
 * something this hook can fix). It fails in the safe direction — the setting is
 * read correctly on every page load.
 */
export function useChartSeriesMotion() {
  const prefersReducedMotion = useReducedMotion();

  return {
    isAnimationActive: !prefersReducedMotion,
    /** Milliseconds — recharts' unit, where `DUR` is motion/react's seconds. */
    animationDuration: DUR.standard * 1000,
    /**
     * The project's `--ease-standard`, not one of the five CSS keywords.
     *
     * recharts types this prop as `AnimationTiming`, a union of the keyword
     * easings only — but that union is under-specified, not restrictive:
     * react-smooth's `configEasing` explicitly parses `cubic-bezier(x1,y1,x2,y2)`
     * (`react-smooth/es6/easing.js:167`) and its own warning message lists that
     * form as valid input. The cast satisfies the narrow type; the runtime gets
     * the real curve. Worst case if that ever changed, react-smooth `warn()`s
     * and falls through to no easing function rather than throwing.
     */
    animationEasing: EASE_STANDARD_CSS as "ease-out",
  } as const;
}

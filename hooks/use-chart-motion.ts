"use client";

import { useEffect, useState } from "react";

import { useMotionReduced } from "@/components/motion-preference";
import { DUR, EASE_STANDARD_CSS } from "@/lib/motion";

// A live chart runs two clocks: the CSS `.chart-draw` entrance (once) and recharts'
// per-poll morph. recharts remounts the path every poll, so the entrance class must be transient.

/** Fill trails the stroke by a fraction of `standard`; mirrors the `/ 3.75` delay in globals.css. */
export const CHART_TRAIL_MS = (DUR.standard * 1000) / 3.75;

/** Stroke + trailing fill, plus two frames of slack so the class never leaves mid-keyframe. */
export const CHART_DRAW_MS = DUR.standard * 1000 + CHART_TRAIL_MS + 32;

/**
 * `"chart-draw"` for exactly one entrance, then `""`. Pass the container's `key` as
 * `resetKey` so a metric switch replays it. Non-load-bearing: a missed timer only replays.
 */
export function useChartDrawIn(resetKey?: string | number): string {
  const [drawing, setDrawing] = useState(true);
  const [armedFor, setArmedFor] = useState(resetKey);

  // Re-armed during render, not in an effect: an effect would let the remounted chart
  // paint one undashed frame before the entrance starts.
  if (resetKey !== armedFor) {
    setArmedFor(resetKey);
    setDrawing(true);
  }

  // Keyed on `armedFor` too, so a reset mid-entrance restarts the clock.
  useEffect(() => {
    if (!drawing) return;
    const id = window.setTimeout(() => setDrawing(false), CHART_DRAW_MS);
    return () => window.clearTimeout(id);
  }, [drawing, armedFor]);

  return drawing ? "chart-draw" : "";
}

/**
 * Shared animation props for a recharts `<Area>` / `<Line>`. recharts animates through
 * react-smooth, which MotionConfig cannot reach, so the preference is read here.
 */
export function useChartSeriesMotion() {
  const reduced = useMotionReduced();

  return {
    isAnimationActive: !reduced,
    /** Milliseconds — recharts' unit, where `DUR` is motion/react's seconds. */
    animationDuration: DUR.standard * 1000,
    /** react-smooth parses `cubic-bezier()`; the cast only satisfies recharts' keyword-only type. */
    animationEasing: EASE_STANDARD_CSS as "ease-out",
  } as const;
}

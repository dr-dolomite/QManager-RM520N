"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { cn } from "@/lib/utils";

import {
  BADGE_GLYPH_SIZE,
  COST,
  HERO_SPLIT,
  POSTURE,
  POSTURE_DISC,
  RUN_BADGE,
  RUN_HERO,
  SECTION_HEAD,
  SKELETON_SHAPE,
  formatElapsed,
  type RunPosture,
} from "./shapes";

// =============================================================================
// RunHero — the page's anchor, and the object that replaces four layouts
// =============================================================================
// The incumbent had no hero. It swapped the ENTIRE card body between an empty
// state, a centred spinner stack, a centred error stack and a table, so "start a
// scan", "a scan is running" and "a scan failed" were three different pages
// sharing a route, with nothing stable across them and no shared place to say
// what a run costs.
//
// This is that stable object. It is always mounted and it MORPHS through its
// posture rather than being replaced: same rail, same disc, same clock slot,
// same cost statement, same action row — only the tone, the glyph and the copy
// move. That is what makes the posture change legible as one thing changing
// state instead of as a navigation.
//
// IT IS DELIBERATELY COPY-BLIND. Every string arrives as a prop, because the two
// scanning routes disagree about almost all of them — one sweeps every band for
// three minutes and pauses the modem, the other reads the neighbour list in two
// seconds. The SHAPE is what they share; pretending the words were shared too is
// how both routes ended up shipping a button that read "Start New Scan" for runs
// that differ by 100x in cost.
// =============================================================================

export interface RunHeroProps {
  posture: RunPosture;
  /** Section title, e.g. "Full band sweep". */
  title: string;
  /** One line beside the title, on its row rather than under it. */
  description?: string;
  /** The posture chip's label. Swaps on the `quick` clock when the posture moves. */
  chipLabel: string;
  postureTitle: string;
  postureBody: string;
  /**
   * The elapsed clock, while a run is in flight. Interface font with tabular
   * figures, never mono: it changes while the reader watches without them
   * acting, which is exactly the Machine-Voice Rule's test.
   */
  clock?: { seconds: number; ariaLabel: string } | null;
  /**
   * The clock slot's occupant when no run is in flight — a result count, say.
   * Ignored while `clock` is set, so the two can never stack.
   */
  metric?: React.ReactNode;
  /** Required. See `COST` in the shapes contract for why this is not optional. */
  costText: string;
  /** Route-owned buttons. They style themselves with `PILL_ACTION` and friends. */
  actions?: React.ReactNode;
  /** First paint, before the worker's status is known. */
  isLoading?: boolean;
}

export function RunHero({
  posture,
  title,
  description,
  chipLabel,
  postureTitle,
  postureBody,
  clock,
  metric,
  costText,
  actions,
  isLoading = false,
}: RunHeroProps) {
  const tone = RUN_BADGE[posture];

  // The one ambient motion on this surface, and it is not decorative: a sweep
  // publishes nothing for up to three minutes, so a still page is
  // indistinguishable from a hung one.
  //
  // IT RUNS ON THE DISC ONLY, never also on the chip glyph. Both slots draw the
  // same `progress_activity` mark from `RUN_BADGE`, so spinning both put two
  // synchronised loops ~200px apart in one hero — which reads as a busy
  // interface rather than a live one, and spends the One-Loop Rule's whole
  // budget for this surface twice over. The disc wins because it is the focal
  // element; the chip's 12px mark reads as an in-progress badge while static.
  const spin =
    posture === "scanning"
      ? "animate-spin motion-reduce:animate-none"
      : undefined;

  return (
    <Card className={RUN_HERO}>
      <div className={SECTION_HEAD.ROOT}>
        <h2 className={SECTION_HEAD.TITLE}>{title}</h2>
        {description ? (
          <p className={SECTION_HEAD.DESC}>{description}</p>
        ) : null}

        <div className={SECTION_HEAD.META}>
          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.CHIP} />
          ) : (
            <Badge variant={tone.variant}>
              {/* Recipe 05: the fill and ink morph on `standard` inside
                  badge.tsx while the label crossfades on `quick` here. The
                  GLYPH travels with the label because it changes with it — two
                  postures never share one, since success-container and
                  warning-container are the same surface to the eye. The key
                  carries the variant as well as the text so a posture change
                  that keeps its wording still swaps. */}
              <SwapLabel
                swapKey={`${tone.variant}:${chipLabel}`}
                className="gap-1"
              >
                <MaterialSymbol
                  name={tone.glyph}
                  size={BADGE_GLYPH_SIZE}
                  filled={tone.filled}
                />
                {chipLabel}
              </SwapLabel>
            </Badge>
          )}
        </div>
      </div>

      <div className={HERO_SPLIT}>
        {/* ---- Posture rail ------------------------------------------------ */}
        {isLoading ? (
          <Skeleton className={SKELETON_SHAPE.POSTURE} />
        ) : (
          <div className={POSTURE.ROOT}>
            <span className={cn(POSTURE.DISC, POSTURE_DISC[posture])}>
              <MaterialSymbol
                name={tone.glyph}
                size={24}
                filled={tone.filled}
                className={spin}
              />
            </span>

            {clock ? (
              <p
                className={POSTURE.CLOCK}
                role="timer"
                // `off`, not `polite`: a clock that announces itself once a
                // second makes a screen reader unusable for the three minutes
                // the sweep runs. The label carries it on demand.
                aria-live="off"
                aria-label={clock.ariaLabel}
              >
                {formatElapsed(clock.seconds)}
              </p>
            ) : metric ? (
              <p className={POSTURE.CLOCK}>{metric}</p>
            ) : null}

            <span className={POSTURE.TITLE}>{postureTitle}</span>
            <span className={POSTURE.BODY}>{postureBody}</span>
          </div>
        )}

        {/* ---- Cost and actions -------------------------------------------- */}
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.COST} />
          ) : (
            <div className={COST.ROOT}>
              <MaterialSymbol
                name="info"
                size={18}
                className="text-on-surface-variant flex-none"
              />
              <p className={COST.TEXT}>{costText}</p>
            </div>
          )}

          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          ) : actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default RunHero;

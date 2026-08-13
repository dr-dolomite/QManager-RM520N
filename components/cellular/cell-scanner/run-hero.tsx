"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  HERO_SPLIT,
  POSTURE,
  POSTURE_DISC,
  POSTURE_GLYPH,
  RUN_HERO,
  SECTION_HEAD,
  SKELETON_SHAPE,
  type RunPosture,
} from "./shapes";

// =============================================================================
// RunHero — the page's anchor, and the object that replaces four layouts
// =============================================================================
// The incumbent had no hero. It swapped the ENTIRE card body between an empty
// state, a centred spinner stack, a centred error stack and a table, so "start a
// scan", "a scan is running" and "a scan failed" were three different pages
// sharing a route, with nothing stable across them.
//
// This is that stable object. It is always mounted and it MORPHS through its
// posture rather than being replaced: same rail, same disc, same count slot,
// same action row — only the tone, the glyph and the copy move. That is what
// makes the posture change legible as one thing changing state instead of as a
// navigation.
//
// IT IS DELIBERATELY COPY-BLIND. Every string arrives as a prop, because the two
// scanning routes disagree about almost all of them — one sweeps every band for
// three minutes and pauses the modem, the other reads the neighbour list in two
// seconds. The SHAPE is what they share; pretending the words were shared too is
// how both routes ended up shipping a button that read "Start New Scan" for runs
// that differ by 100x in cost.
//
// -----------------------------------------------------------------------------
// THE POSTURE CHIP IS GONE, ON PURPOSE (2026-08-12)
// -----------------------------------------------------------------------------
// The header used to carry a `Badge` reading "Ready" / "Sweeping" / "Complete" /
// "Failed", morphing on the `standard` clock while its label crossfaded on
// `quick`. It was a well-built restatement of something the rail below it
// already says with a tinted disc, a spinning glyph, a title and a line of body
// copy — two objects, one fact, ~200px apart, and the chip was the one with no
// room to explain itself.
//
// The RAIL is the posture carrier now, on all four postures and both routes.
// What moved into the vacated header slot is the thing this surface genuinely
// lacked: a path to the sibling route.
//
// THE RUNNING STATE CARRIES NO NUMBERS. There is no `clock` prop any more and
// nothing replaced it. `AT+QSCAN` reports nothing at all between dispatch and
// completion, so an elapsed timer was the only honest figure available and even
// it invited the reader to estimate a remaining time the modem never provides.
// The disc's ambient spin says "alive"; the copy says "this takes a few
// minutes". See `shapes.ts`'s file header.
// =============================================================================

export interface RunHeroProps {
  posture: RunPosture;
  /** Section title, e.g. "Full band sweep". */
  title: string;
  /** One line beside the title, on its row rather than under it. */
  description?: string;
  /**
   * The cross-link to the sibling scanning route, in the header slot the
   * posture chip used to occupy. Route-owned, because only the route knows
   * where it is going and why it may not go there right now.
   */
  link?: React.ReactNode;
  postureTitle: string;
  /** Omitted on the complete posture — see `metric`. */
  postureBody?: string | null;
  /**
   * The one large figure in the posture rail: a completed run's result count.
   * Absent while nothing has completed.
   *
   * It is now the rail's SUBJECT rather than one line of five — the context
   * caption under it and the body sentence under that were both removed by user
   * decision (see `shapes.ts`'s file header), so the figure and the disc carry
   * the complete posture between them.
   */
  metric?: React.ReactNode;
  /** "What this run found". Route-owned, and drawn from the rows. */
  summary?: React.ReactNode;
  /**
   * NO `costText`. The hero used to carry a required cost paragraph on both
   * routes; it was removed by user decision on 2026-08-14 along with its `COST`
   * shape and skeleton mirror. See `shapes.ts`'s file header for what still
   * expresses the sweep/read asymmetry in its place — a later pass should not
   * put the slot back.
   */
  /** Route-owned buttons. They style themselves with `PILL_ACTION` and friends. */
  actions?: React.ReactNode;
  /** First paint, before the worker's status is known. */
  isLoading?: boolean;
}

export function RunHero({
  posture,
  title,
  description,
  link,
  postureTitle,
  postureBody,
  metric,
  summary,
  actions,
  isLoading = false,
}: RunHeroProps) {
  const mark = POSTURE_GLYPH[posture];

  // The one ambient motion on this surface, and it is not decorative: a sweep
  // publishes nothing for up to three minutes, so a still page is
  // indistinguishable from a hung one. It is also now the ONLY thing carrying
  // "still working" — there is no clock beside it — which is precisely the
  // "only where something is genuinely live" case the One-Loop Rule allows.
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

        {isLoading ? (
          <div className={SECTION_HEAD.META}>
            <Skeleton className={SKELETON_SHAPE.LINK} />
          </div>
        ) : link ? (
          <div className={SECTION_HEAD.META}>{link}</div>
        ) : null}
      </div>

      <div className={HERO_SPLIT}>
        {/* ---- Posture rail ------------------------------------------------ */}
        {isLoading ? (
          <Skeleton className={SKELETON_SHAPE.POSTURE} />
        ) : (
          <div className={POSTURE.ROOT}>
            <span className={cn(POSTURE.DISC, POSTURE_DISC[posture])}>
              <MaterialSymbol
                name={mark.glyph}
                size={32}
                filled={mark.filled}
                className={spin}
              />
            </span>

            {metric !== null && metric !== undefined ? (
              <p className={POSTURE.CLOCK}>{metric}</p>
            ) : null}

            <span className={POSTURE.TITLE}>{postureTitle}</span>
            {/* Absent on the complete posture, where the figure above already
                is the count and a sentence restating it was duplication. */}
            {postureBody ? (
              <span className={POSTURE.BODY}>{postureBody}</span>
            ) : null}
          </div>
        )}

        {/* ---- Summary and actions ----------------------------------------- */}
        <div className="flex flex-col gap-4">
          {summary}

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

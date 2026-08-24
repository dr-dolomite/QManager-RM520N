"use client";

import * as React from "react";

import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  HERO_MORPH,
  HERO_RAIL_ONLY,
  HERO_SPLIT,
  POSTURE_DISC,
  POSTURE_GLYPH,
  RAIL,
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
// posture rather than being replaced: same header, same rail, same summary slot
// — only the height, the tone, the glyph and the copy move.
//
// -----------------------------------------------------------------------------
// ITS HEIGHT IS NOW PART OF WHAT MORPHS (2026-08-24)
// -----------------------------------------------------------------------------
// The hero used to be one fixed height in all four postures, sized for the
// richest of them. At idle that meant a 13rem rail saying "no sweep yet" beside
// an empty summary column with a stranded button in it — roughly 280px of card
// spent telling the reader that nothing had happened, which they could see.
//
// It is a compact launch bar at idle now (title, description, action) and GROWS
// into the rail-plus-summary body when a run starts. The growth is a real
// container morph — `HERO_MORPH`, a `grid-template-rows: 0fr -> 1fr` wrapper on
// `--duration-emphasized` / `--ease-emphasized` — so the hero genuinely gets
// taller rather than swapping one fixed block for another. Nothing overshoots
// and nothing springs; the reader sees ONE object taking on what it now has to
// report.
//
// Two structural consequences:
//
//   1. THE ACTIONS LIVE IN THE HEADER, in `SECTION_HEAD.META` beside the sibling
//      link. There is no action row under the summary any more, because at idle
//      there is no summary for it to sit under, and a button that changes which
//      row it belongs to depending on posture is the incumbent's problem in
//      miniature.
//   2. THE RAIL IS A ROW (`RAIL`), not the centred `POSTURE` stack. Its height
//      is the hero's height in every open state, so every pixel of it has to be
//      carrying something.
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
  /** One line UNDER the title — see `SECTION_HEAD` for why it stacks. */
  description?: string;
  /**
   * The cross-link to the sibling scanning route, in the header slot the
   * posture chip used to occupy. Route-owned, because only the route knows
   * where it is going and why it may not go there right now.
   */
  link?: React.ReactNode;
  /**
   * Route-owned buttons, rendered in the header beside `link`. They style
   * themselves with `PILL_ACTION` and friends.
   *
   * A route may pass NOTHING here, and the failed posture is where that
   * matters: the results card carries the recovery action in that state, and a
   * hero that also offered one would put two buttons on one screen for one act.
   * The hero does not make that call — it has no opinion about which affordance
   * a route wants to be the single one.
   */
  actions?: React.ReactNode;
  postureTitle: string;
  /**
   * Machine voice for `postureTitle`. The failed posture's title is the modem's
   * own string (`+CME ERROR: 4 — operation not supported`), which is a raw
   * machine string; every other posture's is authored English.
   */
  postureTitleIsMachine?: boolean;
  /** Omitted on the complete posture — see `metric`. */
  postureBody?: string | null;
  /**
   * The one large figure in the posture rail: a completed run's result count.
   * Absent while nothing has completed.
   *
   * It is the rail's SUBJECT rather than one line of five — the context caption
   * under it and the body sentence under that were both removed by user decision
   * (see `shapes.ts`'s file header), so the figure and the disc carry the
   * complete posture between them.
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
  /**
   * Collapse the body to nothing at idle, and grow into it when a run starts.
   *
   * THE TWO ROUTES DIVERGE HERE, AND THAT IS THE POINT OF THE PROP. The sweep
   * passes `true`: it holds the modem's AT lock for 30-180 seconds, so the grow
   * lands once, early, and then the reader waits — the morph reads as the page
   * committing to a long operation. The neighbour read passes `false`, because
   * a read is done in about two seconds: an 800ms grow followed almost
   * immediately by the content it grew for reads as the panel twitching rather
   * than as progress, and the same container would be back at rest before the
   * gesture finished being noticed. See the comment at the neighbour route's
   * call site.
   */
  idleCollapsed?: boolean;
  /** First paint, before the worker's status is known. */
  isLoading?: boolean;
  /**
   * Suppress the hero's own posture rail when a summary is present, because the
   * route has already folded an equivalent card into `summary` (as `RunSummary`'s
   * `leading` slot) so the run's own status reads as one more peer tile instead
   * of a differently-sized card beside the grid.
   *
   * ONLY MEANINGFUL WHEN A SUMMARY IS PRESENT. If the route passes `true` here
   * but `summary` is empty (nothing to fold the rail into), the rail still
   * renders — otherwise the run's own status would vanish from the idle, scanning
   * and failed postures, which never carry a folded-in copy of it.
   *
   * Added for the neighbour route's completed posture only; the sweep route
   * never passes this; its rail keeps its own 64px/48px sizing exactly as
   * `shapes.ts` documents.
   */
  hideRail?: boolean;
}

export function RunHero({
  posture,
  title,
  description,
  link,
  actions,
  postureTitle,
  postureTitleIsMachine = false,
  postureBody,
  metric,
  summary,
  idleCollapsed = false,
  isLoading = false,
  hideRail = false,
}: RunHeroProps) {
  const mark = POSTURE_GLYPH[posture];

  // The body is closed only where a route asked for the collapse AND there is
  // genuinely nothing to report. `isLoading` forces it open: a first paint that
  // starts collapsed and grows the moment the worker's status arrives is a
  // morph the reader did not cause.
  const isOpen = isLoading || !idleCollapsed || posture !== "idle";

  // The one ambient motion on this surface, and it is not decorative: a sweep
  // publishes nothing for up to three minutes, so a still page is
  // indistinguishable from a hung one. It is also now the ONLY thing carrying
  // "still working" — there is no clock beside it — which is precisely the
  // "only where something is genuinely live" case the One-Loop Rule allows.
  const spin =
    posture === "scanning"
      ? "animate-spin motion-reduce:animate-none"
      : undefined;

  // A fixed 19rem rail with two thirds of a hero blank beside it is the void
  // this redesign removed from the idle state. When a route has no summary to
  // show — the neighbour route before its first read — the rail takes the whole
  // width instead of anchoring an empty split.
  const hasSummary = isLoading || (summary !== null && summary !== undefined);

  // The rail is suppressed only when the route has somewhere to fold it — see
  // `hideRail`'s doc comment. Without a summary there is nothing to fold into,
  // so the rail stays the only object reporting the run's status.
  const showOwnRail = !hideRail || !hasSummary;

  return (
    <Card className={RUN_HERO}>
      <div className={SECTION_HEAD.ROOT}>
        <div className={SECTION_HEAD.TITLES}>
          <h2 className={SECTION_HEAD.TITLE}>{title}</h2>
          {description ? (
            <p className={SECTION_HEAD.DESC}>{description}</p>
          ) : null}
        </div>

        {isLoading ? (
          <div className={SECTION_HEAD.META}>
            <Skeleton className={SKELETON_SHAPE.LINK} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        ) : link || actions ? (
          <div className={SECTION_HEAD.META}>
            {link}
            {actions}
          </div>
        ) : null}
      </div>

      {/* The container morph. The wrapper is ALWAYS mounted so the grow has
          something to animate; what is conditional is the content inside it,
          which is laid out before the row opens and is therefore already at its
          final height when the transition starts. */}
      <div className={HERO_MORPH.WRAP} data-open={isOpen}>
        <div className={HERO_MORPH.CLIP}>
          {isOpen ? (
            <div
              className={cn(
                HERO_MORPH.BODY,
                // `showOwnRail` false collapses to the single-column wrapper too
                // — `summary` fills the whole width once it carries the folded
                // rail as its own leading tile. `HERO_RAIL_ONLY`'s single-column
                // grid is exactly that shape; see its doc comment.
                hasSummary
                  ? showOwnRail
                    ? HERO_SPLIT
                    : HERO_RAIL_ONLY
                  : HERO_RAIL_ONLY,
              )}
            >
              {/* ---- Posture rail ------------------------------------------ */}
              {showOwnRail ? (
                isLoading ? (
                  <Skeleton className={SKELETON_SHAPE.RAIL} />
                ) : (
                  <div className={RAIL.ROOT}>
                    <span className={cn(RAIL.DISC, POSTURE_DISC[posture])}>
                      <MaterialSymbol
                        name={mark.glyph}
                        size={32}
                        filled={mark.filled}
                        className={spin}
                      />
                    </span>

                    <div className={RAIL.COPY}>
                      {metric !== null && metric !== undefined ? (
                        <p className={RAIL.COUNT}>{metric}</p>
                      ) : null}

                      <span
                        className={
                          postureTitleIsMachine
                            ? RAIL.TITLE_MACHINE
                            : RAIL.TITLE
                        }
                      >
                        {postureTitle}
                      </span>

                      {/* Absent on the complete posture, where the figure above
                          already is the count and a sentence restating it was
                          the same fact twice. */}
                      {postureBody ? (
                        <span className={RAIL.BODY}>{postureBody}</span>
                      ) : null}
                    </div>
                  </div>
                )
              ) : null}

              {/* ---- Summary ----------------------------------------------- */}
              {summary}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default RunHero;

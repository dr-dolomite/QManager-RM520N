"use client";

import * as React from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  HERO_MORPH,
  LEDGER,
  POSTURE_DISC,
  POSTURE_GLYPH,
  RUN_HERO,
  RUN_HERO_META,
  SECTION_HEAD,
  SKELETON_SHAPE,
  type RunPosture,
} from "./shapes";

// =============================================================================
// RunHero — the page's anchor: a launch bar at idle that grows into a ledger
// =============================================================================
// Always mounted; it morphs through its posture. Copy-blind: every string is a
// prop, so both scanning routes share the shape and keep their own words.
// =============================================================================

export interface RunHeroProps {
  posture: RunPosture;
  title: string;
  description?: string;
  /** The cross-link to the sibling route. */
  link?: React.ReactNode;
  /** Route-owned buttons beside `link`. A route may pass nothing (the failed posture). */
  actions?: React.ReactNode;
  postureTitle: string;
  /** The modem's own error string takes machine voice. */
  postureTitleIsMachine?: boolean;
  postureBody?: string | null;
  /** The complete posture's figure: the run's total, never a count of rendered rows. */
  metric?: number | null;
  /** The figure's unit word, already pluralised. */
  metricUnit?: string | null;
  /** The scanning posture's estimated progress, 0-100; `null` draws no bar. */
  progress?: number | null;
  /** The bar's accessible name. Required whenever `progress` is set. */
  progressLabel?: string;
  /** The ledger's rows region, or `null` for a status-only ledger (idle, failed). */
  rows?: React.ReactNode | null;
  /** The verdict strip, rendered below the ledger. */
  verdict?: React.ReactNode | null;
  /** Collapse the body at idle and grow into it when a run starts. */
  idleCollapsed?: boolean;
  /** First paint, before the worker's status is known. No caller passes it today. */
  isLoading?: boolean;
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
  metricUnit,
  progress,
  progressLabel,
  rows,
  verdict,
  idleCollapsed = false,
  isLoading = false,
}: RunHeroProps) {
  const mark = POSTURE_GLYPH[posture];

  // `isLoading` forces the body open: a grow the reader did not cause is noise.
  const isOpen = isLoading || !idleCollapsed || posture !== "idle";

  // The one ambient motion: a run publishes nothing until it ends.
  const spin =
    posture === "scanning"
      ? "motion-safe:animate-spin"
      : undefined;

  const hasRows = rows !== null && rows !== undefined;
  const showFig = metric !== null && metric !== undefined;
  const showBar = progress !== null && progress !== undefined;

  return (
    <Card className={RUN_HERO}>
      <div className={SECTION_HEAD.ROOT}>
        <div className={SECTION_HEAD.TITLES}>
          <CardTitle as="h2" className={SECTION_HEAD.TITLE}>{title}</CardTitle>
          {description ? (
            <CardDescription className={SECTION_HEAD.DESC}>{description}</CardDescription>
          ) : null}
        </div>

        {isLoading ? (
          <div className={cn(SECTION_HEAD.META, RUN_HERO_META)}>
            <Skeleton className={SKELETON_SHAPE.LINK} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        ) : link || actions ? (
          <div className={cn(SECTION_HEAD.META, RUN_HERO_META)}>
            {link}
            {actions}
          </div>
        ) : null}
      </div>

      {/* The wrapper is always mounted so the grow has something to animate. */}
      <div className={HERO_MORPH.WRAP} data-open={isOpen}>
        <div className={HERO_MORPH.CLIP}>
          {isOpen ? (
            <div className={cn(HERO_MORPH.BODY, "flex flex-col gap-3")}>
              {isLoading ? (
                <div className={LEDGER.ROOT}>
                  <div className={LEDGER.STATUS_ROOT}>
                    <Skeleton className={SKELETON_SHAPE.LEDGER_DISC} />
                    <div className={LEDGER.STATUS_TEXT}>
                      <Skeleton className={SKELETON_SHAPE.TITLE} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className={cn(LEDGER.ROOT, hasRows && LEDGER.ROOT_SPLIT)}>
                  {showFig ? (
                    <div
                      className={cn(
                        LEDGER.SUMMARY_ROOT,
                        hasRows && LEDGER.STATUS_DIVIDER,
                      )}
                    >
                      {/* The check and the figure say it finished; the title stays for assistive tech. */}
                      <span className="sr-only">{postureTitle}</span>
                      <span
                        className={cn(LEDGER.STATUS_DISC, POSTURE_DISC[posture])}
                        aria-hidden="true"
                      >
                        <MaterialSymbol
                          name={mark.glyph}
                          size={20}
                          filled={mark.filled}
                        />
                      </span>
                      <div className={LEDGER.SUMMARY_FIG}>
                        <span className={LEDGER.SUMMARY_FIG_NUM}>{metric}</span>
                        {metricUnit ? (
                          <span className={LEDGER.SUMMARY_FIG_UNIT}>
                            {metricUnit}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        LEDGER.STATUS_ROOT,
                        hasRows && LEDGER.STATUS_DIVIDER,
                      )}
                    >
                      <span
                        className={cn(LEDGER.STATUS_DISC, POSTURE_DISC[posture])}
                      >
                        <MaterialSymbol
                          name={mark.glyph}
                          size={20}
                          filled={mark.filled}
                          className={spin}
                        />
                      </span>

                      <div className={LEDGER.STATUS_TEXT}>
                        <span
                          className={
                            postureTitleIsMachine
                              ? LEDGER.STATUS_TITLE_MACHINE
                              : LEDGER.STATUS_TITLE
                          }
                        >
                          {postureTitle}
                        </span>

                        {postureBody ? (
                          <span className={LEDGER.STATUS_BODY}>
                            {postureBody}
                          </span>
                        ) : null}
                      </div>

                      {showBar ? (
                        <Progress
                          value={progress ?? 0}
                          aria-label={progressLabel}
                          className={cn(
                            LEDGER.STATUS_BAR,
                            "h-1.5 bg-surface-container-high",
                          )}
                        />
                      ) : null}
                    </div>
                  )}

                  {hasRows ? rows : null}
                </div>
              )}

              {verdict}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default RunHero;

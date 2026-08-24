"use client";

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import {
  SKELETON_SHAPE,
  SUMMARY,
  SUMMARY_TILE_DISC,
  VERDICT,
  VERDICT_TONE,
  type SignalTier,
  type VerdictTone,
} from "./shapes";

// =============================================================================
// RunSummary — what the run FOUND, before the reader reaches the table
// =============================================================================
// The results table answers "which cells are there". It does not answer "what
// did this run actually tell me", and on a surface where a sweep costs three
// minutes of frozen modem that is the more expensive question to leave open.
// The count in the posture rail says how many; this says of what.
//
// -----------------------------------------------------------------------------
// THE TILES ARE NEUTRAL AND THE COLOUR IS ON THE DISC (2026-08-24)
// -----------------------------------------------------------------------------
// Every tile body used to carry a role fill drawn from a three-tone triad
// rotated by ARRAY POSITION, so the first group wore the brand's one acting
// colour because it sorted first. It differentiated the tiles, which was the
// stated problem, but with colour that encodes nothing — a reader who learned
// "the blue one matters" had learned a fact about sort order.
//
// The body is `surface-container` on every tile now, and the hue moved to a 52px
// disc where it means the group's BEST measured signal tier. Same
// differentiation, and now the differentiation is the finding. Every tier also
// carries its own glyph, because `success-container` and `warning-container` are
// 1.03:1 apart and a disc has no text inside it to fall back on.
//
// The panel's own `surface-container` wrapper and its "What this sweep found"
// heading went with the change: a container holding tiles of its own tone is a
// tile-shaped hole rather than a tone step, and the heading was the third thing
// on one screen naming the same run. See `SUMMARY` in `shapes.ts`.
//
// DELIBERATELY COPY-BLIND, exactly like `run-hero.tsx`. Every string arrives as
// a prop and every number arrives pre-derived, because the two routes disagree
// about all of them: a sweep groups by PROVIDER and reports the bands each was
// seen on, a neighbour read groups by RELATION and reports how many rows carry
// measurements at all. The SHAPE is what they share.
//
// EVERY AGGREGATE IS THE CALLER'S, and the caller memoises it. This component
// does no arithmetic — not even the tier, which `summaries.ts` derives — which
// is what keeps "survives an empty array, a single row and all-sentinel data" a
// property of one tested place per route rather than of a rendering path.
//
// THE MACHINE-VOICE SPLIT IS PER DETAIL, not per tile. A band list, an EARFCN
// and a channel number are identifiers that hold steady until something
// reconfigures them, so they take `DETAIL_IDENT` (mono); a count and a dBm
// reading take `DETAIL_FIGURE` (interface font, tabular). The caller says which
// by tagging each detail, because only the caller knows what the string is.
// =============================================================================

/** One fact under a tile's name, tagged with the voice it should be read in. */
export interface SummaryDetail {
  text: string;
  voice: "ident" | "figure";
}

export interface SummaryTile {
  /** Stable across renders — the provider name, the relation, `others`. */
  id: string;
  label: string;
  /**
   * A provider the modem named only by its MCC-MNC pair is an identifier and
   * takes mono; an operator name and a translated relation label do not.
   */
  labelVoice?: "text" | "machine";
  /**
   * The group's best measured signal tier, derived in `summaries.ts`. Drives
   * BOTH the disc's tone and its glyph, so the two can never disagree.
   */
  tier: SignalTier;
  /**
   * The tier in words — "Good", "No data". `MaterialSymbol` is ligature-driven
   * and therefore always `aria-hidden`, so without this the disc's whole meaning
   * would be unreadable to a screen reader and invisible in greyscale print.
   * Rendered `sr-only`: the sighted reader has the glyph and the tone.
   */
  tierLabel: string;
  details: SummaryDetail[];
}

/**
 * The one-line explanation under the tiles. Present only when it has something
 * TRUE to say — a mixed spread of readings gets no verdict, because "the results
 * vary" is not an explanation.
 */
export interface SummaryVerdict {
  tone: VerdictTone;
  /**
   * Must differ from every other glyph that can appear in this slot. Two
   * verdicts sharing a mark would be told apart by fill alone, and
   * `success-container` / `warning-container` are 1.03:1 apart.
   */
  glyph: MaterialSymbolName;
  text: string;
}

export interface RunSummaryProps {
  tiles: SummaryTile[];
  verdict?: SummaryVerdict | null;
  /** Shown instead of the grid when a completed run produced no tiles. */
  emptyText: string;
  /**
   * A run is in flight. The panel is derived from rows THIS run is replacing, so
   * it draws its skeleton rather than last run's numbers wearing this run's
   * posture.
   */
  isLoading?: boolean;
  /**
   * An extra grid item rendered BEFORE the tiles, inside the same `SUMMARY.GRID`
   * — already shaped and styled by the caller as a `SUMMARY.TILE`. This is how a
   * route folds its posture rail into the tile row so the two read as one set of
   * peer cards instead of a rail beside a grid; see `RunHero`'s `hideRail`.
   *
   * This component stays copy-blind and posture-blind either way: it does not
   * build the node, it only gives it a slot in the grid it already owns.
   */
  leading?: ReactNode;
}

/**
 * The loading state, mirroring the loaded grid by COMPOSITION rather than by
 * height: the same `SUMMARY.GRID`, the same `SUMMARY.TILE` boxes, a disc
 * placeholder at the disc's size and two line boxes where the name and the
 * details go. A single tall bar would be a shape the loaded panel can no longer
 * take, and the swap would reflow the hero it sits in.
 */
function SummarySkeleton() {
  return (
    <div className={SUMMARY.GRID}>
      {Array.from({ length: SKELETON_SHAPE.SUMMARY_TILES }).map((_, index) => (
        <div key={index} className={SUMMARY.TILE}>
          <Skeleton className={SKELETON_SHAPE.SUMMARY_DISC} />
          <div className={cn(SUMMARY.COPY, "w-full gap-1.5")}>
            <Skeleton className={SKELETON_SHAPE.SUMMARY_LABEL} />
            <Skeleton className={SKELETON_SHAPE.SUMMARY_DETAILS} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RunSummary({
  tiles,
  verdict,
  emptyText,
  isLoading = false,
  leading = null,
}: RunSummaryProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-live="polite">
      {isLoading ? (
        <SummarySkeleton />
      ) : tiles.length === 0 && !leading ? (
        <p className={SUMMARY.EMPTY}>{emptyText}</p>
      ) : (
        <div className={SUMMARY.GRID}>
          {leading}
          {tiles.map((tile) => {
            const disc = SUMMARY_TILE_DISC[tile.tier];

            return (
              <div key={tile.id} className={SUMMARY.TILE}>
                <span className={cn(SUMMARY.DISC, disc.tone)}>
                  <MaterialSymbol name={disc.glyph} size={26} />
                  <span className="sr-only">{tile.tierLabel}</span>
                </span>

                <div className={SUMMARY.COPY}>
                  <span
                    className={
                      tile.labelVoice === "machine"
                        ? SUMMARY.LABEL_IDENT
                        : SUMMARY.LABEL
                    }
                  >
                    {tile.label}
                  </span>

                  {tile.details.length > 0 ? (
                    <span className={SUMMARY.DETAILS}>
                      {tile.details.map((detail) => (
                        <span
                          key={`${tile.id}:${detail.text}`}
                          className={
                            detail.voice === "ident"
                              ? SUMMARY.DETAIL_IDENT
                              : SUMMARY.DETAIL_FIGURE
                          }
                        >
                          {detail.text}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {verdict && !isLoading ? (
        <p className={cn(VERDICT.ROOT, VERDICT_TONE[verdict.tone])}>
          <MaterialSymbol
            name={verdict.glyph}
            size={18}
            filled
            className="flex-none"
          />
          <span className={VERDICT.TEXT}>{verdict.text}</span>
        </p>
      ) : null}
    </section>
  );
}

export default RunSummary;

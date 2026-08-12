"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import {
  SKELETON_SHAPE,
  SUMMARY,
  summaryTileTone,
  VERDICT,
  VERDICT_TONE,
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
// DELIBERATELY COPY-BLIND, exactly like `run-hero.tsx`. Every string arrives as
// a prop and every number arrives pre-derived, because the two routes disagree
// about all of them: a sweep groups by PROVIDER and reports the bands each was
// seen on, a neighbour read groups by RELATION and reports how many rows carry
// measurements at all. The SHAPE is what they share.
//
// EVERY AGGREGATE IS THE CALLER'S, and the caller memoises it. This component
// does no arithmetic, which is what keeps "survives an empty array, a single
// row and all-sentinel data" a property of one tested place per route rather
// than a property of a rendering path.
//
// THE MACHINE-VOICE SPLIT IS PER DETAIL, not per tile. A band list, an EARFCN
// and a channel number are identifiers that hold steady until something
// reconfigures them, so they take `DETAIL_IDENT` (mono); a count and a dBm
// reading take `DETAIL_FIGURE` (interface font, tabular). The caller says which
// by tagging each detail, because only the caller knows what the string is.
// =============================================================================

/** One fact under a tile's count, tagged with the voice it should be read in. */
export interface SummaryDetail {
  text: string;
  voice: "ident" | "figure";
}

export interface SummaryTile {
  /** Stable across renders — the provider name, the relation, `others`. */
  id: string;
  label: string;
  /** A changing figure. Rendered `tabular-nums` in the interface font. */
  value: number;
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
  title: string;
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
}

export function RunSummary({
  title,
  tiles,
  verdict,
  emptyText,
  isLoading = false,
}: RunSummaryProps) {
  if (isLoading) {
    return <Skeleton className={SKELETON_SHAPE.SUMMARY} />;
  }

  return (
    <section className={SUMMARY.ROOT} aria-live="polite">
      <h3 className={SUMMARY.TITLE}>{title}</h3>

      {tiles.length === 0 ? (
        <p className={SUMMARY.DETAIL_FIGURE}>{emptyText}</p>
      ) : (
        <div className={SUMMARY.GRID}>
          {tiles.map((tile, index) => (
            <div
              key={tile.id}
              className={cn(SUMMARY.TILE, summaryTileTone(index))}
            >
              <span className={SUMMARY.LABEL}>{tile.label}</span>
              <span className={SUMMARY.VALUE}>{tile.value}</span>
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
          ))}
        </div>
      )}

      {verdict ? (
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

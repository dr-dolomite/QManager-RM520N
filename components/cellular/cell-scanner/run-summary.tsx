"use client";

import * as React from "react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import { SignalBadge } from "./signal-badges";
import { LEDGER, SKELETON_SHAPE } from "./shapes";

// =============================================================================
// LedgerRows — the ledger's rows region: one row per group
// =============================================================================
// Copy-blind: every string is a prop. The caller renders it only while scanning
// or complete, so a failed run never shows the previous run's rows.
// =============================================================================

/** One rendered row: a group, or the folded "N more" row. */
export interface LedgerRow {
  /** Stable across renders. */
  id: string;
  name: string;
  /** A provider named only by its numeric codes takes machine voice. */
  nameVoice?: "text" | "machine";
  /** Renders the "Your SIM" tag. */
  isSim?: boolean;
  cells: number;
  /** The count's unit word, already pluralised. */
  cellsUnit: string;
  /** `B3` / `N78`, sorted and de-duplicated. May be empty. */
  bands: string[];
  /** The strongest measured reading, or `null` when nothing was measured. */
  strength: number | null;
  /** The formatted dBm value, or `null` to render the blank mark. */
  dbmText: string | null;
}

export interface LedgerRowsProps {
  rows: LedgerRow[];
  /** A run is in flight: draw placeholders, not the rows it is replacing. */
  isLoading?: boolean;
  /** Shown instead of rows when a completed run produced none. */
  emptyText: string;
  /** The wide-only column header. `bands` may be omitted for a route with no band column. */
  head: {
    carrier: string;
    cells: string;
    bands?: string;
    best: string;
  };
  /** "Your SIM". */
  simTagLabel?: string;
  /** "dBm". */
  dbmUnit: string;
}

/** A placeholder built on the same position classes a real row uses. */
function LedgerRowSkeleton({ withDivider }: { withDivider: boolean }) {
  return (
    <div
      className={cn(LEDGER.ROW, withDivider && LEDGER.ROW_DIVIDER)}
      aria-hidden="true"
    >
      <div className={LEDGER.NAME}>
        <Skeleton className={SKELETON_SHAPE.LEDGER_ROW_NAME} />
      </div>
      <div className={LEDGER.META}>
        <Skeleton className={SKELETON_SHAPE.LEDGER_ROW_CELLS} />
        <Skeleton className={SKELETON_SHAPE.LEDGER_ROW_BANDS} />
      </div>
      <div className={LEDGER.CHIP}>
        <Skeleton className={SKELETON_SHAPE.LEDGER_ROW_CHIP} />
      </div>
      <div className={LEDGER.DBM}>
        <Skeleton className={SKELETON_SHAPE.LEDGER_ROW_DBM} />
      </div>
    </div>
  );
}

function LedgerRowView({
  row,
  withDivider,
  simTagLabel,
  dbmUnit,
}: {
  row: LedgerRow;
  withDivider: boolean;
  simTagLabel?: string;
  dbmUnit: string;
}) {
  const measured = row.strength !== null && row.dbmText !== null;

  return (
    <div className={cn(LEDGER.ROW, withDivider && LEDGER.ROW_DIVIDER)}>
      <div className={LEDGER.NAME}>
        <span
          className={
            row.nameVoice === "machine"
              ? LEDGER.NAME_TEXT_MACHINE
              : LEDGER.NAME_TEXT
          }
        >
          {row.name}
        </span>
        {row.isSim && simTagLabel ? (
          <Tag variant="neutral" className="flex-none gap-1">
            <MaterialSymbol name="sim_card" size={12} />
            {simTagLabel}
          </Tag>
        ) : null}
      </div>

      <div className={LEDGER.META}>
        <span className={LEDGER.CELLS}>
          {row.cells}
          <span className={LEDGER.CELLS_UNIT}> {row.cellsUnit}</span>
        </span>
        {row.bands.length > 0 ? (
          <div className={LEDGER.BANDS}>
            {row.bands.map((band) => (
              <Tag key={band} variant="neutral">
                {band}
              </Tag>
            ))}
          </div>
        ) : null}
      </div>

      <div className={LEDGER.CHIP}>
        <SignalBadge strength={row.strength} />
      </div>

      <div className={LEDGER.DBM}>
        {measured ? (
          <>
            <span className={LEDGER.DBM_VALUE}>{row.dbmText}</span>
            <span className={LEDGER.DBM_UNIT}>{dbmUnit}</span>
          </>
        ) : (
          <span className={LEDGER.DBM_NONE} aria-hidden="true">
            —
          </span>
        )}
      </div>
    </div>
  );
}

export function LedgerRows({
  rows,
  isLoading = false,
  emptyText,
  head,
  simTagLabel,
  dbmUnit,
}: LedgerRowsProps) {
  // A completed run with no rows has no columns to label.
  const showHead = isLoading || rows.length > 0;

  return (
    <div className={LEDGER.ROWS_ROOT} aria-live="polite">
      {showHead ? (
        <div className={LEDGER.HEAD} aria-hidden="true">
          <span>{head.carrier}</span>
          <span className="text-right">{head.cells}</span>
          <span>{head.bands ?? ""}</span>
          <span className={LEDGER.HEAD_BEST}>{head.best}</span>
        </div>
      ) : null}

      {isLoading ? (
        Array.from({ length: SKELETON_SHAPE.LEDGER_ROWS }).map((_, index) => (
          <LedgerRowSkeleton key={index} withDivider={index > 0} />
        ))
      ) : rows.length === 0 ? (
        <p className={LEDGER.EMPTY}>{emptyText}</p>
      ) : (
        rows.map((row, index) => (
          <LedgerRowView
            key={row.id}
            row={row}
            withDivider={index > 0}
            simTagLabel={simTagLabel}
            dbmUnit={dbmUnit}
          />
        ))
      )}
    </div>
  );
}

export default LedgerRows;

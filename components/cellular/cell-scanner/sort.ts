// =============================================================================
// The signal column's sort — unmeasured rows last, in BOTH directions
// =============================================================================
// Workers emit 0 for no reading; the accessor maps it to `undefined` and the column
// sets `sortUndefined: "last"`, which TanStack applies before the `desc` flip.
// =============================================================================

/** The slice of TanStack's `Row` this module needs. */
export interface SortableRow {
  getValue: (columnId: string) => unknown;
}

/** Whether a reading is a reading at all (0, null and undefined are not). */
export function isMeasuredSignal(
  strength: number | null | undefined,
): strength is number {
  return strength !== null && strength !== undefined && strength !== 0;
}

/** The signal column's sort accessor: `undefined` for an unmeasured reading. */
export function signalSortValue(
  strength: number | null | undefined,
): number | undefined {
  return isMeasuredSignal(strength) ? strength : undefined;
}

/** Always ascending: TanStack negates the result itself for a descending sort. */
export function compareMeasuredSignal(a: number, b: number): number {
  return a - b;
}

/** The signal column's `sortingFn`; reads through `getValue()`, so through `signalSortValue`. */
export function signalSortingFn(
  rowA: SortableRow,
  rowB: SortableRow,
  columnId: string,
): number {
  const a = rowA.getValue(columnId) as number | undefined;
  const b = rowB.getValue(columnId) as number | undefined;
  if (a === undefined || b === undefined) return 0;
  return compareMeasuredSignal(a, b);
}

"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { staggerRowItem, staggerRows } from "@/lib/motion";

import { PAGER, PILL_QUIET, TABLE, TOOLBAR } from "./shapes";

// =============================================================================
// ScanTable — the shell both scanning routes render their rows in
// =============================================================================
// Toolbar, filter, column menu, sorting, pagination, the count and the row
// cascade. COLUMN DEFINITIONS STAY WITH EACH ROUTE: the two tables share no
// column at all — one lists band/EARFCN/PCI/Cell ID/TAC for cells the modem is
// not camped on, the other lists frequency/RSRQ/RSSI/SINR for neighbours it can
// hear. What they share is everything around the rows.
//
// THIS IS ALSO THE MIGRATION. The parent route had grown four behaviours the
// forked neighbour copy never got, and porting them into the shell is how the
// neighbour route gains them by deletion rather than by a second authoring:
//
//   1. `columnLabels` — without it the column menu lists raw accessor ids, so
//      the neighbour route's menu offered "signalStrength" and "cellType".
//   2. Responsive auto-hide — secondary columns fold away on a narrow container
//      and can still be toggled back by hand.
//   3. The filtered-result count, which is what makes a filter that hides rows
//      distinguishable from a scan that found none.
//   4. Pagination that hides itself at one page, instead of rendering two dead
//      buttons under every short result set.
//
// The count is assembled by the CALLER through i18next's plural machinery. Both
// incumbents hardcoded `filtered === 1 ? "cell" : "cells"`, which is wrong in
// four of the five shipped locales; a `countLabel` callback keeps the key stems
// literal at the call site where the drift checker can see them.
// =============================================================================

const MotionTableRow = motion.create(TableRow);
const MotionTableBody = motion.create(TableBody);

/** Stable identity, so the default cannot invalidate the visibility effect. */
const NO_NARROW_HIDDEN: VisibilityState = {};

/**
 * The container width below which secondary columns fold away. A ResizeObserver
 * on the shell rather than a container query, because the thing being toggled is
 * table STATE, not a class — `@container` cannot unmount a column.
 */
const NARROW_BREAKPOINT = 640;

export interface ScanTableLabels {
  filterPlaceholder: string;
  /** The column menu's trigger. Text, not a glyph: `view_column` is not in the subset. */
  columns: string;
  previous: string;
  next: string;
  noMatchTitle: string;
  noMatchBody: string;
}

export interface ScanTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  /** Column id -> its translated header. Drives the column menu. */
  columnLabels: Record<string, string>;
  /** The column the filter box writes to. */
  filterColumnId: string;
  /** Columns to hide below `NARROW_BREAKPOINT`. Omit to never auto-hide. */
  narrowHidden?: VisibilityState;
  labels: ScanTableLabels;
  /** `(filtered, total) => string`, so the caller owns the plural rule. */
  countLabel: (filtered: number, total: number) => string;
}

export function ScanTable<TData>({
  data,
  columns,
  columnLabels,
  filterColumnId,
  narrowHidden = NO_NARROW_HIDDEN,
  labels,
  countLabel,
}: ScanTableProps<TData>) {
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  React.useEffect(() => {
    const el = shellRef.current;
    if (!el || Object.keys(narrowHidden).length === 0) return;

    const observer = new ResizeObserver(([entry]) => {
      const wide = entry.contentRect.width >= NARROW_BREAKPOINT;
      setColumnVisibility((prev) => {
        // Only auto-set while the user has not taken over. Once they toggle a
        // column the shell stops second-guessing them — a resize that silently
        // undid a deliberate choice would read as a bug in the menu.
        const untouched =
          Object.keys(prev).length === 0 ||
          Object.keys(prev).every((key) => key in narrowHidden);
        if (!untouched) return prev;
        return wide ? {} : narrowHidden;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [narrowHidden]);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, columnFilters, columnVisibility },
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const filterValue =
    (table.getColumn(filterColumnId)?.getFilterValue() as string) ?? "";

  return (
    <div ref={shellRef} className="flex min-w-0 flex-col gap-4">
      <div className={TOOLBAR.ROOT}>
        <Input
          value={filterValue}
          placeholder={labels.filterPlaceholder}
          aria-label={labels.filterPlaceholder}
          onChange={(event) =>
            table.getColumn(filterColumnId)?.setFilterValue(event.target.value)
          }
          className={TOOLBAR.FILTER}
        />

        <div className={TOOLBAR.ACTIONS}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="tonal-neutral" className={PILL_QUIET}>
                {labels.columns}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {columnLabels[column.id] ?? column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className={TABLE.SHELL}>
        <Table className={TABLE.ROOT}>
          <TableHeader className={TABLE.HEAD}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          {/* This cascade root DOES declare initial/animate, unlike a nested
              container inside the page cascade. It mounts on a swap — the rows
              arrive when a run completes, long after the page's own clock has
              settled — and a variants-only child that mounts on a swap stays
              pinned at `hidden` forever. */}
          <MotionTableBody
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {rows.length ? (
              rows.map((row) => (
                <MotionTableRow
                  key={row.id}
                  variants={staggerRowItem}
                  className={TABLE.ROW}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </MotionTableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllLeafColumns().length}
                  className="h-24 text-center"
                >
                  <span className="text-sm font-semibold">
                    {labels.noMatchTitle}
                  </span>
                  <span className="text-on-surface-variant block text-xs">
                    {labels.noMatchBody}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </MotionTableBody>
        </Table>
      </div>

      <div className={PAGER.ROOT}>
        <span className={TOOLBAR.COUNT} aria-live="polite">
          {countLabel(filteredCount, data.length)}
        </span>

        {table.getPageCount() > 1 ? (
          <div className={PAGER.ACTIONS}>
            <Button
              type="button"
              variant="tonal-neutral"
              className={PILL_QUIET}
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <MaterialSymbol
                name="chevron_right"
                size={16}
                className={PAGER.BACK_GLYPH}
              />
              {labels.previous}
            </Button>
            <Button
              type="button"
              variant="tonal-neutral"
              className={PILL_QUIET}
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {labels.next}
              <MaterialSymbol name="chevron_right" size={16} />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ScanTable;

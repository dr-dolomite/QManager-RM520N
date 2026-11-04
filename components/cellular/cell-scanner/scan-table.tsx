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
import { cn } from "@/lib/utils";

import { PAGER, PILL_QUIET, TABLE, TOOLBAR } from "./shapes";

// =============================================================================
// ScanTable — the shell both scanning routes render their rows in
// =============================================================================
// Toolbar, filter, column menu, sorting, pagination and row cascade; each route
// owns its column definitions and passes the count text as `countLabel`.
// =============================================================================

const MotionTableRow = motion.create(TableRow);
const MotionTableBody = motion.create(TableBody);

/** Stable identity, so the default cannot invalidate the visibility effect. */
const NO_NARROW_HIDDEN: VisibilityState = {};

/** No initial sort unless the caller asks for one. */
const NO_INITIAL_SORTING: SortingState = [];

/**
 * The container width below which secondary columns fold away. A ResizeObserver
 * on the shell rather than a container query, because the thing being toggled is
 * table STATE, not a class — `@container` cannot unmount a column.
 */
const NARROW_BREAKPOINT = 640;

export interface ScanTableLabels {
  filterPlaceholder: string;
  /** The column menu's accessible name — the trigger itself is the `tune` glyph
   *  (`view_column` is not in the subset). */
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
  /** `(filtered, total) => string`, so the caller owns the plural rule. Shown only when the set pages. */
  countLabel?: (filtered: number, total: number) => string;
  /** The strip under the table: what a row can do, and what the rows add up to. */
  footer?: React.ReactNode;
  /** The table's initial sort; the reader can still change or clear it. */
  initialSorting?: SortingState;
  /** Extra controls in the toolbar's actions group, before the column menu. */
  toolbarActions?: React.ReactNode;
}

export function ScanTable<TData>({
  data,
  columns,
  columnLabels,
  filterColumnId,
  narrowHidden = NO_NARROW_HIDDEN,
  labels,
  countLabel,
  footer,
  initialSorting = NO_INITIAL_SORTING,
  toolbarActions,
}: ScanTableProps<TData>) {
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
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
        // Only auto-set until the reader toggles a column themselves.
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

  // TanStack's table API cannot be memoised by the React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
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
          {toolbarActions}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="tonal-neutral"
                size="icon"
                aria-label={labels.columns}
                title={labels.columns}
              >
                <MaterialSymbol name="tune" size={18} />
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
                {headerGroup.headers.map((header, index) => (
                  <TableHead
                    key={header.id}
                    // The first column takes the row's own inset.
                    className={index === 0 ? "ps-4" : undefined}
                  >
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

          {/* Declares initial/animate: it mounts on a swap, and a variants-only
              child that mounts late stays pinned at hidden. */}
          <MotionTableBody
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {rows.length ? (
              rows.map((row, index) => (
                <MotionTableRow
                  key={row.id}
                  variants={staggerRowItem}
                  className={cn(
                    TABLE.ROW,
                    // Striped from the rendered index, so banding survives a sort.
                    index % 2 === 1 && TABLE.ROW_STRIPE,
                    TABLE.ROW_HOVER,
                  )}
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      className={index === 0 ? "ps-4" : undefined}
                    >
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

      {footer}

      {/* Only when the set pages: on one page the count restates the tally. */}
      {table.getPageCount() > 1 ? (
        <div className={PAGER.ROOT}>
          {countLabel ? (
            <span className={TOOLBAR.COUNT} aria-live="polite">
              {countLabel(filteredCount, data.length)}
            </span>
          ) : null}

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
        </div>
      ) : null}
    </div>
  );
}

export default ScanTable;

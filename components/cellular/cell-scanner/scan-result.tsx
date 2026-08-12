"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CellScanResult } from "@/types/cell-scanner";

import ScanTable from "./scan-table";
import ScanTableNote from "./table-note";
import { NetworkTypeBadge, SignalBadge } from "./signal-badges";
import { TABLE } from "./shapes";
import { summariseSweep } from "./summaries";

// =============================================================================
// The full scan's columns
// =============================================================================
// Definitions only. The toolbar, filter, column menu, sorting, pagination, count
// and row cascade all live in `scan-table.tsx`, which the neighbour route reads
// too — this file's job is to say what a scanned cell's columns ARE.
//
// THE MACHINE-VOICE SPLIT IS PER COLUMN, not per table. Band, EARFCN, PCI, Cell
// ID and TAC are identifiers that hold steady until something reconfigures them,
// so they take `TABLE.IDENT` (mono). Signal is a READING that moves on its own,
// so it takes `TABLE.FIGURE` — the interface font with tabular figures. The
// incumbent set every cell to `font-semibold` and neither.
// =============================================================================

/** Columns folded away below the narrow breakpoint. Identifiers first: they are
 *  the ones a reader can recover from the CSV export. */
export const CELL_SCAN_NARROW_HIDDEN: VisibilityState = {
  cellID: false,
  tac: false,
  bandwidth: false,
  earfcn: false,
};

/**
 * A type alias, not an interface, and that is load-bearing: TypeScript gives an
 * anonymous object type an implicit index signature but never gives an
 * `interface` one, so an interface here would not be assignable to the shell's
 * `Record<string, string>` column-label map and the two would have to be
 * maintained separately — which is precisely the drift this replaces.
 */
export type CellScanColumnCopy = {
  network: string;
  provider: string;
  band: string;
  earfcn: string;
  pci: string;
  cellID: string;
  tac: string;
  bandwidth: string;
  signalStrength: string;
};

export function createCellScanColumns(
  copy: CellScanColumnCopy,
  labels: { networkCodes: string; rowMenu: string; lockCell: string },
  format: { bandwidth: (value: number) => string; signal: (value: number) => string },
  onLockCell?: (cell: CellScanResult) => void,
): ColumnDef<CellScanResult>[] {
  return [
    {
      accessorKey: "networkType",
      header: () => <span>{copy.network}</span>,
      cell: ({ row }) => (
        <NetworkTypeBadge type={row.original.networkType} />
      ),
    },
    {
      accessorKey: "provider",
      header: ({ column }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {copy.provider}
          <MaterialSymbol name="unfold_more" size={16} />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <span className="font-semibold">{row.original.provider}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="-m-2 inline-flex p-2"
                aria-label={labels.networkCodes}
              >
                <MaterialSymbol name="info" size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className={TABLE.IDENT}>
                {row.original.mcc} {row.original.mnc}
              </span>
            </TooltipContent>
          </Tooltip>
        </span>
      ),
    },
    {
      accessorKey: "band",
      header: () => <span>{copy.band}</span>,
      cell: ({ row }) => (
        <span className={TABLE.IDENT}>
          {/* `N` for a 5G band, `B` for an LTE one — the carrier's own notation,
              and the only thing that tells B3 from n3. */}
          {row.original.networkType.toUpperCase().startsWith("NR") ? "N" : "B"}
          {row.original.band}
        </span>
      ),
    },
    {
      accessorKey: "earfcn",
      header: () => <span>{copy.earfcn}</span>,
      cell: ({ row }) => (
        <span className={TABLE.IDENT}>{row.original.earfcn}</span>
      ),
    },
    {
      accessorKey: "pci",
      header: () => <span>{copy.pci}</span>,
      cell: ({ row }) => <span className={TABLE.IDENT}>{row.original.pci}</span>,
    },
    {
      accessorKey: "cellID",
      header: () => <span>{copy.cellID}</span>,
      cell: ({ row }) => (
        <span className={TABLE.IDENT}>{row.original.cellID}</span>
      ),
    },
    {
      accessorKey: "tac",
      header: () => <span>{copy.tac}</span>,
      cell: ({ row }) => <span className={TABLE.IDENT}>{row.original.tac}</span>,
    },
    {
      accessorKey: "bandwidth",
      header: () => <span>{copy.bandwidth}</span>,
      cell: ({ row }) => (
        <span className={TABLE.FIGURE}>
          {format.bandwidth(row.original.bandwidth)}
        </span>
      ),
    },
    {
      accessorKey: "signalStrength",
      header: ({ column }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {copy.signalStrength}
          <MaterialSymbol name="unfold_more" size={16} />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <SignalBadge strength={row.original.signalStrength} />
          {/* The worker's 0 is "unreported", not 0 dBm — `signalTier` already
              maps it to the muted "No data" chip, but the value beside the chip
              was printed unconditionally, so an unmeasured cell read "No data
              0 dBm": a sentinel rendered as a confident measurement, directly
              contradicting the chip next to it. The neighbour table has always
              suppressed it here; this column now agrees. */}
          {row.original.signalStrength !== 0 ? (
            <span className={TABLE.FIGURE}>
              {format.signal(row.original.signalStrength)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => null,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-on-surface-variant data-[state=open]:bg-surface-container-high rounded-pill"
              aria-label={labels.rowMenu}
            >
              <MaterialSymbol name="more_vert" size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onLockCell?.(row.original)}>
              <MaterialSymbol name="lock" size={16} />
              {labels.lockCell}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

export interface ScanResultViewProps {
  data: CellScanResult[];
  onLockCell?: (cell: CellScanResult) => void;
}

/** The full scan's table: this route's columns poured into the shared shell. */
export function ScanResultView({ data, onLockCell }: ScanResultViewProps) {
  const { t } = useTranslation("cellular");

  const columnCopy: CellScanColumnCopy = React.useMemo(
    () => ({
      network: t("cell_scanner.columns.network"),
      provider: t("cell_scanner.columns.provider"),
      band: t("cell_scanner.columns.band"),
      earfcn: t("cell_scanner.columns.earfcn"),
      pci: t("cell_scanner.columns.pci"),
      cellID: t("cell_scanner.columns.cell_id"),
      tac: t("cell_scanner.columns.tac"),
      bandwidth: t("cell_scanner.columns.bandwidth"),
      signalStrength: t("cell_scanner.columns.signal"),
    }),
    [t],
  );

  const columns = React.useMemo(
    () =>
      createCellScanColumns(
        columnCopy,
        {
          networkCodes: t("cell_scanner.a11y.network_codes"),
          rowMenu: t("cell_scanner.a11y.row_menu"),
          lockCell: t("cell_scanner.actions.lock_cell"),
        },
        {
          bandwidth: (value) => t("cell_scanner.cells.bandwidth", { value }),
          signal: (value) => t("cell_scanner.cells.signal", { value }),
        },
        onLockCell,
      ),
    [columnCopy, onLockCell, t],
  );

  // The tier tally under the table. Derived from the WHOLE result set rather
  // than the filtered page: it describes what the sweep found, and the pager's
  // own count directly beneath it already describes what the filter left.
  const tally = React.useMemo(() => {
    const summary = summariseSweep(data);
    const items = [
      t("cell_scanner.results.tally_rows", { count: summary.total }),
    ];
    // Only tiers that actually occurred. A row of zeroes is noise, and "0 good"
    // beside "8 weak" reads as a scoreboard rather than a description.
    if (summary.tiers.good > 0)
      items.push(t("cell_scanner.results.tally_good", { count: summary.tiers.good }));
    if (summary.tiers.fair > 0)
      items.push(t("cell_scanner.results.tally_fair", { count: summary.tiers.fair }));
    if (summary.tiers.poor > 0)
      items.push(t("cell_scanner.results.tally_poor", { count: summary.tiers.poor }));
    if (summary.tiers.none > 0)
      items.push(t("cell_scanner.results.tally_none", { count: summary.tiers.none }));
    return items;
  }, [data, t]);

  return (
    <ScanTable
      data={data}
      columns={columns}
      footer={
        <ScanTableNote
          glyph="lock"
          text={t("cell_scanner.results.note_lock")}
          tally={tally}
        />
      }
      // The menu's labels ARE the headers, so they cannot drift apart: the
      // incumbent maintained a second hand-written map and the neighbour fork
      // had none at all, which is why its menu offered "signalStrength".
      columnLabels={columnCopy}
      filterColumnId="provider"
      narrowHidden={CELL_SCAN_NARROW_HIDDEN}
      labels={{
        filterPlaceholder: t("cell_scanner.results.filter_placeholder"),
        columns: t("cell_scanner.results.columns"),
        previous: t("cell_scanner.results.previous"),
        next: t("cell_scanner.results.next"),
        noMatchTitle: t("cell_scanner.results.no_match_title"),
        noMatchBody: t("cell_scanner.results.no_match_body"),
      }}
      countLabel={(filtered, total) =>
        filtered < total
          ? t("cell_scanner.results.filtered", { count: filtered, total })
          : t("cell_scanner.results.count", { count: total })
      }
    />
  );
}

export default ScanResultView;

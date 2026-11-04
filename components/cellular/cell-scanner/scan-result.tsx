"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { prbToBandwidthMhz } from "@/lib/earfcn";
import { HintIcon } from "@/components/ui/hint-icon";
import type { CellScanResult } from "@/types/cell-scanner";

import ScanTable from "./scan-table";
import ScanTableNote from "./table-note";
import { NetworkTypeBadge, SignalBadge } from "./signal-badges";
import { signalSortingFn, signalSortValue } from "./sort";
import { TABLE } from "./shapes";
import { summariseSweep } from "./summaries";

// =============================================================================
// The full scan's columns
// =============================================================================
// Definitions only; the shell is `scan-table.tsx`. Opens sorted by signal,
// strongest first, with unmeasured rows last in both directions (`sort.ts`).
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
  labels: {
    networkCodes: string;
    rowMenu: string;
    lockCell: string;
    lockOtherNetwork: string;
  },
  format: { bandwidth: (cell: CellScanResult) => string; signal: (value: number) => string },
  onLockCell?: (cell: CellScanResult) => void,
  /** Rows answering `false` keep the item, disabled: the SIM cannot register there. */
  canLockCell: (cell: CellScanResult) => boolean = () => true,
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
          <HintIcon label={labels.networkCodes}>
            <span className={TABLE.IDENT}>
              MCC {row.original.mcc} / MNC {row.original.mnc}
            </span>
          </HintIcon>
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
          {format.bandwidth(row.original)}
        </span>
      ),
    },
    {
      // The accessor feeds sorting only; the cell reads `row.original`.
      id: "signalStrength",
      accessorFn: (row) => signalSortValue(row.signalStrength),
      sortingFn: signalSortingFn,
      sortUndefined: "last",
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
          {/* 0 is "unreported": the chip says No data and no value is printed. */}
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
      cell: ({ row }) => {
        const lockable = canLockCell(row.original);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-on-surface-variant data-[state=open]:bg-surface-container-high"
                aria-label={labels.rowMenu}
              >
                <MaterialSymbol name="more_vert" size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={!lockable}
                onClick={() => onLockCell?.(row.original)}
                className="items-start"
              >
                <MaterialSymbol name="lock" size={16} className="mt-0.5" />
                <span className="flex flex-col">
                  {labels.lockCell}
                  {lockable ? null : (
                    <span className="text-xs text-on-surface-variant">
                      {labels.lockOtherNetwork}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

/** Strongest signal first; a module constant so its identity is stable. */
const DEFAULT_SORTING: SortingState = [{ id: "signalStrength", desc: true }];

export interface ScanResultViewProps {
  data: CellScanResult[];
  onLockCell?: (cell: CellScanResult) => void;
  /** See `createCellScanColumns`'s `canLockCell`. */
  canLockCell?: (cell: CellScanResult) => boolean;
  /** Rendered in the table toolbar, before the column menu (Download CSV). */
  toolbarActions?: React.ReactNode;
}

/** The full scan's table: this route's columns poured into the shared shell. */
export function ScanResultView({
  data,
  onLockCell,
  canLockCell,
  toolbarActions,
}: ScanResultViewProps) {
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
          lockOtherNetwork: t("cell_scanner.actions.lock_other_network"),
        },
        {
          // NR rows carry a PRB count, not MHz; convert with the row's own SCS
          // and show the raw count when SCS is missing or the count is off-table.
          bandwidth: (cell) => {
            if (!cell.bandwidth || cell.bandwidth <= 0) return "—";
            if (cell.networkType.toUpperCase().startsWith("NR")) {
              const mhz = prbToBandwidthMhz(cell.bandwidth, cell.scs);
              return mhz !== null
                ? t("cell_scanner.cells.bandwidth", { value: mhz })
                : t("cell_scanner.cells.bandwidth_prb", { value: cell.bandwidth });
            }
            return t("cell_scanner.cells.bandwidth", { value: cell.bandwidth });
          },
          signal: (value) => t("cell_scanner.cells.signal", { value }),
        },
        onLockCell,
        canLockCell,
      ),
    [columnCopy, onLockCell, canLockCell, t],
  );

  // The tier tally covers the whole sweep, not the filtered page.
  const tally = React.useMemo(() => {
    const summary = summariseSweep(data);
    const items = [
      t("cell_scanner.results.tally_rows", { count: summary.total }),
    ];
    // Only tiers that occurred.
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
      // The menu's labels are the headers, so they cannot drift apart.
      columnLabels={columnCopy}
      filterColumnId="provider"
      narrowHidden={CELL_SCAN_NARROW_HIDDEN}
      initialSorting={DEFAULT_SORTING}
      toolbarActions={toolbarActions}
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

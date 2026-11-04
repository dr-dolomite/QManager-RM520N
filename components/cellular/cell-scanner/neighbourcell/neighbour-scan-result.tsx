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
import type {
  NeighbourCellResult,
  NeighbourCellType,
} from "@/types/cell-scanner";

import ScanTable from "../scan-table";
import ScanTableNote from "../table-note";
import { NetworkTypeBadge, SignalBadge } from "../signal-badges";
import { signalSortingFn, signalSortValue } from "../sort";
import { TABLE } from "../shapes";
import { summariseNeighbours } from "../summaries";

// =============================================================================
// The neighbour read's columns
// =============================================================================
// Definitions only; the shell is `scan-table.tsx`. Opens sorted by signal,
// strongest first, unmeasured rows last (`sort.ts`). Only LTE rows lock.
// =============================================================================

/**
 * The measurements fold away first. They are the columns a reader can recover
 * from the CSV export, and the identity columns are what makes a row findable.
 */
export const NEIGHBOUR_NARROW_HIDDEN: VisibilityState = {
  rsrq: false,
  rssi: false,
  sinr: false,
  cellType: false,
};

/** `intra` / `inter` / `nr5g` -> its copy key, spelled out as LITERALS so
 *  `i18n:check` can see every one of them. An interpolated stem is invisible to
 *  it, and a key it cannot see is a key nothing will ever report as missing.
 *  Exported: `neighbour-scanner.tsx`'s summary tiles key off the same map. */
export const CELL_TYPE_KEY: Record<NeighbourCellType, string> = {
  intra: "cell_scanner.neighbour.cell_type.intra",
  inter: "cell_scanner.neighbour.cell_type.inter",
  nr5g: "cell_scanner.neighbour.cell_type.nr5g",
};

/** See the note on `CellScanColumnCopy` — a type alias, not an interface, so it
 *  satisfies the shell's `Record<string, string>` column-label map. */
export type NeighbourColumnCopy = {
  networkType: string;
  cellType: string;
  frequency: string;
  pci: string;
  signalStrength: string;
  rsrq: string;
  rssi: string;
  sinr: string;
};

/** An unreported value. The workers emit 0 for channel/PCI/RSRP and null for the
 *  rest, so both funnel to one mark rather than rendering a real-looking `0`. */
function Unreported({ label }: { label: string }) {
  return (
    <span className="text-on-surface-variant" aria-label={label}>
      &mdash;
    </span>
  );
}

export function createNeighbourColumns(
  copy: NeighbourColumnCopy,
  labels: {
    rowMenu: string;
    lockCell: string;
    lockUnavailable: string;
    unreported: string;
    cellType: (value: NeighbourCellType) => string;
  },
  format: { signal: (value: number) => string; decibel: (value: number) => string },
  onLockCell?: (cell: NeighbourCellResult) => void,
): ColumnDef<NeighbourCellResult>[] {
  return [
    {
      accessorKey: "networkType",
      header: () => <span>{copy.networkType}</span>,
      cell: ({ row }) => <NetworkTypeBadge type={row.original.networkType} />,
    },
    {
      accessorKey: "cellType",
      header: () => <span>{copy.cellType}</span>,
      cell: ({ row }) => <span>{labels.cellType(row.original.cellType)}</span>,
    },
    {
      accessorKey: "frequency",
      header: ({ column }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {copy.frequency}
          <MaterialSymbol name="unfold_more" size={16} />
        </Button>
      ),
      cell: ({ row }) =>
        row.original.frequency === 0 ? (
          <Unreported label={labels.unreported} />
        ) : (
          <span className={TABLE.IDENT}>{row.original.frequency}</span>
        ),
    },
    {
      accessorKey: "pci",
      header: () => <span>{copy.pci}</span>,
      cell: ({ row }) =>
        row.original.pci === 0 ? (
          <Unreported label={labels.unreported} />
        ) : (
          <span className={TABLE.IDENT}>{row.original.pci}</span>
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
          {/* 0 is "unreported": the chip says No data and no value is printed. */}
          <SignalBadge strength={row.original.signalStrength} />
          {row.original.signalStrength !== 0 ? (
            <span className={TABLE.FIGURE}>
              {format.signal(row.original.signalStrength)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: "rsrq",
      header: () => <span>{copy.rsrq}</span>,
      cell: ({ row }) =>
        row.original.rsrq === null ? (
          <Unreported label={labels.unreported} />
        ) : (
          <span className={TABLE.FIGURE}>
            {format.decibel(row.original.rsrq)}
          </span>
        ),
    },
    {
      accessorKey: "rssi",
      header: () => <span>{copy.rssi}</span>,
      // RSSI is dBm, where RSRQ and SINR are dB — so this one takes the signal
      // formatter, not the decibel one. Also: NR5G rows never carry RSSI, the
      // worker leaves the field empty by design, so a null here is an absence
      // rather than a fault.
      cell: ({ row }) =>
        row.original.rssi === null ? (
          <Unreported label={labels.unreported} />
        ) : (
          <span className={TABLE.FIGURE}>
            {format.signal(row.original.rssi)}
          </span>
        ),
    },
    {
      accessorKey: "sinr",
      header: () => <span>{copy.sinr}</span>,
      cell: ({ row }) =>
        row.original.sinr === null ? (
          <Unreported label={labels.unreported} />
        ) : (
          <span className={TABLE.FIGURE}>
            {format.decibel(row.original.sinr)}
          </span>
        ),
    },
    {
      id: "actions",
      header: () => null,
      enableHiding: false,
      cell: ({ row }) => {
        // Only LTE neighbours are lockable: `tower/lock.sh`'s NR branch needs a
        // band and an SCS, and a neighbour report carries neither.
        const lockable =
          row.original.networkType.toUpperCase().startsWith("LTE") &&
          row.original.pci !== 0 &&
          row.original.frequency !== 0;

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
              {/* The incumbent SUPPRESSED this row entirely for non-LTE cells.
                  A control that cannot work explains itself rather than
                  vanishing — an absent affordance leaves the reader to infer
                  the rule, which is the one thing the product's honesty
                  principle rules out. */}
              <DropdownMenuItem
                disabled={!lockable}
                onClick={() => onLockCell?.(row.original)}
              >
                <MaterialSymbol name="lock" size={16} />
                {lockable ? labels.lockCell : labels.lockUnavailable}
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

export interface NeighbourScanResultViewProps {
  data: NeighbourCellResult[];
  onLockCell?: (cell: NeighbourCellResult) => void;
  /** Rendered in the table toolbar, before the column menu (Download CSV). */
  toolbarActions?: React.ReactNode;
}

export function NeighbourScanResultView({
  data,
  onLockCell,
  toolbarActions,
}: NeighbourScanResultViewProps) {
  const { t } = useTranslation("cellular");

  const columnCopy: NeighbourColumnCopy = React.useMemo(
    () => ({
      networkType: t("cell_scanner.columns.network"),
      cellType: t("cell_scanner.neighbour.columns.cell_type"),
      frequency: t("cell_scanner.neighbour.columns.frequency"),
      pci: t("cell_scanner.columns.pci"),
      signalStrength: t("cell_scanner.columns.signal"),
      rsrq: t("cell_scanner.neighbour.columns.rsrq"),
      rssi: t("cell_scanner.neighbour.columns.rssi"),
      sinr: t("cell_scanner.neighbour.columns.sinr"),
    }),
    [t],
  );

  const columns = React.useMemo(
    () =>
      createNeighbourColumns(
        columnCopy,
        {
          rowMenu: t("cell_scanner.a11y.row_menu"),
          lockCell: t("cell_scanner.actions.lock_cell"),
          lockUnavailable: t("cell_scanner.neighbour.actions.lock_lte_only"),
          unreported: t("cell_scanner.neighbour.cells.unreported"),
          cellType: (value) => t(CELL_TYPE_KEY[value]),
        },
        {
          signal: (value) => t("cell_scanner.cells.signal", { value }),
          decibel: (value) => t("cell_scanner.neighbour.cells.decibel", { value }),
        },
        onLockCell,
      ),
    [columnCopy, onLockCell, t],
  );

  // Measured versus channel-only, over the whole read rather than the filtered view.
  const tally = React.useMemo(() => {
    const summary = summariseNeighbours(data);
    return [
      t("cell_scanner.results.tally_rows", { count: summary.total }),
      t("cell_scanner.neighbour.results.tally_measured", {
        count: summary.measured,
      }),
      t("cell_scanner.neighbour.results.tally_channel_only", {
        count: summary.channelOnly,
      }),
    ];
  }, [data, t]);

  return (
    <ScanTable
      data={data}
      columns={columns}
      footer={
        <ScanTableNote
          glyph="lock"
          text={t("cell_scanner.neighbour.results.note_channel_only")}
          tally={tally}
        />
      }
      columnLabels={columnCopy}
      // Bound to the channel: the relation's three words are not something to type.
      filterColumnId="frequency"
      narrowHidden={NEIGHBOUR_NARROW_HIDDEN}
      initialSorting={DEFAULT_SORTING}
      toolbarActions={toolbarActions}
      labels={{
        filterPlaceholder: t(
          "cell_scanner.neighbour.results.filter_placeholder",
        ),
        columns: t("cell_scanner.results.columns"),
        previous: t("cell_scanner.results.previous"),
        next: t("cell_scanner.results.next"),
        noMatchTitle: t("cell_scanner.results.no_match_title"),
        noMatchBody: t("cell_scanner.results.no_match_body"),
      }}
      // No `countLabel`: the footer tally already counts the read.
    />
  );
}

export default NeighbourScanResultView;

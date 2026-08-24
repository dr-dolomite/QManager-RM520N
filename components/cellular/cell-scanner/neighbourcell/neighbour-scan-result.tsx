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
import type {
  NeighbourCellResult,
  NeighbourCellType,
} from "@/types/cell-scanner";

import ScanTable from "../scan-table";
import ScanTableNote from "../table-note";
import { NetworkTypeBadge, SignalBadge } from "../signal-badges";
import { TABLE } from "../shapes";
import { summariseNeighbours } from "../summaries";

// =============================================================================
// The neighbour read's columns
// =============================================================================
// Definitions only; the shell is `scan-table.tsx`. Three defects the incumbent
// fork carried are fixed here rather than inherited:
//
//   1. RSRQ, RSSI and SINR were FETCHED and written to the CSV export, but no
//      column displayed them. They were downloadable and invisible — the one
//      thing a neighbour read is actually for, available only by opening a
//      spreadsheet. They are columns now, folded away on narrow widths.
//   2. The text filter was bound to `cellType`, whose entire domain is three
//      values the user cannot type. It is bound to the channel now.
//   3. `cellType` rendered raw as `intra` / `inter` / `nr5g`.
//
// THE MACHINE-VOICE SPLIT IS PER COLUMN. Channel and PCI are identifiers that
// hold steady until something reconfigures them, so they take `TABLE.IDENT`
// (mono). RSRP, RSRQ, RSSI and SINR are READINGS, so they take `TABLE.FIGURE` —
// the interface font with tabular figures.
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
          {/* `signalTier` maps 0 to the `none` tier, so an unmeasured port shows
              a muted "No data" chip rather than the destructive "Bad" the
              incumbent rendered — a verdict where there was no reading. */}
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
                className="text-on-surface-variant data-[state=open]:bg-surface-container-high rounded-pill"
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

export interface NeighbourScanResultViewProps {
  data: NeighbourCellResult[];
  onLockCell?: (cell: NeighbourCellResult) => void;
}

export function NeighbourScanResultView({
  data,
  onLockCell,
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

  // Measured versus channel-only, over the WHOLE read — not over what the
  // channel filter left. This is the only count on the surface now (the pager's
  // "N cells" was removed on 2026-08-14), so it counts the read, not the view.
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
      // Bound to the channel, not `cellType`. The incumbent filtered on a column
      // whose whole domain is three words the reader cannot guess; the channel is
      // how the rest of the product (band locking, frequency locking) reasons
      // about a cell.
      filterColumnId="frequency"
      narrowHidden={NEIGHBOUR_NARROW_HIDDEN}
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
      // NO `countLabel`, deliberately (2026-08-14). The footer note directly
      // above already tallies this read three ways, and a fourth line reading
      // "10 cells" under it was the same count in a different noun. The sweep
      // route keeps its count — see `ScanTableProps.countLabel`.
    />
  );
}

export default NeighbourScanResultView;

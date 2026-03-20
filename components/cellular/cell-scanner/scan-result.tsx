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
  type Row,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  Info,
  LockIcon,
  MoreVertical,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);
import { Badge } from "@/components/ui/badge";
import { SignalBadge, NetworkTypeBadge } from "./signal-badges";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CellScanResult {
  id: string;
  networkType: string;
  earfcn: number;
  pci: number;
  band: number;
  bandwidth: number;
  cellID: number;
  tac: number;
  signalStrength: number;
  mcc: number;
  mnc: number;
  provider: string;
  scs?: number | null;
}

interface ScanResultViewProps {
  data: CellScanResult[];
  onLockCell?: (cell: CellScanResult) => void;
}


const createColumns = (
  onLockCell?: (cell: CellScanResult) => void,
): ColumnDef<CellScanResult>[] => [
  {
    accessorKey: "networkType",
    header: () => <div>Network</div>,
    cell: ({ row }) => (
      <div><NetworkTypeBadge type={row.getValue("networkType")} /></div>
    ),
  },
  {
    accessorKey: "provider",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Provider
        <ArrowUpDown className="size-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const cell = row.original;
      return (
        <div className="flex items-center gap-1">
          <span className="font-semibold">{cell.provider}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="inline-flex p-2 -m-2" aria-label="MCC/MNC details">
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {cell.mcc} {cell.mnc}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    },
  },
  {
    accessorKey: "band",
    header: "Band",
    cell: ({ row }) => {
      const networkType = row.original.networkType;
      const band = row.getValue("band") as number;
      const prefix = networkType === "NR5G-SA" ? "N" : "B";
      return (
        <div className="font-semibold">
          {prefix}
          {band}
        </div>
      );
    },
  },
  {
    accessorKey: "earfcn",
    header: "EARFCN",
    cell: ({ row }) => (
      <div className="font-semibold">{row.getValue("earfcn")}</div>
    ),
  },
  {
    accessorKey: "pci",
    header: "PCI",
    cell: ({ row }) => (
      <div className="font-semibold">{row.getValue("pci")}</div>
    ),
  },
  {
    accessorKey: "cellID",
    header: "Cell ID",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("cellID")}</div>
    ),
  },
  {
    accessorKey: "tac",
    header: "TAC",
    cell: ({ row }) => <div className="font-medium">{row.getValue("tac")}</div>,
  },
  {
    accessorKey: "bandwidth",
    header: "BW",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("bandwidth")} MHz</div>
    ),
  },
  {
    accessorKey: "signalStrength",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Signal
        <ArrowUpDown className="size-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const strength = row.getValue("signalStrength") as number;
      return (
        <div className="flex items-center gap-2">
          <SignalBadge strength={strength} />
          <span className="font-semibold">{strength} dBm</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: () => null,
    enableHiding: false,
    cell: ({ row }: { row: Row<CellScanResult> }) => {
      const cellData = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
              size="icon"
            >
              <MoreVertical className="size-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onLockCell?.(cellData)}>
              <LockIcon className="size-4" />
              Lock Cell
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// Columns hidden on narrow containers (<640px) — users can toggle them back
const NARROW_HIDDEN: VisibilityState = {
  cellID: false,
  tac: false,
  bandwidth: false,
  earfcn: false,
};
const NARROW_BREAKPOINT = 640;

const COLUMN_LABELS: Record<string, string> = {
  networkType: "Network",
  provider: "Provider",
  band: "Band",
  earfcn: "EARFCN",
  pci: "PCI",
  cellID: "Cell ID",
  tac: "TAC",
  bandwidth: "Bandwidth",
  signalStrength: "Signal",
};

const ScanResultView = ({ data, onLockCell }: ScanResultViewProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const columns = React.useMemo(() => createColumns(onLockCell), [onLockCell]);

  // Auto-hide secondary columns on narrow containers
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const wide = entry.contentRect.width >= NARROW_BREAKPOINT;
      setColumnVisibility((prev) => {
        // Only auto-set if user hasn't manually toggled (all keys default)
        const isDefault = Object.keys(prev).length === 0 ||
          Object.keys(prev).every((k) => k in NARROW_HIDDEN);
        if (!isDefault) return prev;
        return wide ? {} : NARROW_HIDDEN;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
  });

  return (
    <div ref={containerRef} className="relative flex flex-col gap-4 overflow-hidden">
      <div className="flex flex-col @sm/card:flex-row items-start @sm/card:items-center gap-2">
        <Input
          placeholder="Filter by provider..."
          value={
            (table.getColumn("provider")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("provider")?.setFilterValue(event.target.value)
          }
          className="w-full @sm/card:max-w-sm"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="@sm/card:ml-auto">
              Columns <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {COLUMN_LABELS[column.id] ?? column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[480px]">
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <MotionTableRow
                  key={row.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.4), ease: "easeOut" }}
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
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-muted-foreground flex-1 text-sm">
          {(() => {
            const filtered = table.getFilteredRowModel().rows.length;
            const total = data.length;
            const label = filtered === 1 ? "cell" : "cells";
            return filtered < total
              ? `${filtered} of ${total} ${label}`
              : `${total} ${label} found`;
          })()}
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ScanResultView;

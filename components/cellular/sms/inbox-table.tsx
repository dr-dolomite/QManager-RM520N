"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  flexRender,
  type ColumnDef,
  type Table as TanstackTable,
} from "@tanstack/react-table";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { staggerRows, staggerRowItem } from "@/lib/motion";
import type { SmsMessage } from "@/types/sms";
import type { SmsTab } from "./inbox-toolbar";

const MotionTableRow = motion.create(TableRow);
const MotionTableBody = motion.create(TableBody);

// =============================================================================
// InboxTable — column defs, row rendering and the pagination footer
// =============================================================================
// DESIGN.md > Metric rows names the SMS inbox explicitly as one of the *genuine
// data tables* that keep hairline rows on `--outline` rather than becoming
// metric-row pills: density survives here where pills would not. So this stays
// a real <table>, restyled onto the tonal surfaces, and does NOT become a stack
// of rounded rows.
//
// The mock draws a fixed `grid-template-columns:46px 250px 1fr 176px 48px` at a
// hardcoded 1320px. That is replaced by container queries against the card's own
// `@container/card`, per the Container-Query Rule — this page is read on a
// tablet in the field as often as on a desk monitor.
//
// The mock also draws the header and row checkboxes as raw `check_box` /
// `check_box_outline_blank` font glyphs. Drawing a checkbox as a glyph throws
// away Radix's keyboard handling, its indeterminate state and its ARIA wiring,
// so the shadcn `Checkbox` stays.
// =============================================================================

/**
 * Table geometry, exported so `states.tsx` can mirror it exactly instead of
 * restating numbers (DESIGN.md > The Skeleton-Mirror Rule). The incumbent
 * loading state hardcoded `h-8 w-9`, `size-4` and `h-4 w-28`, none of which
 * matched anything in the loaded view.
 */
export const TABLE_SHAPE = {
  /** The table's own container: one tonal step down from the hero card. */
  SHELL: "overflow-hidden rounded-tile bg-surface-container",
  /** Header strip, one further step up so it reads as a rule, not a row. */
  HEAD: "bg-surface-container-high",
  /** Header cell. 12px/500 label step. */
  HEAD_CELL:
    "h-10 px-3 text-xs font-medium text-on-surface-variant whitespace-nowrap",
  /**
   * The hairline. `--outline` is sanctioned for table rules (and input strokes)
   * and nothing else — never as a card edge.
   */
  ROW: "border-outline border-b last:border-0",
  /** Body cell padding — resolves the row to ROW_HEIGHT below. */
  CELL: "px-3 py-3 align-middle",
  /** Mirrors the resolved height of one populated row, for the skeleton. */
  ROW_HEIGHT: "h-[3.25rem]",
  /** The 16px slot reserved for the unread glyph so senders stay aligned. */
  FLAG: "size-4 flex-none",
} as const;

/** Pill icon button, on a fill rather than a stroke (the Fill-Over-Stroke Rule). */
const ICON_PILL =
  "size-9 rounded-pill bg-surface-container text-on-surface-variant hover:bg-surface-container-high pointer-coarse:size-11";

interface UseSmsColumnsArgs {
  isRead: (msg: SmsMessage) => boolean;
  openMessage: (msg: SmsMessage) => void;
  onDeleteMessage: (msg: SmsMessage) => void;
}

/**
 * Column definitions live next to the table that renders them, but the table
 * instance itself is created by the card so that selection state has a single
 * owner (the card header reads it too).
 */
export function useSmsColumns({
  isRead,
  openMessage,
  onDeleteMessage,
}: UseSmsColumnsArgs): ColumnDef<SmsMessage>[] {
  const { t } = useTranslation("cellular");

  return React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table: tbl }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={
                tbl.getIsAllPageRowsSelected() ||
                (tbl.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => tbl.toggleAllPageRowsSelected(!!value)}
              aria-label={t("sms.inbox.table.select_all_aria")}
            />
          </div>
        ),
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={t("sms.inbox.table.select_row_aria")}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "sender",
        header: t("sms.inbox.table.headers.from"),
        cell: ({ row }) => {
          const unread = !isRead(row.original);
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {/* The unread signal used to be a bare 8px `bg-primary` dot:
                    colour was its ONLY channel, so it did not exist for a
                    colour-blind user and vanished in grayscale. It is now a
                    GLYPH, with the slot reserved in both states so senders stay
                    on one left edge, plus a weight change. Read rows carry no
                    glyph — two states in one slot must not share one.

                    It is deliberately static. The mock pulses this dot on every
                    unread row, which breaks the One-Loop Rule outright (the loop
                    count scales with the unread count) and, worse, invents an
                    event: read-state comes from localStorage and changes only
                    when someone clicks. */}
                <span className={TABLE_SHAPE.FLAG}>
                  {unread && (
                    <MaterialSymbol
                      name="mark_email_unread"
                      filled
                      size={16}
                      className="text-primary"
                    />
                  )}
                </span>
                {unread && (
                  <span className="sr-only">
                    {t("sms.inbox.table.unread_sr")}
                  </span>
                )}
                <span
                  className={cn(
                    "truncate",
                    unread ? "font-semibold" : "font-normal",
                  )}
                >
                  {/* Every sender on the live device is ALPHANUMERIC — GLOBE,
                      SMART, TNT, NDRRMC, GLOBE_OTP, SmartApp. Not one phone
                      number. So it renders verbatim: no phone formatting, no
                      derived initials, no `tel:` link. */}
                  {row.original.sender}
                </span>
                {row.original.storage === "SM" && (
                  // `secondary`, not `outline`: this is a category label, not a
                  // status role — and `variant="outline"` is never a status
                  // indicator anyway (the Filled-Chip Rule).
                  <Badge variant="secondary" className="flex-none">
                    {t("sms.inbox.table.sim_badge")}
                  </Badge>
                )}
              </div>
              <span className="text-on-surface-variant block pl-6 font-mono text-xs tabular-nums @sm/card:hidden">
                {row.original.timestamp}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "content",
        header: () => (
          <span className="hidden @md/card:inline">
            {t("sms.inbox.table.headers.message")}
          </span>
        ),
        cell: ({ row }) => (
          <div className="text-on-surface-variant hidden max-w-xs truncate @md/card:block @2xl/card:max-w-md">
            {row.original.content}
          </div>
        ),
      },
      {
        id: "date",
        header: () => (
          <span className="hidden @sm/card:inline">
            {t("sms.inbox.table.headers.date")}
          </span>
        ),
        cell: ({ row }) => (
          // Machine voice: a modem-emitted stamp, so mono + tabular-nums.
          <span className="text-on-surface-variant hidden font-mono text-xs whitespace-nowrap tabular-nums @sm/card:inline">
            {row.original.timestamp}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    ICON_PILL,
                    "data-[state=open]:bg-surface-container-high",
                  )}
                  aria-label={t("sms.inbox.table.actions.open_menu")}
                >
                  <MaterialSymbol name="more_vert" size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => openMessage(row.original)}>
                  <MaterialSymbol name="visibility" size={16} />
                  {t("sms.inbox.table.actions.view")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDeleteMessage(row.original)}
                >
                  <MaterialSymbol name="delete" size={16} />
                  {t("sms.inbox.table.actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t, isRead, openMessage, onDeleteMessage],
  );
}

interface InboxTableProps {
  table: TanstackTable<SmsMessage>;
  columns: ColumnDef<SmsMessage>[];
  tab: SmsTab;
  search: string;
  selectedCount: number;
  /** Number of rows after tab/search filtering — drives the pagination footer */
  filteredCount: number;
  openMessage: (msg: SmsMessage) => void;
}

export function InboxTable({
  table,
  columns,
  tab,
  search,
  selectedCount,
  filteredCount,
  openMessage,
}: InboxTableProps) {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex flex-col gap-3.5">
      <div className={TABLE_SHAPE.SHELL}>
        <Table>
          <TableHeader className={cn(TABLE_SHAPE.HEAD, "sticky top-0 z-10")}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-0">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={TABLE_SHAPE.HEAD_CELL}
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
          {/* A NESTED cascade container: it declares `variants` only and
              inherits `visible` from the page-level cascade in sms-center.tsx.
              Adding initial/animate here would detach it from the parent clock.
              Rows take the 40ms / 5px row step, never the 60ms / 10px card step —
              a 10px lift moves each row past its neighbour's resting position
              and reads as the card reflowing rather than as content arriving. */}
          <MotionTableBody variants={staggerRows}>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <MotionTableRow
                  key={row.id}
                  className={cn(
                    TABLE_SHAPE.ROW,
                    "hover:bg-surface-container-high data-[state=selected]:bg-primary-container data-[state=selected]:text-on-primary-container cursor-pointer",
                  )}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  tabIndex={0}
                  aria-label={t("sms.inbox.view_dialog.title", {
                    sender: row.original.sender,
                  })}
                  onClick={() => openMessage(row.original)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openMessage(row.original);
                    }
                  }}
                  variants={staggerRowItem}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={TABLE_SHAPE.CELL}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </MotionTableRow>
              ))
            ) : (
              <TableRow className="border-0">
                <TableCell
                  colSpan={columns.length}
                  className="text-on-surface-variant h-24 text-center"
                >
                  {search.trim()
                    ? t("sms.inbox.table.empty_search")
                    : tab === "unread"
                      ? t("sms.inbox.table.empty_unread")
                      : tab === "read"
                        ? t("sms.inbox.table.empty_read")
                        : t("sms.inbox.table.empty_row")}
                </TableCell>
              </TableRow>
            )}
          </MotionTableBody>
        </Table>
      </div>

      {filteredCount > 0 && (
        <div className="flex flex-col gap-3 px-1 @lg/card:flex-row @lg/card:items-center @lg/card:justify-between">
          <span className="text-on-surface-variant text-sm">
            {selectedCount > 0
              ? t("sms.inbox.pagination.selected_info", {
                  selected: selectedCount,
                  total: filteredCount,
                })
              : t("sms.inbox.pagination.total", { count: filteredCount })}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-4 @lg/card:justify-end @lg/card:gap-6">
            <div className="hidden items-center gap-2 @sm/card:flex">
              <span className="text-sm font-medium whitespace-nowrap">
                {t("sms.inbox.pagination.rows_per_page")}
              </span>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger
                  size="sm"
                  className="rounded-field bg-surface-container w-18 border-0 font-mono tabular-nums"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 20, 30, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm font-medium whitespace-nowrap tabular-nums">
              {t("sms.inbox.pagination.page_label", {
                current: table.getState().pagination.pageIndex + 1,
                total: Math.max(table.getPageCount(), 1),
              })}
            </span>
            <div className="flex items-center gap-1.5">
              {/* `chevron_left` and `last_page` were deliberately REJECTED for
                  the 97-glyph subset, so the two backward controls are the
                  forward glyphs rotated. Every Material call site passes `size`
                  explicitly — the component sets fontSize inline, which outranks
                  any parent utility. */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(ICON_PILL, "hidden @sm/card:flex")}
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                aria-label={t("sms.inbox.buttons.first_page")}
              >
                <MaterialSymbol name="first_page" size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={ICON_PILL}
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={t("sms.inbox.buttons.prev_page")}
              >
                <MaterialSymbol
                  name="chevron_right"
                  size={18}
                  className="rotate-180"
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={ICON_PILL}
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={t("sms.inbox.buttons.next_page")}
              >
                <MaterialSymbol name="chevron_right" size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(ICON_PILL, "hidden @sm/card:flex")}
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                aria-label={t("sms.inbox.buttons.last_page")}
              >
                <MaterialSymbol
                  name="first_page"
                  size={18}
                  className="rotate-180"
                />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

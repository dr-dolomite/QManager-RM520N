"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  TbDotsVertical,
  TbEye,
  TbTrash,
  TbRefresh,
  TbPlus,
} from "react-icons/tb";
import {
  AlertCircleIcon,
  ArrowDownUp,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

const MotionTableRow = motion.create(TableRow);
const MotionTableBody = motion.create(TableBody);
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { staggerContainer, staggerItem } from "@/lib/motion-presets";
import type { SmsData } from "@/hooks/use-sms";
import type { SmsMessage } from "@/types/sms";
import {
  useSmsReadState,
  parseSmsTimestamp,
  smsFingerprint,
} from "@/hooks/use-sms-read-state";
import SmsComposeDialog from "./sms-compose-dialog";

type SmsTab = "all" | "unread" | "read";

// =============================================================================
// SmsInboxCard — Displays SMS messages in a table with view/delete actions
// =============================================================================

interface SmsInboxCardProps {
  data: SmsData | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Error from the hook (fetch or mutation failure) */
  error: string | null;
  onSend: (phone: string, message: string) => Promise<boolean>;
  onDelete: (indexes: number[], storage: "ME" | "SM") => Promise<boolean>;
  onDeleteAll: () => Promise<boolean>;
  onRefresh: () => void;
}

export default function SmsInboxCard({
  data,
  isLoading,
  isSaving,
  error,
  onSend,
  onDelete,
  onDeleteAll,
  onRefresh,
}: SmsInboxCardProps) {
  const [viewMessage, setViewMessage] = React.useState<SmsMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SmsMessage | null>(
    null,
  );
  const [showDeleteAll, setShowDeleteAll] = React.useState(false);
  const [showDeleteSelected, setShowDeleteSelected] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showCompose, setShowCompose] = React.useState(false);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [tab, setTab] = React.useState<SmsTab>("all");
  const [search, setSearch] = React.useState("");
  const [sortDir, setSortDir] = React.useState<"newest" | "oldest">("newest");

  // Newest-first regardless of backend ordering: parse the modem's
  // "MM/DD/YY HH:MM:SS" timestamp and sort descending. The backend also sorts
  // now, but doing it here makes the default order robust and is the source of
  // truth the table renders from.
  const sortedMessages = React.useMemo(
    () =>
      [...(data?.messages ?? [])].sort(
        (a, b) =>
          parseSmsTimestamp(b.timestamp) - parseSmsTimestamp(a.timestamp),
      ),
    [data?.messages],
  );

  const { isRead, markRead, markAllRead, unreadCount } =
    useSmsReadState(sortedMessages);

  // Tab filter → search filter → sort-direction flip sit on top of the
  // newest-first sorted list; the table renders the result. The oldest-first
  // flip lives here (not in `sortedMessages`) so the read-state hook above
  // always sees a stable newest-first order.
  const filteredMessages = React.useMemo(() => {
    let list = sortedMessages;
    if (tab === "unread") list = list.filter((m) => !isRead(m));
    else if (tab === "read") list = list.filter((m) => isRead(m));

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.sender.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q),
      );
    }

    // sortedMessages is newest-first, so oldest-first is just a reverse.
    return sortDir === "oldest" ? [...list].reverse() : list;
  }, [sortedMessages, tab, isRead, search, sortDir]);

  // Opening a message marks it read (the only read trigger besides "mark all").
  const openMessage = React.useCallback(
    (msg: SmsMessage) => {
      setViewMessage(msg);
      markRead(msg);
    },
    [markRead],
  );

  const handleMarkAllRead = () => {
    markAllRead();
    toast.success("All messages marked as read");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const success = await onDelete(deleteTarget.indexes, deleteTarget.storage);
    setIsDeleting(false);
    setDeleteTarget(null);
    if (success) {
      toast.success("Message deleted");
    } else {
      toast.error("Failed to delete message");
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    const success = await onDeleteAll();
    setIsDeleting(false);
    setShowDeleteAll(false);
    setRowSelection({});
    if (success) {
      toast.success("All messages deleted");
    } else {
      toast.error("Failed to delete messages");
    }
  };

  const handleDeleteSelected = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    if (selectedRows.length === 0) return;

    setIsDeleting(true);
    // The backend delete action targets one storage (ME/SM) per call, but a
    // selection can mix messages from both memories — group indexes by storage
    // and fire one delete per group.
    const byStorage = selectedRows.reduce<Record<"ME" | "SM", number[]>>(
      (acc, row) => {
        acc[row.original.storage].push(...row.original.indexes);
        return acc;
      },
      { ME: [], SM: [] },
    );
    let success = true;
    for (const storage of ["ME", "SM"] as const) {
      if (byStorage[storage].length === 0) continue;
      const ok = await onDelete(byStorage[storage], storage);
      if (!ok) success = false;
    }
    const count = selectedRows.length;
    setIsDeleting(false);
    setShowDeleteSelected(false);
    setRowSelection({});
    if (success) {
      toast.success(`${count} message${count !== 1 ? "s" : ""} deleted`);
    } else {
      toast.error("Failed to delete selected messages");
    }
  };

  const selectedCount = Object.keys(rowSelection).length;

  const columns: ColumnDef<SmsMessage>[] = React.useMemo(
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
              onCheckedChange={(value) =>
                tbl.toggleAllPageRowsSelected(!!value)
              }
              aria-label="Select all"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="Select row"
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "sender",
        header: "From",
        cell: ({ row }) => {
          const unread = !isRead(row.original);
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {unread && (
                  <span
                    className="size-2 shrink-0 rounded-full bg-primary"
                    aria-label="Unread"
                  />
                )}
                <span
                  className={`truncate ${unread ? "font-semibold" : "font-normal"}`}
                >
                  {row.original.sender}
                </span>
                {row.original.storage === "SM" && (
                  <Badge
                    variant="outline"
                    className="shrink-0 px-1.5 py-0 text-xs font-medium tracking-wide text-muted-foreground"
                  >
                    SIM
                  </Badge>
                )}
              </div>
              <span className="block text-xs text-muted-foreground @sm/card:hidden">
                {row.original.timestamp}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "content",
        header: () => (
          <span className="hidden @md/card:inline">Message</span>
        ),
        cell: ({ row }) => (
          <div className="hidden @md/card:block max-w-xs truncate text-muted-foreground">
            {row.original.content}
          </div>
        ),
      },
      {
        id: "date",
        header: () => <span className="hidden @sm/card:inline">Date</span>,
        cell: ({ row }) => (
          <span className="hidden @sm/card:inline text-muted-foreground text-sm whitespace-nowrap">
            {row.original.timestamp}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="data-[state=open]:bg-muted text-muted-foreground flex size-8 pointer-coarse:size-11"
                  size="icon"
                >
                  <TbDotsVertical />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => openMessage(row.original)}>
                  <TbEye className="size-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(row.original)}
                >
                  <TbTrash className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [isRead, openMessage],
  );

  const table = useReactTable({
    data: filteredMessages,
    columns,
    getRowId: (row) => smsFingerprint(row),
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
    initialState: {
      pagination: { pageSize: 10 },
    },
  });

  // --- Loading state ---------------------------------------------------------
  // Mirror the loaded layout so data arrival settles in place instead of
  // reflowing: real header text, the toolbar, the tab row, and a table-shaped
  // body. Only the dynamic rows are skeletoned.
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>View and manage your SMS messages</CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-8 w-9 rounded-md @xs/card:w-28" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-col gap-2 @lg/card:flex-row @lg/card:items-center @lg/card:justify-between">
            <Skeleton className="h-9 w-52 rounded-lg" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-full rounded-md @lg/card:w-48" />
              <Skeleton className="h-8 w-9 rounded-md @sm/card:w-28" />
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="bg-muted flex items-center gap-3 border-b px-3 py-2.5">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="hidden h-3 w-16 @md/card:block" />
              <Skeleton className="ml-auto hidden h-3 w-12 @sm/card:block" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b px-3 py-3 last:border-0"
              >
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20 @sm/card:hidden" />
                </div>
                <Skeleton className="hidden h-4 w-40 @md/card:block" />
                <Skeleton className="hidden h-4 w-24 @sm/card:block" />
                <Skeleton className="size-8 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-2 pt-3">
            <Skeleton className="h-4 w-24" />
            <div className="flex items-center gap-2">
              <Skeleton className="hidden h-8 w-28 rounded-md @sm/card:block" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (fetch failed, no data) ----------------------------------
  if (error && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>View and manage your SMS messages</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-8 text-center"
          >
            <AlertCircleIcon className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Failed to load messages</p>
              <p className="text-xs text-muted-foreground">
                Couldn&apos;t load your SMS inbox{error ? `: ${error}` : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <TbRefresh className="size-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const messages = data?.messages ?? [];
  const storage = data?.storage;
  const isEmpty = messages.length === 0;

  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>
            View and manage your SMS messages
            {storage
              ? ` — ${storage.used}/${storage.total} messages stored`
              : ""}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isSaving}
                aria-label="Refresh inbox"
              >
                <TbRefresh className="size-4" />
              </Button>
              {selectedCount > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteSelected(true)}
                  disabled={isSaving}
                  aria-label={`Delete ${selectedCount} selected`}
                >
                  <Trash2 className="size-4" />
                  <span className="hidden @sm/card:inline">
                    Delete ({selectedCount})
                  </span>
                </Button>
              )}
              {messages.length > 0 && selectedCount === 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteAll(true)}
                  disabled={isSaving}
                  aria-label="Delete all messages"
                >
                  <Trash2 className="size-4" />
                  <span className="hidden @sm/card:inline">Delete All</span>
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setShowCompose(true)}
                disabled={isSaving}
                aria-label="New Message"
              >
                <TbPlus className="size-4" />
                <span className="hidden @xs/card:inline">New Message</span>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <MessageSquare className="size-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">No messages</p>
                <p className="text-xs text-muted-foreground">
                  Your inbox is empty. Send a new message to get started.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowCompose(true)}
                disabled={isSaving}
                aria-label="New Message"
              >
                <TbPlus className="size-4" />
                New Message
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-col gap-2 @lg/card:flex-row @lg/card:items-center @lg/card:justify-between">
                <Tabs value={tab} onValueChange={(v) => setTab(v as SmsTab)}>
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="unread">
                      Unread
                      {unreadCount > 0 && (
                        <Badge className="p-1 rounded-full size-5 text-xs tabular-nums">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="read">Read</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 @lg/card:flex-initial">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search messages…"
                      aria-label="Search messages"
                      className="h-8 w-full pl-8 @lg/card:w-48"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Sort messages"
                      >
                        <ArrowDownUp className="size-4" />
                        <span className="hidden @sm/card:inline">
                          {sortDir === "newest" ? "Newest" : "Oldest"}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={sortDir}
                        onValueChange={(v) =>
                          setSortDir(v as "newest" | "oldest")
                        }
                      >
                        <DropdownMenuRadioItem value="newest">
                          Newest
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="oldest">
                          Oldest
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {unreadCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleMarkAllRead}
                      aria-label="Mark all as read"
                    >
                      <CheckCheck className="size-4" />
                      <span className="hidden @sm/card:inline">
                        Mark all read
                      </span>
                    </Button>
                  )}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id} colSpan={header.colSpan}>
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
                  <MotionTableBody
                    key={tab}
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                  >
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <MotionTableRow
                          key={row.id}
                          className="cursor-pointer"
                          tabIndex={0}
                          aria-label={`Message from ${row.original.sender}`}
                          onClick={() => openMessage(row.original)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openMessage(row.original);
                            }
                          }}
                          variants={staggerItem}
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
                          {search.trim()
                            ? "No messages match your search."
                            : tab === "unread"
                              ? "No unread messages."
                              : tab === "read"
                                ? "No read messages."
                                : "No messages found."}
                        </TableCell>
                      </TableRow>
                    )}
                  </MotionTableBody>
                </Table>
              </div>

              {filteredMessages.length > 0 && (
                <div className="flex flex-col gap-3 px-2 pt-3 @lg/card:flex-row @lg/card:items-center @lg/card:justify-between">
                  <span className="text-muted-foreground text-sm">
                    {selectedCount > 0
                      ? `${selectedCount} of ${filteredMessages.length} selected`
                      : `${filteredMessages.length} message${filteredMessages.length !== 1 ? "s" : ""}`}
                  </span>
                  <div className="flex items-center justify-between gap-4 @lg/card:justify-end @lg/card:gap-6">
                    <div className="hidden items-center gap-2 @sm/card:flex">
                      <span className="text-sm font-medium whitespace-nowrap">
                        Rows per page
                      </span>
                      <Select
                        value={`${table.getState().pagination.pageSize}`}
                        onValueChange={(value) =>
                          table.setPageSize(Number(value))
                        }
                      >
                        <SelectTrigger size="sm" className="w-18">
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
                      Page {table.getState().pagination.pageIndex + 1} of{" "}
                      {Math.max(table.getPageCount(), 1)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="hidden size-8 @sm/card:flex pointer-coarse:size-11"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                        aria-label="First page"
                      >
                        <ChevronsLeft className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 pointer-coarse:size-11"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 pointer-coarse:size-11"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        aria-label="Next page"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="hidden size-8 @sm/card:flex pointer-coarse:size-11"
                        onClick={() =>
                          table.setPageIndex(table.getPageCount() - 1)
                        }
                        disabled={!table.getCanNextPage()}
                        aria-label="Last page"
                      >
                        <ChevronsRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* View Message Dialog */}
      <Dialog
        open={!!viewMessage}
        onOpenChange={(open) => !open && setViewMessage(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Message from {viewMessage?.sender}</DialogTitle>
            <DialogDescription>{viewMessage?.timestamp}</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap wrap-break-word text-sm">
            {viewMessage?.content}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Single Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this message from{" "}
              {deleteTarget?.sender}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting&hellip;
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Confirmation */}
      <AlertDialog
        open={showDeleteAll}
        onOpenChange={(open) => !open && setShowDeleteAll(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Messages</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all {messages.length} messages?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting&hellip;
                </>
              ) : (
                "Delete All"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Selected Confirmation */}
      <AlertDialog
        open={showDeleteSelected}
        onOpenChange={(open) => !open && setShowDeleteSelected(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Messages</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount} selected message
              {selectedCount !== 1 ? "s" : ""}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting&hellip;
                </>
              ) : (
                `Delete (${selectedCount})`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compose Dialog */}
      <SmsComposeDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        onSend={onSend}
        isSaving={isSaving}
      />
    </>
  );
}

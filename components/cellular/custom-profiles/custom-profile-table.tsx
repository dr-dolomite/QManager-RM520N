"use client";

import * as React from "react";
import {
  TbCircleCheckFilled,
  TbDotsVertical,
  TbEdit,
  TbPlayerPlay,
  TbTrash,
} from "react-icons/tb";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

import type { ProfileSummary } from "@/types/sim-profile";
import { formatProfileDate } from "@/types/sim-profile";

// =============================================================================
// ProfileTable — Displays saved SIM profiles with actions
// =============================================================================
// No drag-and-drop. Profiles have no inherent ordering.
// Actions: Edit, Activate (future), Delete.
// =============================================================================

interface ProfileTableProps {
  data: ProfileSummary[];
  activeProfileId: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onActivate?: (id: string) => void;
}

export function ProfileTable({
  data,
  activeProfileId,
  onEdit,
  onDelete,
  onActivate,
}: ProfileTableProps) {
  const [deleteTarget, setDeleteTarget] = React.useState<ProfileSummary | null>(
    null
  );
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    await onDelete(deleteTarget.id);
    setIsDeleting(false);
    setDeleteTarget(null);
  };

  const columns: ColumnDef<ProfileSummary>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Profile",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div>
              <div className="font-medium">{row.original.name}</div>
              {row.original.mno && (
                <div className="text-muted-foreground text-xs">
                  {row.original.mno}
                </div>
              )}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const isActive = row.original.id === activeProfileId;
          return isActive ? (
            <Badge
              variant="outline"
              className="px-1.5 text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800"
            >
              <TbCircleCheckFilled className="fill-blue-500 dark:fill-blue-400" />
              Active
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="px-1.5 text-muted-foreground"
            >
              Inactive
            </Badge>
          );
        },
      },
      {
        id: "updated",
        header: "Last Updated",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatProfileDate(row.original.updated_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                size="icon"
              >
                <TbDotsVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onEdit(row.original.id)}>
                <TbEdit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              {onActivate && row.original.id !== activeProfileId && (
                <DropdownMenuItem
                  onClick={() => onActivate(row.original.id)}
                >
                  <TbPlayerPlay className="mr-2 h-4 w-4" />
                  Activate
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                <TbTrash className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [activeProfileId, onEdit, onActivate]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 10 },
    },
  });

  return (
    <>
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
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No profiles found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-muted-foreground text-sm">
            {data.length} profile{data.length !== 1 ? "s" : ""} total
          </span>
          {table.getPageCount() > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {table.getPageCount()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}
              &rdquo;? This action cannot be undone. The modem&apos;s current
              settings will not be reverted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

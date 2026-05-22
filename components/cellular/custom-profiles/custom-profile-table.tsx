"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import {
  TbDotsVertical,
  TbEdit,
  TbPlayerPlay,
  TbPlayerStop,
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

const MotionTableRow = motion.create(TableRow);
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

import type { ProfileApplyState, ProfileSummary } from "@/types/sim-profile";
import { formatProfileDate } from "@/types/sim-profile";

/** Short clock-time formatter for the "Applied at" row breadcrumb. */
const formatAppliedTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

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
  onDeactivate?: () => void;
  currentIccid?: string | null;
  /** Most recent terminal apply state — surfaces "Applied at HH:MM" on the matching row */
  lastApplyState?: ProfileApplyState | null;
}

export function ProfileTable({
  data,
  activeProfileId,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
  currentIccid,
  lastApplyState,
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
          const appliedHere =
            lastApplyState &&
            lastApplyState.profile_id === row.original.id &&
            ["complete", "partial", "failed"].includes(lastApplyState.status)
              ? lastApplyState
              : null;

          // Audit line below the badge — visible on whichever row received the
          // most recent apply, regardless of whether it's the active profile.
          const auditLine = appliedHere ? (
            <div
              className={`text-xs mt-1 ${
                appliedHere.status === "failed"
                  ? "text-destructive"
                  : appliedHere.status === "partial"
                  ? "text-warning"
                  : "text-muted-foreground"
              }`}
            >
              {appliedHere.status === "complete"
                ? "Applied"
                : appliedHere.status === "partial"
                ? "Partial apply"
                : "Apply failed"}{" "}
              at {formatAppliedTime(appliedHere.started_at)}
            </div>
          ) : null;

          let badge: React.ReactNode;
          if (isActive) {
            const profileIccid = row.original.sim_iccid;
            const isMismatch =
              profileIccid && currentIccid && profileIccid !== currentIccid;

            badge = isMismatch ? (
              <Badge
                variant="outline"
                className="px-1.5 bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
              >
                <TriangleAlertIcon className="size-3" />
                SIM Mismatch
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="px-1.5 bg-success/15 text-success hover:bg-success/20 border-success/30"
              >
                <CheckCircle2Icon className="size-3" />
                Active
              </Badge>
            );
          } else {
            badge = (
              <Badge
                variant="outline"
                className="px-1.5 bg-muted/50 text-muted-foreground border-muted-foreground/30"
              >
                Inactive
              </Badge>
            );
          }

          return (
            <div>
              {badge}
              {auditLine}
            </div>
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
                <TbEdit className="size-4" />
                Edit
              </DropdownMenuItem>
              {onActivate && row.original.id !== activeProfileId && (
                <DropdownMenuItem
                  onClick={() => onActivate(row.original.id)}
                >
                  <TbPlayerPlay className="size-4" />
                  Activate
                </DropdownMenuItem>
              )}
              {onDeactivate && row.original.id === activeProfileId && (
                <DropdownMenuItem onClick={onDeactivate}>
                  <TbPlayerStop className="size-4" />
                  Deactivate
                </DropdownMenuItem>
              )}
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
        ),
      },
    ],
    [activeProfileId, onEdit, onActivate, onDeactivate, currentIccid, lastApplyState]
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
              table.getRowModel().rows.map((row, index) => (
                <MotionTableRow
                  key={row.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.05, 0.4), ease: "easeOut" }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
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
                  No profiles yet. Create one to get started.
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
              &rdquo;? This action cannot be undone. Deleting this profile
              won&apos;t change your current modem configuration.
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

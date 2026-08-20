"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";
import { toast } from "sonner";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { SmsMessage, SmsStorage } from "@/types/sms";
import { smsFingerprint } from "@/hooks/use-sms-read-state";
import { InboxToolbar, type SmsTab, type SmsSortDir } from "./inbox-toolbar";
import { InboxTable, useSmsColumns } from "./inbox-table";
import { MessageDialog } from "./message-dialog";
import { SmsDeleteDialogs, type DeleteStep } from "./delete-dialogs";
import {
  ICON_PILL,
  INBOX_CARD,
  INBOX_PAD,
  INBOX_TITLE,
  TOOLBAR_PILL,
} from "./shapes";
import {
  InboxEmptyState,
  InboxErrorNotice,
  InboxStaleChip,
} from "./states";

// =============================================================================
// SmsInboxCard — the page's anchor card
// =============================================================================
// The card owns the table instance (so the header can read selection state), the
// filter state, and the delete sequencing. Everything visual is delegated.
//
// The single biggest behavioural change here is that a failed read NO LONGER
// blanks the table — see the header comment in `states.tsx` for why. The rows
// freeze, a destructive banner explains, and a `warning` chip dates them.
// =============================================================================

/** A storage-grouped delete: one CGI call per memory. */
interface DeleteGroup {
  storage: "ME" | "SM";
  indexes: number[];
  count: number;
}

/**
 * Group messages by the memory they live in. `indexes` are PER-STORAGE physical
 * slots and both stores start at 0, so ME slot 3 and SM slot 3 are different
 * messages — mixing them into one call would delete the wrong things.
 * Zero-length groups are dropped so a step never flashes for a memory that has
 * nothing in it (SM is empty on the live device).
 */
function groupByStorage(messages: SmsMessage[]): DeleteGroup[] {
  return (["ME", "SM"] as const)
    .map((storage) => {
      const own = messages.filter((m) => m.storage === storage);
      return {
        storage,
        indexes: own.flatMap((m) => m.indexes),
        count: own.length,
      };
    })
    .filter((group) => group.indexes.length > 0);
}

interface SmsInboxCardProps {
  /** Newest-first, already sorted by the page shell. */
  messages: SmsMessage[];
  storage: SmsStorage | undefined;
  isSaving: boolean;
  /**
   * True while an inbox GET is in flight — including a silent one. Distinct
   * from `isSaving`, which only ever covers send/delete: the Retry button in
   * the error notice was wired to `isSaving`, so its spinner could NEVER fire,
   * because nothing on the refresh path sets that flag.
   */
  isFetching: boolean;
  /** Error from the hook (fetch or mutation failure) */
  error: string | null;
  /** Epoch ms of the last GET that returned an inbox, or null. */
  lastSuccessfulFetch: number | null;
  isRead: (msg: SmsMessage) => boolean;
  markRead: (msg: SmsMessage) => void;
  markAllRead: () => void;
  unreadCount: number;
  onDelete: (indexes: number[], storage: "ME" | "SM") => Promise<boolean>;
  onRefresh: () => void;
  /** Opens Compose, optionally pre-addressed (the Reply path). */
  onCompose: (phone?: string) => void;
}

export default function SmsInboxCard({
  messages,
  storage,
  isSaving,
  isFetching,
  error,
  lastSuccessfulFetch,
  isRead,
  markRead,
  markAllRead,
  unreadCount,
  onDelete,
  onRefresh,
  onCompose,
}: SmsInboxCardProps) {
  const { t } = useTranslation("cellular");
  const [viewMessage, setViewMessage] = React.useState<SmsMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SmsMessage | null>(null);
  const [showDeleteAll, setShowDeleteAll] = React.useState(false);
  const [showDeleteSelected, setShowDeleteSelected] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [steps, setSteps] = React.useState<DeleteStep[]>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [tab, setTab] = React.useState<SmsTab>("all");
  const [search, setSearch] = React.useState("");
  const [sortDir, setSortDir] = React.useState<SmsSortDir>("newest");

  // Tab filter → search filter → sort-direction flip. `messages` arrives
  // newest-first from the page shell, so oldest-first is just a reverse.
  const filteredMessages = React.useMemo(() => {
    let list = messages;
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

    return sortDir === "oldest" ? [...list].reverse() : list;
  }, [messages, tab, isRead, search, sortDir]);

  // Opening a message marks it read — the only read trigger besides "mark all".
  const openMessage = React.useCallback(
    (msg: SmsMessage) => {
      setViewMessage(msg);
      markRead(msg);
    },
    [markRead],
  );

  const columns = useSmsColumns({
    isRead,
    openMessage,
    onDeleteMessage: setDeleteTarget,
  });

  const table = useReactTable({
    data: filteredMessages,
    columns,
    getRowId: (row) => smsFingerprint(row),
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
    initialState: { pagination: { pageSize: 10 } },
  });

  // ---------------------------------------------------------------------------
  // Selection — the fix for a real bug
  // ---------------------------------------------------------------------------
  // `rowSelection` is keyed by `smsFingerprint`, and nothing used to prune it
  // when the tab or the search box changed. A message selected under "All" then
  // filtered out of view stayed selected, stayed in `selectedCount`, and was
  // DELETED by "Delete N selected" while invisible.
  //
  // Two defences, because they cover different causes:
  //   1. Every count and every delete now reads `table.getSelectedRowModel()`,
  //      which is derived from the CURRENT filtered rows — so a fingerprint with
  //      no matching row simply cannot be counted or deleted. This also covers
  //      selections orphaned by a refresh or by someone else deleting a message.
  //   2. Changing the tab or the search text clears the map outright, so the
  //      checkboxes do not silently resurrect when the filter is undone.
  // Clearing happens in the change HANDLERS rather than in an effect: a
  // `setState` inside `useEffect` is exactly the shape the react-compiler lint
  // rejects, and the handler is where the intent actually lives.
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

  const handleTabChange = React.useCallback((next: SmsTab) => {
    setTab(next);
    setRowSelection({});
  }, []);

  const handleSearchChange = React.useCallback((next: string) => {
    setSearch(next);
    setRowSelection({});
  }, []);

  const handleMarkAllRead = () => {
    markAllRead();
    toast.success(t("sms.inbox.toast.mark_all_read_success"));
  };

  // ---------------------------------------------------------------------------
  // Deletes
  // ---------------------------------------------------------------------------
  /**
   * Run one CGI call per memory, sequentially, publishing each step's status as
   * it actually resolves. This is what makes the two-step visual TRUE: the
   * `delete_all` action is a single opaque POST whose per-memory outcome the
   * client cannot observe, whereas two `delete` calls report individually — so a
   * partial failure can name *which* memory failed instead of merging into one
   * error.
   */
  const runGroupedDelete = React.useCallback(
    async (groups: DeleteGroup[]): Promise<("ME" | "SM")[]> => {
      setSteps(
        groups.map((g) => ({
          storage: g.storage,
          count: g.count,
          status: "pending" as const,
        })),
      );
      setIsDeleting(true);

      const failed: ("ME" | "SM")[] = [];
      for (let i = 0; i < groups.length; i++) {
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s)),
        );
        const ok = await onDelete(groups[i].indexes, groups[i].storage);
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: ok ? "done" : "failed" } : s,
          ),
        );
        if (!ok) failed.push(groups[i].storage);
      }

      setIsDeleting(false);
      return failed;
    },
    [onDelete],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const success = await onDelete(deleteTarget.indexes, deleteTarget.storage);
    setIsDeleting(false);
    setDeleteTarget(null);
    if (success) toast.success(t("sms.inbox.toast.delete_success"));
    else toast.error(t("sms.inbox.toast.delete_error"));
  };

  const handleDeleteAll = async () => {
    const failed = await runGroupedDelete(groupByStorage(messages));
    setShowDeleteAll(false);
    setSteps([]);
    setRowSelection({});
    if (failed.length === 0) {
      toast.success(t("sms.inbox.toast.delete_all_success"));
    } else {
      toast.error(
        t("sms.inbox.toast.delete_memory_error", {
          memory: failed
            .map((s) => t(`sms.inbox.memory.${s.toLowerCase()}`))
            .join(", "),
        }),
      );
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedCount === 0) return;
    const count = selectedCount;
    const failed = await runGroupedDelete(
      groupByStorage(selectedRows.map((r) => r.original)),
    );
    setShowDeleteSelected(false);
    setSteps([]);
    setRowSelection({});
    if (failed.length === 0) {
      toast.success(t("sms.inbox.toast.delete_selected_success", { count }));
    } else {
      toast.error(
        t("sms.inbox.toast.delete_memory_error", {
          memory: failed
            .map((s) => t(`sms.inbox.memory.${s.toLowerCase()}`))
            .join(", "),
        }),
      );
    }
  };

  // Pre-flight split for the delete-all confirmation. Phrased as what WILL be
  // removed, never as a completion log.
  const allGroups = groupByStorage(messages);
  const meCount = allGroups.find((g) => g.storage === "ME")?.count ?? 0;
  const smCount = allGroups.find((g) => g.storage === "SM")?.count ?? 0;

  const isEmpty = messages.length === 0;
  const hasStaleRows = !!error && !isEmpty;

  // The card description reports slot usage HONESTLY. The old copy said
  // "{{used}}/{{total}} messages stored" off the summed figures — but the sum of
  // two capacities in physically different memories is not a capacity, because a
  // message cannot spill from one into the other.
  const description = error
    ? t("sms.inbox.description_unknown")
    : storage?.me && storage?.sm
      ? t("sms.inbox.description_split", {
          me: storage.me.used,
          meTotal: storage.me.total,
          sm: storage.sm.used,
          smTotal: storage.sm.total,
        })
      : storage
        ? t("sms.inbox.description_combined", { used: storage.used })
        : t("sms.inbox.description");

  return (
    <>
      <Card className={INBOX_CARD}>
        {/* Never an icon in a CardHeader — the chip and the actions carry the
            glyphs instead. */}
        <CardHeader className={INBOX_PAD}>
          <CardTitle className={INBOX_TITLE}>{t("sms.inbox.title")}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span>{description}</span>
            {hasStaleRows && lastSuccessfulFetch !== null && (
              <InboxStaleChip atMs={lastSuccessfulFetch} />
            )}
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedCount > 0 ? (
                <>
                  {/* The count and the clear action are TWO objects, not one.
                      This was a hand-written chip — `bg-primary-container
                      text-on-primary-container rounded-pill flex h-9 ...` —
                      with a 24px `<button>` nested inside it. Both halves were
                      wrong: chip classes are never hand-written (the variant is
                      the whole API), and a 24px control on a page read on a
                      tablet in the field is under half the 44px coarse-pointer
                      target every other control here already clears.

                      A `Tag`, not a `Badge`: a selection count says what is
                      true of the table, not whether anything is WELL, and a
                      count has no honest hue (The Neutral-Default Rule). The
                      emphasis on this row belongs to the destructive action
                      beside it. */}
                  <Tag
                    variant="neutral"
                    className="h-9 gap-1.5 px-4 text-sm font-semibold"
                  >
                    <span className="tabular-nums">{selectedCount}</span>
                    {t("sms.inbox.selection.label")}
                  </Tag>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRowSelection({})}
                    aria-label={t("sms.inbox.selection.clear_aria")}
                    className={ICON_PILL}
                  >
                    <MaterialSymbol name="close" size={18} />
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteSelected(true)}
                    disabled={isSaving}
                    className={TOOLBAR_PILL}
                    aria-label={t("sms.inbox.buttons.delete_selected_aria", {
                      count: selectedCount,
                    })}
                  >
                    <MaterialSymbol name="delete" size={17} />
                    <span className="hidden @sm/card:inline">
                      {t("sms.inbox.buttons.delete_selected_short")}
                    </span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    disabled={isSaving || isFetching}
                    aria-label={t("sms.inbox.buttons.refresh_aria")}
                    className={ICON_PILL}
                  >
                    {/* A real in-flight state. Refresh is a silent re-fetch, so
                        without this the button gave no feedback at all — the
                        rows simply changed under the reader some seconds later,
                        or did not. */}
                    <MaterialSymbol
                      name={isFetching ? "progress_activity" : "refresh"}
                      size={18}
                      className={
                        isFetching
                          ? "animate-spin motion-reduce:animate-none"
                          : undefined
                      }
                    />
                  </Button>
                  {!isEmpty && (
                    <Button
                      variant="tonal-destructive"
                      onClick={() => setShowDeleteAll(true)}
                      disabled={isSaving}
                      aria-label={t("sms.inbox.buttons.delete_all_aria")}
                      className={TOOLBAR_PILL}
                    >
                      <MaterialSymbol name="delete_sweep" size={17} />
                      <span className="hidden @sm/card:inline">
                        {t("sms.inbox.buttons.delete_all")}
                      </span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className={cn(INBOX_PAD, "flex flex-col gap-4")}>
          {error && (
            <InboxErrorNotice
              error={error}
              hasStaleRows={hasStaleRows}
              onRetry={onRefresh}
              isRetrying={isFetching}
            />
          )}

          {isEmpty ? (
            // Only a genuinely empty inbox gets the empty state. A read failure
            // with rows behind it keeps the rows.
            !error && (
              <InboxEmptyState isSaving={isSaving} onCompose={() => onCompose()} />
            )
          ) : (
            <>
              <InboxToolbar
                tab={tab}
                onTabChange={handleTabChange}
                search={search}
                onSearchChange={handleSearchChange}
                sortDir={sortDir}
                onSortDirChange={setSortDir}
                unreadCount={unreadCount}
                onMarkAllRead={handleMarkAllRead}
              />
              <InboxTable
                table={table}
                columns={columns}
                tab={tab}
                search={search}
                selectedCount={selectedCount}
                filteredCount={filteredMessages.length}
                openMessage={openMessage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <MessageDialog
        message={viewMessage}
        onClose={() => setViewMessage(null)}
        onReply={(sender) => {
          setViewMessage(null);
          onCompose(sender);
        }}
        onDelete={(msg) => {
          setViewMessage(null);
          setDeleteTarget(msg);
        }}
      />

      <SmsDeleteDialogs
        isDeleting={isDeleting}
        steps={steps}
        deleteTarget={deleteTarget}
        onCloseDeleteTarget={() => setDeleteTarget(null)}
        onConfirmDelete={handleDelete}
        showDeleteAll={showDeleteAll}
        onCloseDeleteAll={() => setShowDeleteAll(false)}
        onConfirmDeleteAll={handleDeleteAll}
        totalCount={messages.length}
        meCount={meCount}
        smCount={smCount}
        showDeleteSelected={showDeleteSelected}
        onCloseDeleteSelected={() => setShowDeleteSelected(false)}
        onConfirmDeleteSelected={handleDeleteSelected}
        selectedCount={selectedCount}
      />
    </>
  );
}

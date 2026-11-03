"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useMotionReduced } from "@/components/motion-preference";
import { CellularPageHeader } from "@/components/cellular/page-header";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { smsErrorMessage, useSms, type SmsSendOutcome } from "@/hooks/use-sms";
import {
  DUR,
  EASE_EMPHASIZED,
  EASE_QUICK,
  staggerItem,
} from "@/lib/motion";
import type { SmsMessage } from "@/types/sms";

import SmsComposeDialog from "./sms-compose-dialog";
import { SmsConversation } from "./sms-conversation";
import { SmsForwardDialog } from "./sms-forward-dialog";
import { isOutbound, smsEpochMs } from "./sms-format";
import { SmsMessageDetailsDialog } from "./sms-message-details-dialog";
import { SmsSettingsDialog } from "./sms-settings-dialog";
import { SmsStatePanel } from "./sms-states";
import { SmsThreadList, type SmsThreadFilter } from "./sms-thread-list";
import {
  buildThreadViews,
  threadMatchesQuery,
  threadViewFromMessages,
} from "./sms-threads";

/** Excerpt cap for the delete-message dialog. */
const DELETE_EXCERPT_MAX = 140;

function excerptOf(text: string): string {
  if (text.length <= DELETE_EXCERPT_MAX) return text;
  return `${text.slice(0, DELETE_EXCERPT_MAX)}…`;
}

/**
 * Debounce before a new received message in the OPEN thread is marked read.
 * See the effect near the bottom of this component.
 */
const MARK_READ_DEBOUNCE_MS = 800;

// =============================================================================
// SmsCenterComponent — the SMS surface
// =============================================================================
// Page header, then ONE card holding two panes. The card is still the unit the
// page grid arranges (DESIGN.md > The Card-Wrapped Surface Rule); what is new
// is a two-pane interior.
//
// ## Routing
//
// Opening a thread pushes `/cellular/sms/?thread=<encodeURIComponent(addr)>`,
// so Back leaves the THREAD rather than the page and a thread is deep-linkable.
// A `[addr]` dynamic segment is not available here: `next.config.ts` sets
// `output: "export"` and `generateStaticParams` cannot enumerate arbitrary
// sender addresses at build time.
//
// The query value is the RAW stored address, percent-encoded. It is the same
// string every fetch / delete / reply / mark-read call downstream receives.
// =============================================================================

/**
 * The split point, in px, matching `@3xl/main` (48rem).
 *
 * Layout itself is pure CSS container queries: the panes show and hide without
 * JS, so a first paint before the observer fires is already correct. This
 * number exists only so the pane transition can pick the right gesture: a
 * horizontal push when one pane replaces the other, and a plain content swap
 * when both are on screen and nothing actually moves.
 */
const SPLIT_PX = 768;

/** How often the "synced N ago" readout re-reads the clock. */
const SYNC_TICK_MS = 10_000;

export default function SmsCenterComponent() {
  const { t } = useTranslation("cellular");
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useMotionReduced();

  const {
    data,
    isLoading,
    isFetching,
    isSaving,
    error,
    lastSyncedAt,
    pendingSends,
    sendSms,
    queueSend,
    retrySend,
    dismissSend,
    deleteSms,
    deleteThread,
    deleteAllSms,
    fetchThread,
    updateSmsc,
    markThreadRead,
    markMessageUnread,
    refresh,
  } = useSms();

  const messages = React.useMemo(() => data?.messages ?? [], [data?.messages]);

  // ---- list state ---------------------------------------------------------
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<SmsThreadFilter>("all");
  const [sortNewestFirst, setSortNewestFirst] = React.useState(true);

  const allViews = React.useMemo(() => buildThreadViews(data), [data]);

  const visibleViews = React.useMemo(() => {
    let list = allViews.filter((v) => threadMatchesQuery(v, search));
    if (filter === "unread") list = list.filter((v) => v.unread > 0);
    return sortNewestFirst ? list : [...list].reverse();
  }, [allViews, search, filter, sortNewestFirst]);

  // ---- the open thread ----------------------------------------------------
  // A send moves to the normalized number (no "+") a moment before the URL follows it.
  const isSameAddr = (a: string, open: string | null) =>
    open !== null && (a === open || a === open.replace(/^\+/, ""));
  const threadParam = searchParams.get("thread");
  // `get()` already decodes; decoding again throws on a sender like "50%OFF".
  const openAddr = threadParam || null;
  const listView = openAddr
    ? (allViews.find((v) => v.addr === openAddr) ?? null)
    : null;

  // The fetched detail carries the address it was fetched FOR. Without that,
  // switching A -> B rendered B's first frames with A's detail still merged in
  // (a ghost of the previous thread), then swapped it out when B's fetch
  // landed. Deriving both `detail` and `isLoadingThread` from the tag means a
  // thread switch can never see another thread's messages, not even for one
  // render.
  const [detailState, setDetailState] = React.useState<{
    addr: string | null;
    messages: SmsMessage[];
  }>({ addr: null, messages: [] });
  const detail = React.useMemo(
    () =>
      openAddr && detailState.addr === openAddr ? detailState.messages : [],
    [openAddr, detailState],
  );
  // Skeleton only when there is nothing to show: a list row or a pending send renders at once.
  const isLoadingThread =
    openAddr !== null &&
    detailState.addr !== openAddr &&
    !listView &&
    !pendingSends.some((p) => isSameAddr(p.addr, openAddr));

  // The list may have no row for this address (a deep link to something that
  // is no longer stored). Identity is then read off the detail's own first
  // message and `addr` stays the raw key we were handed.
  const openView = React.useMemo(() => {
    if (listView) return listView;
    if (!openAddr) return null;
    if (detail.length > 0) return threadViewFromMessages(openAddr, detail);
    // A Forward... that targets a number with no existing thread: there is no
    // list row and no history yet, but there IS a pending optimistic send for
    // it, and that send needs somewhere to render. An empty-messages view is a
    // real destination, not the "this thread is gone" state below.
    if (pendingSends.some((p) => isSameAddr(p.addr, openAddr))) {
      return threadViewFromMessages(openAddr, []);
    }
    return null;
  }, [listView, openAddr, detail, pendingSends]);

  // Thread detail is fetched once per deliberate open; fetching it reads it.
  React.useEffect(() => {
    if (!openAddr) {
      setDetailState({ addr: null, messages: [] });
      return;
    }
    let cancelled = false;
    void fetchThread(openAddr).then((page) => {
      if (cancelled) return;
      setDetailState({ addr: openAddr, messages: page });
    });
    return () => {
      cancelled = true;
    };
  }, [openAddr, fetchThread]);

  // The list and the detail are unioned, de-duplicated on (time, direction, body).
  const threadMessages = React.useMemo(() => {
    if (!openView) return detail;
    const sig = (m: SmsMessage) =>
      `${smsEpochMs(m)}|${isOutbound(m) ? "o" : "i"}|${m.content ?? ""}`;
    const merged = [...openView.messages];
    const seen = new Set(merged.map(sig));
    for (const m of detail) {
      const s = sig(m);
      if (!seen.has(s)) {
        seen.add(s);
        merged.push(m);
      }
    }
    return merged.sort((a, b) => smsEpochMs(a) - smsEpochMs(b));
  }, [openView, detail]);

  // A message that arrives in the open thread on a refresh is read too.
  // Debounced, and gated on the received count growing past the open baseline.
  const readSyncRef = React.useRef<{ addr: string | null; inboundCount: number }>(
    { addr: null, inboundCount: 0 },
  );
  React.useEffect(() => {
    if (!openView) {
      readSyncRef.current = { addr: null, inboundCount: 0 };
      return;
    }
    const inboundCount = openView.messages.reduce(
      (n, m) => (isOutbound(m) ? n : n + 1),
      0,
    );
    const baseline = readSyncRef.current;
    if (baseline.addr !== openView.addr) {
      // Newly opened (or re-opened) thread: record the baseline only.
      readSyncRef.current = { addr: openView.addr, inboundCount };
      return;
    }
    if (inboundCount <= baseline.inboundCount) return;
    readSyncRef.current = { addr: openView.addr, inboundCount };
    const addr = openView.addr;
    const timer = window.setTimeout(() => {
      markThreadRead(addr);
    }, MARK_READ_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [openView, markThreadRead]);

  const threadPending = React.useMemo(
    () => pendingSends.filter((p) => isSameAddr(p.addr, openAddr)),
    [pendingSends, openAddr],
  );

  // ---- navigation ---------------------------------------------------------
  // Direction of the last pane change, set by the two navigation handlers.
  //
  // Deriving it from the previous `openAddr` would mean reading a ref during
  // render, which React's own lint rule rightly forbids. A browser Back that
  // bypasses `closeThread` therefore leaves this at "none" and the panes cut
  // rather than push: a graceful degradation, and the in-card back button
  // always goes through the handler.
  const [direction, setDirection] = React.useState<"in" | "out" | "none">(
    "none",
  );

  const openThread = React.useCallback(
    (addr: string) => {
      setDirection("in");
      // THE KEY travels in the URL, percent-encoded, so an address with
      // reserved characters survives the round-trip intact.
      router.push(`/cellular/sms/?thread=${encodeURIComponent(addr)}`, {
        scroll: false,
      });
    },
    [router],
  );

  const closeThread = React.useCallback(() => {
    setDirection("out");
    // `back()` would be wrong on a deep link, where there is no thread list to
    // go back TO. Pushing the bare route always lands somewhere real.
    router.push("/cellular/sms/", { scroll: false });
  }, [router]);

  // ---- pane transition ----------------------------------------------------
  const mainRef = React.useRef<HTMLDivElement | null>(null);
  const [isSplit, setIsSplit] = React.useState(true);

  React.useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setIsSplit(width >= SPLIT_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pushing = !isSplit && !reduceMotion;

  // ---- focus --------------------------------------------------------------
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const lastOpenedRef = React.useRef<string | null>(null);
  const focusPrimedRef = React.useRef(false);

  const registerRowRef = React.useCallback(
    (addr: string, el: HTMLButtonElement | null) => {
      if (el) rowRefs.current.set(addr, el);
      else rowRefs.current.delete(addr);
    },
    [],
  );

  React.useEffect(() => {
    // Skip the very first run: a deep link should not yank focus out of the
    // page chrome before the user has done anything.
    if (!focusPrimedRef.current) {
      focusPrimedRef.current = true;
      lastOpenedRef.current = openAddr;
      return;
    }
    if (openAddr) {
      lastOpenedRef.current = openAddr;
      headingRef.current?.focus();
    } else if (lastOpenedRef.current) {
      rowRefs.current.get(lastOpenedRef.current)?.focus();
      lastOpenedRef.current = null;
    }
  }, [openAddr]);

  // ---- "synced N ago" -----------------------------------------------------
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), SYNC_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const syncedAgoSec = lastSyncedAt
    ? Math.max(0, Math.round((now - lastSyncedAt) / 1000))
    : null;

  // ---- dialogs ------------------------------------------------------------
  const [showCompose, setShowCompose] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // ---- per-message dialogs (context menu) ----------------------------------
  const [forwardTarget, setForwardTarget] = React.useState<SmsMessage | null>(
    null,
  );
  const [detailsTarget, setDetailsTarget] = React.useState<SmsMessage | null>(
    null,
  );
  const [deleteMessageTarget, setDeleteMessageTarget] =
    React.useState<SmsMessage | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = React.useState(false);

  // One toast per settled send; the bubble keeps its own status line too.
  const toastSend = React.useCallback(
    (outcome: SmsSendOutcome | null) => {
      if (!outcome) return;
      if (outcome.result.ok) toast.success(t("sms.compose.toast.success"));
      else toast.error(smsErrorMessage(t, outcome.result, t("sms.errors.send")));
    },
    [t],
  );

  // Read in the send's settle callback, after the closure that queued it.
  const openAddrRef = React.useRef(openAddr);
  React.useEffect(() => {
    openAddrRef.current = openAddr;
  }, [openAddr]);

  // The backend files a send under the normalized number: follow it there if still open.
  const settleSend = React.useCallback(
    (dest: string, outcome: SmsSendOutcome | null) => {
      toastSend(outcome);
      if (
        outcome?.result.ok &&
        outcome.addr !== dest &&
        openAddrRef.current === dest
      ) {
        router.replace(
          `/cellular/sms/?thread=${encodeURIComponent(outcome.addr)}`,
          { scroll: false },
        );
      }
    },
    [toastSend, router],
  );

  const handleSend = React.useCallback(
    (text: string) => {
      if (!openAddr) return;
      // THE KEY again: the reply destination is the raw stored address.
      const dest = openAddr;
      void queueSend(dest, text).done.then((o) => settleSend(dest, o));
    },
    [openAddr, queueSend, settleSend],
  );

  const handleRetrySend = React.useCallback(
    (clientId: string) => {
      const dest = openAddrRef.current;
      void retrySend(clientId).then((o) =>
        dest ? settleSend(dest, o) : toastSend(o),
      );
    },
    [retrySend, settleSend, toastSend],
  );

  // ---- per-message context menu actions ------------------------------------
  const handleForwardSubmit = React.useCallback(
    (dest: string, text: string) => {
      const { done } = queueSend(dest, text);
      setForwardTarget(null);
      if (dest !== openAddr) openThread(dest);
      void done.then((outcome) => settleSend(dest, outcome));
    },
    [queueSend, openThread, openAddr, settleSend],
  );

  const handleMarkMessageUnread = React.useCallback(
    (msg: SmsMessage) => {
      if (!openAddr || !msg.identity) return;
      const result = markMessageUnread(openAddr, msg.identity);
      if (result.ok) {
        toast.success(t("sms.center.toast.message_marked_unread"));
        // Mark-as-unread returns to the list. Reopening the thread is what
        // marks it read again.
        closeThread();
      } else {
        toast.error(t("sms.center.toast.mark_unread_failed"));
      }
    },
    [openAddr, markMessageUnread, closeThread, t],
  );

  const handleMarkThreadRead = React.useCallback(
    (addr: string) => {
      markThreadRead(addr);
      toast.success(t("sms.center.toast.thread_marked_read"));
    },
    [markThreadRead, t],
  );

  const confirmDeleteMessage = async () => {
    if (!deleteMessageTarget) return;
    setIsDeletingMessage(true);
    const result = await deleteSms(deleteMessageTarget);
    setIsDeletingMessage(false);
    const deleted = deleteMessageTarget;
    setDeleteMessageTarget(null);
    if (result.ok) {
      // The open thread unions the list with `detail`; drop it from both.
      setDetailState((prev) => ({
        ...prev,
        messages: prev.messages.filter((m) =>
          deleted.identity ? m.identity !== deleted.identity : m !== deleted,
        ),
      }));
      toast.success(t("sms.center.toast.message_deleted"));
    } else {
      toast.error(
        smsErrorMessage(t, result, t("sms.center.toast.message_delete_failed")),
      );
    }
  };

  const confirmDeleteThread = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const result = await deleteThread(deleteTarget);
    setIsDeleting(false);
    const deletedAddr = deleteTarget;
    setDeleteTarget(null);
    if (result.ok) {
      toast.success(t("sms.center.toast.thread_deleted"));
      if (openAddr === deletedAddr) closeThread();
    } else {
      toast.error(
        smsErrorMessage(t, result, t("sms.center.toast.thread_delete_failed")),
      );
    }
  };

  const confirmDeleteAll = async () => {
    setIsDeleting(true);
    const result = await deleteAllSms();
    setIsDeleting(false);
    setShowDeleteAll(false);
    if (result.ok) {
      toast.success(t("sms.inbox.toast.delete_all_success"));
      closeThread();
    } else {
      toast.error(smsErrorMessage(t, result, t("sms.errors.delete_all")));
    }
  };

  return (
    <div ref={mainRef} className="@container/main mx-auto flex flex-col gap-5 p-2">
      {/* ---- page header --------------------------------------------------- */}
      <CellularPageHeader
        title={t("sms.page.title")}
        description={t("sms.page.description")}
        actions={
          <>
            {/* Deliberately NOT aria-live: this re-reads the clock every 10s
                and announcing "synced 30s ago" on a loop would bury everything
                else a screen reader has to say. The data it describes is
                ambient. */}
            {/* A failed refresh keeps the list on screen, so it has to say the
                list is stale. */}
            {error && allViews.length > 0 ? (
              <Badge variant="warning">
                <MaterialSymbol name="warning" filled size={12} />
                {t("sms.center.header.refresh_failed")}
              </Badge>
            ) : null}
            {syncedAgoSec !== null ? (
              <span className="text-on-surface-variant hidden items-center gap-1.5 text-xs font-medium @xl/main:inline-flex">
                <MaterialSymbol name="schedule" size={15} />
                <span className="tabular-nums">
                  {t("sms.center.header.synced", { seconds: syncedAgoSec })}
                </span>
              </span>
            ) : null}

            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={() => refresh(true)}
              disabled={isFetching}
            >
              <MaterialSymbol
                name={isFetching ? "progress_activity" : "refresh"}
                size={18}
                className={isFetching ? "motion-safe:animate-spin" : undefined}
              />
              {t("sms.center.actions.refresh")}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="tonal-neutral"
                  size="icon"
                  aria-label={t("sms.center.actions.more")}
                  className="size-[2.625rem]"
                >
                  <MaterialSymbol name="more_vert" size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setShowSettings(true)}>
                  <MaterialSymbol name="settings" size={16} />
                  {t("sms.settings.title")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Nothing to delete is not an error, and it should not be
                    presented as an available action either. */}
                <DropdownMenuItem
                  variant="destructive"
                  disabled={messages.length === 0}
                  onSelect={() => setShowDeleteAll(true)}
                >
                  <MaterialSymbol name="delete_sweep" size={16} />
                  {t("sms.inbox.buttons.delete_all")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* ---- THE CARD: one surface, two panes ------------------------------ */}
      <motion.div variants={staggerItem} initial="hidden" animate="visible">
        <Card className="@container/card rounded-card h-[clamp(30rem,calc(100svh-15rem),54rem)] flex-row gap-0 overflow-hidden border-0 p-0 shadow-[var(--shadow-whisper)]">
          {/* ---- list pane -------------------------------------------- */}
          <motion.div
            key={`list-${direction === "out" ? "return" : "steady"}`}
            initial={
              pushing && direction === "out" ? { x: "-12%", opacity: 0 } : false
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: DUR.quick, ease: EASE_QUICK }}
            className={
              openAddr
                ? "hidden min-h-0 w-full flex-col @3xl/main:flex @3xl/main:w-[23rem] @3xl/main:flex-none"
                : "flex min-h-0 w-full flex-col @3xl/main:flex @3xl/main:w-[23rem] @3xl/main:flex-none"
            }
          >
            <SmsThreadList
              className="min-h-0 flex-1"
              threads={visibleViews}
              selectedAddr={openAddr}
              onSelect={openThread}
              search={search}
              onSearchChange={setSearch}
              filter={filter}
              onFilterChange={setFilter}
              sortNewestFirst={sortNewestFirst}
              onToggleSort={() => setSortNewestFirst((v) => !v)}
              onCompose={() => setShowCompose(true)}
              isLoading={isLoading && allViews.length === 0}
              error={allViews.length === 0 ? error : null}
              onRetry={() => refresh()}
              storage={data?.storage ?? null}
              registerRowRef={registerRowRef}
            />
          </motion.div>

          {/* ---- conversation pane ------------------------------------- */}
          <motion.div
            key={`pane-${openAddr ?? "none"}`}
            initial={
              pushing && direction === "in" ? { x: "12%", opacity: 0 } : false
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{
              duration: DUR.emphasized,
              ease: EASE_EMPHASIZED,
            }}
            className={
              openAddr
                ? "flex min-h-0 min-w-0 flex-1 flex-col @3xl/main:flex"
                : "hidden min-h-0 min-w-0 flex-1 flex-col @3xl/main:flex"
            }
          >
            {openView ? (
              <SmsConversation
                className="min-h-0 flex-1"
                view={openView}
                messages={threadMessages}
                pending={threadPending}
                isLoadingThread={isLoadingThread}
                onBack={closeThread}
                onSend={handleSend}
                onRetrySend={handleRetrySend}
                onDismissSend={dismissSend}
                onRequestDeleteThread={() => setDeleteTarget(openView.addr)}
                onMarkRead={() => handleMarkThreadRead(openView.addr)}
                onForwardMessage={setForwardTarget}
                onMarkMessageUnread={handleMarkMessageUnread}
                onShowMessageDetails={setDetailsTarget}
                onDeleteMessage={setDeleteMessageTarget}
                headingRef={headingRef}
              />
            ) : openAddr ? (
              // Deep link to a thread that is not in the inbox (deleted, or
              // still loading the list). Never a blank panel.
              <div className="bg-surface-container flex min-h-0 flex-1 flex-col">
                <SmsStatePanel
                  icon="sms"
                  title={t("sms.center.states.missing.title")}
                  description={t("sms.center.states.missing.description")}
                  action={
                    <Button
                      variant="tonal-neutral"
                      size="sm"
                      onClick={closeThread}
                    >
                      {t("sms.center.states.missing.action")}
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="bg-surface-container flex min-h-0 flex-1 flex-col">
                <SmsStatePanel
                  icon="sms"
                  title={t("sms.center.states.no_selection.title")}
                  description={t("sms.center.states.no_selection.description")}
                />
              </div>
            )}
          </motion.div>
        </Card>
      </motion.div>

      {/* ---- dialogs -------------------------------------------------------- */}
      <SmsComposeDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        onSend={sendSms}
        isSaving={isSaving}
      />

      <SmsSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        smsc={data?.smsc ?? null}
        onSaveSmsc={updateSmsc}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sms.center.delete_thread.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.center.delete_thread.description", {
                contact:
                  allViews.find((v) => v.addr === deleteTarget)?.identity.title ??
                  deleteTarget ??
                  "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteThread();
              }}
            >
              {isDeleting
                ? t("sms.inbox.delete_single_confirm.deleting")
                : t("sms.center.delete_thread.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SmsForwardDialog
        message={forwardTarget}
        threads={allViews}
        onOpenChange={(open) => !open && setForwardTarget(null)}
        onForward={handleForwardSubmit}
      />

      <SmsMessageDetailsDialog
        message={detailsTarget}
        onOpenChange={(open) => !open && setDetailsTarget(null)}
      />

      <AlertDialog
        open={deleteMessageTarget !== null}
        onOpenChange={(open) => !open && setDeleteMessageTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sms.center.delete_message.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.center.delete_message.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMessageTarget ? (
            <blockquote className="bg-surface-container text-on-surface-variant rounded-tile px-3 py-2 text-sm">
              {excerptOf(deleteMessageTarget.content ?? "")}
            </blockquote>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingMessage}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingMessage}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteMessage();
              }}
            >
              {isDeletingMessage
                ? t("sms.inbox.delete_single_confirm.deleting")
                : t("sms.center.delete_message.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteAll} onOpenChange={setShowDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sms.inbox.delete_all_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sms.inbox.delete_all_confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("sms.inbox.delete_all_confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteAll();
              }}
            >
              {isDeleting
                ? t("sms.inbox.delete_all_confirm.deleting")
                : t("sms.inbox.delete_all_confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { copyText } from "@/lib/clipboard";
import type { PendingSmsSend } from "@/hooks/use-sms";
import type { SmsMessage } from "@/types/sms";

import { isOutbound } from "./sms-format";

// =============================================================================
// SmsMessageContextMenu — the per-bubble menu
// =============================================================================
// Right-click (desktop), long-press (Radix's native touch handling) and
// Shift+F10 / the Menu key on a focused bubble all open this. Contents depend
// on what the message actually is:
//
//   * Not yet stored (a pending optimistic send, `queued` / `sending` /
//     `failed`): Copy text only. Everything else here reads a field the
//     backend hasn't recorded yet.
//   * Received: Copy text, Copy code (only when one was detected), Forward,
//     Mark as unread, Details, then Delete.
//   * Sent: Copy text, Forward, Details, then Delete.
//
// "Mark as unread" and "Delete" are OMITTED, never shown disabled, when the
// message lacks the field they need (`identity` / `indexes`): a disabled item
// with no visible reason is worse than not offering it.
// =============================================================================

export interface SmsMessageContextMenuProps {
  /** The stored message, or `undefined` for a not-yet-stored optimistic send. */
  message?: SmsMessage;
  pending?: PendingSmsSend;
  /** One-time code detected in a received body, or null. */
  code: string | null;
  onForward: (message: SmsMessage) => void;
  onMarkUnread: (message: SmsMessage) => void;
  onShowDetails: (message: SmsMessage) => void;
  onDelete: (message: SmsMessage) => void;
  children: React.ReactNode;
}

export function SmsMessageContextMenu({
  message,
  pending,
  code,
  onForward,
  onMarkUnread,
  onShowDetails,
  onDelete,
  children,
}: SmsMessageContextMenuProps) {
  const { t } = useTranslation("cellular");

  const copyMessageText = React.useCallback(async () => {
    const text = message?.content ?? pending?.text ?? "";
    const ok = await copyText(text);
    if (ok) toast.success(t("sms.center.toast.message_copied"));
    else toast.error(t("sms.center.toast.copy_failed"));
  }, [message, pending, t]);

  const copyCode = React.useCallback(async () => {
    if (!code) return;
    const ok = await copyText(code);
    if (ok) toast.success(t("sms.center.code.copied"));
    else toast.error(t("sms.center.toast.copy_failed"));
  }, [code, t]);

  // Not stored yet: nothing below applies to it.
  if (!message) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => void copyMessageText()}>
            <MaterialSymbol name="content_copy" size={16} />
            {t("sms.center.actions.copy_text")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const inbound = !isOutbound(message);
  const canMarkUnread = inbound && Boolean(message.identity);
  const canDelete =
    (message.indexes?.length ?? 0) > 0 ||
    (message.storage === "SENT" && Boolean(message.identity));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void copyMessageText()}>
          <MaterialSymbol name="content_copy" size={16} />
          {t("sms.center.actions.copy_text")}
        </ContextMenuItem>
        {inbound && code ? (
          <ContextMenuItem onSelect={() => void copyCode()}>
            <MaterialSymbol name="content_copy" size={16} />
            {t("sms.center.code.copy")}
            <ContextMenuShortcut className="tabular-nums">
              {code}
            </ContextMenuShortcut>
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onForward(message)}>
          <MaterialSymbol name="forward" size={16} />
          {t("sms.center.actions.forward")}
        </ContextMenuItem>
        {canMarkUnread ? (
          <ContextMenuItem onSelect={() => onMarkUnread(message)}>
            <MaterialSymbol name="mark_email_unread" size={16} />
            {t("sms.center.actions.mark_unread")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onShowDetails(message)}>
          <MaterialSymbol name="info" size={16} />
          {t("sms.center.actions.details")}
        </ContextMenuItem>
        {canDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => onDelete(message)}
            >
              <MaterialSymbol name="delete" size={16} />
              {t("sms.center.actions.delete_message")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

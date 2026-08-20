"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { cn } from "@/lib/utils";

import { DIALOG_ACTION } from "./shapes";
import type { SmsMessage } from "@/types/sms";

// =============================================================================
// MessageDialog — the read view of a single SMS
// =============================================================================
// Two facts from the live device shape this dialog more than the mock does.
//
// 1. EVERY sender on the device is alphanumeric — GLOBE, SMART, TNT, NDRRMC,
//    GLOBE_OTP, SmartApp. Not one is a phone number. Alphanumeric is therefore
//    the DEFAULT case, and Reply is gated on the sender actually being dialable:
//    you cannot reply to a sender ID. The mock offers Reply unconditionally.
//
// 2. `indexes` are real physical slot numbers, they are PER-STORAGE, and both
//    stores start at 0 — ME slot 3 and SM slot 3 are different messages. So a
//    slot is never rendered bare; it is always qualified by its memory. 41% of
//    live messages are multi-part, so `indexes` frequently has length > 1 and
//    the label has to say so.
// =============================================================================

/**
 * Is this sender something the radio can actually address? A sender ID like
 * `GLOBE_OTP` is not, and offering Reply on one produces a send that fails at
 * the modem. Digits with an optional leading `+`, spaces and dashes only.
 */
export function isDialableSender(sender: string): boolean {
  const trimmed = sender.trim();
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 3;
}

interface MessageDialogProps {
  /** The message being viewed; `null` keeps the dialog closed */
  message: SmsMessage | null;
  onClose: () => void;
  /** Opens Compose pre-addressed. Only offered for a dialable sender. */
  onReply: (sender: string) => void;
  onDelete: (message: SmsMessage) => void;
}

export function MessageDialog({
  message,
  onClose,
  onReply,
  onDelete,
}: MessageDialogProps) {
  const { t } = useTranslation("cellular");
  const [copied, setCopied] = React.useState(false);
  const resetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handleCopy = React.useCallback(async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // The app is served over plain HTTP from the modem, and some browsers
      // block the clipboard API outside a secure context — so this path is
      // real, not theoretical.
      toast.error(t("sms.inbox.view_dialog.copy_error"));
    }
  }, [message, t]);

  const canReply = message ? isDialableSender(message.sender) : false;
  const slots = message?.indexes ?? [];

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-[-0.01em]">
            {message?.sender}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs tabular-nums">
                {message?.timestamp}
              </span>
              {message && (
                // A slot is meaningless without its memory, so the tag always
                // carries both. A `Tag`, not a `Badge`: a physical location is
                // metadata, not health (The Two-Form Rule).
                //
                // MONO IS SCOPED TO THE SLOT NUMBERS. The whole string used to
                // carry `font-mono tabular-nums`, so the human word "slot" —
                // and 槽位 / 插槽 / slot in the other four locales — shipped in
                // JetBrains Mono. The memory name stays in the UI voice for the
                // same reason the `SIM` tag beside it does: `ME`/`SM` is a
                // label, while the index is a raw device slot number.
                <Tag variant="neutral" className="flex-none">
                  {withSlot(
                    t(
                      slots.length > 1
                        ? "sms.inbox.view_dialog.slots"
                        : "sms.inbox.view_dialog.slot",
                      {
                        storage: message.storage,
                        slots: SLOT,
                        count: slots.length,
                      },
                    ),
                    <span className="font-mono tabular-nums">
                      {slots.join(", ")}
                    </span>,
                  )}
                </Tag>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="bg-surface-container rounded-tile max-h-[45vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
          {message?.content}
        </div>

        {!canReply && (
          <p className="text-on-surface-variant flex items-start gap-2 text-xs leading-relaxed">
            <MaterialSymbol
              name="info"
              size={14}
              className="mt-px flex-none"
              aria-hidden="true"
            />
            {t("sms.inbox.view_dialog.no_reply_hint")}
          </p>
        )}

        <DialogFooter className="sm:justify-start">
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="tonal-neutral"
              className={DIALOG_ACTION}
              onClick={handleCopy}
            >
              <MaterialSymbol name={copied ? "check" : "content_copy"} size={17} />
              {copied
                ? t("sms.inbox.view_dialog.copied")
                : t("sms.inbox.view_dialog.copy")}
            </Button>

            {canReply && message && (
              <Button
                type="button"
                variant="tonal-neutral"
                className={DIALOG_ACTION}
                onClick={() => onReply(message.sender)}
              >
                <MaterialSymbol name="edit" size={17} />
                {t("sms.inbox.view_dialog.reply")}
              </Button>
            )}

            <Button
              type="button"
              variant="tonal-destructive"
              className={DIALOG_ACTION}
              onClick={() => message && onDelete(message)}
            >
              <MaterialSymbol name="delete" size={17} />
              {t("sms.inbox.table.actions.delete")}
            </Button>

            <Button
              type="button"
              className={cn(DIALOG_ACTION, "ml-auto")}
              onClick={onClose}
            >
              {t("sms.inbox.view_dialog.close")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

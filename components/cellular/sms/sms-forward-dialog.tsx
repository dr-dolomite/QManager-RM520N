"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SmsMessage } from "@/types/sms";

import { isOutbound, segmentInfo } from "./sms-format";
import { IDENTITY_DISC_CLASS } from "./sms-identity";
import type { SmsThreadView } from "./sms-threads";

// =============================================================================
// SmsForwardDialog — "Forward..."
// =============================================================================
// Sends a NEW outbound message through the existing optimistic send queue
// (`queueSend`), never a special "forward" backend action: the modem has no
// concept of forwarding, only sending. "Include original sender" (received
// messages only, default ON) prefixes the RAW stored address, never
// `display_name` (see `types/sms.ts`: `addr` is a key the reader can dial back).
// =============================================================================

/**
 * Destination must be dialable digits (optional leading `+`). Deliberately
 * stricter than `SmsComposeDialog`, which only checks non-empty: a forward is
 * typically aimed at a number typed by hand, and a sender NAME (the
 * alphanumeric chips are disabled for the same reason) can't receive a text.
 * 3 digits is the floor so carrier short codes still pass.
 */
const DEST_PATTERN = /^\+?\d{3,15}$/;

/** How many recent-conversation chips to offer. */
const MAX_RECENTS = 8;

export interface SmsForwardDialogProps {
  /** The message being forwarded. Dialog is open whenever this is non-null. */
  message: SmsMessage | null;
  /** All known threads, newest first: the recent-conversation chip row. */
  threads: SmsThreadView[];
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the destination and final body. Caller sends + closes. */
  onForward: (dest: string, text: string) => void;
}

export function SmsForwardDialog({
  message,
  threads,
  onOpenChange,
  onForward,
}: SmsForwardDialogProps) {
  const { t } = useTranslation("cellular");
  const [dest, setDest] = React.useState("");
  const [body, setBody] = React.useState("");
  const [includeSender, setIncludeSender] = React.useState(true);

  const inbound = message ? !isOutbound(message) : false;
  const originalAddr = message ? message.addr || message.sender : "";
  const prefix = inbound
    ? `${t("sms.center.forward.prefix", { addr: originalAddr })} `
    : "";

  // Reset the form every time a NEW message is handed in (the dialog re-opens
  // for it). Keyed on `message` identity only: re-running this whenever
  // `prefix`/`inbound` (derived from it) recompute would stomp the user's
  // in-progress edits, and a locale change mid-edit must not wipe what they
  // typed. Adjusting state during render, not in an effect, so the first frame
  // of the dialog already shows the seeded body.
  const [seeded, setSeeded] = React.useState<SmsMessage | null>(null);
  if (message !== seeded) {
    setSeeded(message);
    if (message) {
      setDest("");
      setIncludeSender(true);
      setBody(`${prefix}${message.content ?? ""}`);
    }
  }

  const toggleSender = (checked: boolean) => {
    setIncludeSender(checked);
    setBody((prev) => {
      if (checked) return prev.startsWith(prefix) ? prev : `${prefix}${prev}`;
      return prev.startsWith(prefix) ? prev.slice(prefix.length) : prev;
    });
  };

  const seg = segmentInfo(body);
  const trimmedDest = dest.trim();
  const isValid = DEST_PATTERN.test(trimmedDest) && body.trim().length > 0;

  const recents = React.useMemo(
    () => threads.filter((v) => v.addr !== originalAddr).slice(0, MAX_RECENTS),
    [threads, originalAddr],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onForward(trimmedDest, body);
  };

  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sms.center.forward.title")}</DialogTitle>
          <DialogDescription>
            {t("sms.center.forward.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms-forward-to">
              {t("sms.center.forward.to_label")}
            </Label>
            <Input
              id="sms-forward-to"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder={t("sms.compose.fields.phone_placeholder")}
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="font-mono tabular-nums"
            />
            {recents.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {recents.map((view) => {
                  const disabled = view.identity.kind === "alphanumeric";
                  return (
                    <button
                      key={view.addr}
                      type="button"
                      disabled={disabled}
                      title={
                        disabled
                          ? t("sms.center.forward.alpha_disabled")
                          : undefined
                      }
                      onClick={() => setDest(view.addr)}
                      aria-pressed={trimmedDest === view.addr}
                      className={cn(
                        "rounded-pill focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 items-center gap-1.5 pr-2.5 pl-1 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11",
                        trimmedDest === view.addr
                          ? "bg-primary-container text-on-primary-container"
                          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-5 flex-none place-items-center rounded-full text-[0.5625rem] font-bold",
                          IDENTITY_DISC_CLASS[view.identity.tone],
                        )}
                      >
                        {view.identity.initials ?? (
                          <MaterialSymbol name="account_circle" size={12} />
                        )}
                      </span>
                      <span
                        className={
                          view.identity.kind === "msisdn"
                            ? "font-mono tabular-nums"
                            : undefined
                        }
                      >
                        {view.identity.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {inbound ? (
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm leading-none font-medium">
                  {t("sms.center.forward.include_sender")}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {t("sms.center.forward.include_sender_hint", {
                    addr: originalAddr,
                  })}
                </p>
              </div>
              <SegmentedField
                value={includeSender ? "on" : "off"}
                onValueChange={(v) => toggleSender(v === "on")}
                options={[
                  { value: "off", label: t("state.off", { ns: "common" }) },
                  { value: "on", label: t("state.on", { ns: "common" }) },
                ]}
                ariaLabel={t("sms.center.forward.include_sender")}
                breakpoint="never"
                glyph={(cls) => (
                  <MaterialSymbol name="check" size={16} className={cls} />
                )}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="sms-forward-body">
              {t("sms.compose.fields.message_label")}
            </Label>
            <Textarea
              id="sms-forward-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="resize-none"
            />
            {seg.visible ? (
              <p
                aria-live="polite"
                className="text-on-surface-variant text-xs font-medium"
              >
                <span className="tabular-nums">
                  {t("sms.center.composer.segments", { count: seg.segments })}
                </span>
                {` (${
                  seg.ucs2
                    ? t("sms.compose.encoding.ucs2")
                    : t("sms.compose.encoding.gsm7")
                })`}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={!isValid}>
              <MaterialSymbol name="forward" size={16} />
              {t("sms.center.forward.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

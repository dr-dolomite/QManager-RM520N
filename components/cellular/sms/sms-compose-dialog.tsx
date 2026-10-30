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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { smsSegments } from "@/lib/sms-segments";
import type { SmsSendResult } from "@/types/sms";


// =============================================================================
// SmsComposeDialog — compose and send
// =============================================================================
// Encoding and part count come from smsSegments, which mirrors the qsms encoder.
// =============================================================================

interface SmsComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (phone: string, message: string) => Promise<SmsSendResult>;
  isSaving: boolean;
  /** Pre-addresses the dialog when it is opened from a message's Reply action. */
  initialPhone?: string;
}

export default function SmsComposeDialog({
  open,
  onOpenChange,
  onSend,
  isSaving,
  initialPhone = "",
}: SmsComposeDialogProps) {
  const { t } = useTranslation("cellular");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");

  const segments = smsSegments(message);
  const isUcs2 = segments.encoding === "ucs2";
  const maxChars = segments.perPart * segments.parts;
  const charCount = segments.units;
  const isOverLimit = segments.parts > 1;
  const isNearLimit = !isOverLimit && charCount > segments.perPart * 0.9;

  const isValid = phone.trim().length > 0 && message.trim().length > 0;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    const result = await onSend(phone.trim(), message);
    if (result.success) {
      toast.success(t("sms.compose.toast.success"));
      setPhone("");
      setMessage("");
      onOpenChange(false);
    } else if (result.sentParts > 0) {
      toast.error(
        t("sms.compose.toast.partial", {
          sent: result.sentParts,
          parts: result.parts,
        }),
      );
    } else {
      toast.error(t("sms.compose.toast.error"));
    }
  };

  // Reset on open. `initialPhone` is what makes Reply work — the dialog is
  // pre-addressed only when it was opened from a dialable sender.
  React.useEffect(() => {
    if (open) {
      setPhone(initialPhone);
      setMessage("");
    }
  }, [open, initialPhone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-[-0.01em]">
            {t("sms.compose.title")}
          </DialogTitle>
          <DialogDescription>{t("sms.compose.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSend} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sms-phone" className="text-xs font-semibold">
              {t("sms.compose.fields.phone_label")}
            </Label>
            <Input
              id="sms-phone"
              type="tel"
              inputMode="tel"
              placeholder={t("sms.compose.fields.phone_placeholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSaving}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="sms-message" className="text-xs font-semibold">
                {t("sms.compose.fields.message_label")}
              </Label>
              <span className="ml-auto flex items-center gap-2">
                {/* An encoding is a CAPABILITY — what the payload IS, not
                    whether it is well — which `components/ui/tag.tsx` names
                    verbatim as tag territory (The Two-Form Rule). It was a
                    filled `Badge variant="secondary"`. */}
                <Tag variant="neutral">
                  {isUcs2
                    ? t("sms.compose.encoding.ucs2")
                    : t("sms.compose.encoding.gsm7")}
                </Tag>
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-semibold tabular-nums",
                    isOverLimit
                      ? "text-destructive-on-surface"
                      : isNearLimit
                        ? "text-warning-on-surface"
                        : "text-on-surface-variant",
                  )}
                >
                  {/* The near-limit step used to change COLOUR AND NOTHING
                      ELSE, so for a colour-blind reader it did not exist at
                      all. It now carries a glyph too, and the two escalations
                      take DIFFERENT glyphs: two states in one slot must never
                      share one. */}
                  {(isNearLimit || isOverLimit) && (
                    <MaterialSymbol
                      name={isOverLimit ? "error" : "warning"}
                      filled
                      size={13}
                      className="flex-none"
                      aria-hidden="true"
                    />
                  )}
                  {t("sms.compose.fields.char_counter", {
                    count: charCount,
                    max: maxChars,
                  })}
                </span>
              </span>
            </div>
            <Textarea
              id="sms-message"
              placeholder={t("sms.compose.fields.message_placeholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSaving}
              rows={4}
              aria-invalid={isOverLimit || undefined}
              aria-describedby="sms-message-hint"
              className="min-h-[6.5rem] resize-none px-4 py-3.5"
            />
            <p
              id="sms-message-hint"
              className={cn(
                "flex items-start gap-2 text-xs leading-relaxed",
                isOverLimit
                  ? "text-destructive-on-surface font-medium"
                  : "text-on-surface-variant",
              )}
            >
              <MaterialSymbol
                name={isOverLimit ? "warning" : "info"}
                size={14}
                className="mt-px flex-none"
                aria-hidden="true"
              />
              {isOverLimit
                ? t("sms.compose.limit_warning", { parts: segments.parts })
                : t("sms.compose.encoding_hint")}
            </p>
          </div>

          {isSaving && (
            // A send has no progress signal, so this says what is happening instead.
            <div
              role="status"
              className="bg-primary-container text-on-primary-container rounded-field flex items-center gap-3 px-4 py-3"
            >
              <MaterialSymbol
                name="progress_activity"
                size={18}
                className="flex-none motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold">
                {t("sms.compose.sending_note")}
              </span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="tonal"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              size="action"
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !isValid}
              size="action"
            >
              {isSaving ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="motion-safe:animate-spin"
                  />
                  {t("sms.compose.buttons.sending")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="send" size={18} />
                  {t("sms.compose.buttons.send")}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

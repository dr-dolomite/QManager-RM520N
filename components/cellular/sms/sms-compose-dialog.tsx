"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { smsErrorMessage, type SmsActionResult } from "@/hooks/use-sms";
import { DUR, EASE_QUICK } from "@/lib/motion";

import { segmentInfo } from "./sms-format";

// =============================================================================
// SmsComposeDialog — start a NEW conversation
// =============================================================================
// Replying inside an existing thread is the composer at the foot of the
// conversation pane; this dialog exists only for the case where there is no
// thread yet and the user has to name a destination.
// =============================================================================

interface SmsComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (phone: string, message: string) => Promise<SmsActionResult>;
  isSaving: boolean;
}

export default function SmsComposeDialog({
  open,
  onOpenChange,
  onSend,
  isSaving,
}: SmsComposeDialogProps) {
  const { t } = useTranslation("cellular");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");

  const seg = segmentInfo(message);
  const isValid = phone.trim().length > 0 && message.trim().length > 0;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    const result = await onSend(phone.trim(), message);
    if (result.ok) {
      toast.success(t("sms.compose.toast.success"));
      setPhone("");
      setMessage("");
      onOpenChange(false);
    } else {
      toast.error(smsErrorMessage(t, result, t("sms.errors.send")));
    }
  };

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setPhone("");
      setMessage("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sms.compose.title")}</DialogTitle>
          <DialogDescription>{t("sms.compose.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms-phone">
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
          <div className="space-y-2">
            <Label htmlFor="sms-message">
              {t("sms.compose.fields.message_label")}
            </Label>
            <Textarea
              id="sms-message"
              placeholder={t("sms.compose.fields.message_placeholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSaving}
              rows={4}
              className="resize-none"
            />
            {/* Same rule as the in-thread composer: the counter appears at the
                first boundary, not before. */}
            <AnimatePresence initial={false}>
              {seg.visible ? (
                <motion.p
                  key="segments"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.quick, ease: EASE_QUICK }}
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
                  {seg.ucs2 ? ` ${t("sms.compose.encoding_hint")}` : null}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={isSaving || !isValid}>
              {isSaving ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={16}
                    className="motion-safe:animate-spin"
                  />
                  {t("sms.compose.buttons.sending")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="send" size={16} />
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

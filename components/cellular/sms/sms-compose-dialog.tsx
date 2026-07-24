"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// =============================================================================
// SmsComposeDialog — Dialog for composing and sending SMS messages
// =============================================================================

interface SmsComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (phone: string, message: string) => Promise<boolean>;
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

  // Character count and encoding detection
  const isUcs2 = /[^\x00-\x7F]/.test(message);
  const maxChars = isUcs2 ? 70 : 160;
  const charCount = message.length;
  const isOverLimit = charCount > maxChars;

  const isValid = phone.trim().length > 0 && message.trim().length > 0;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValid) return;

    const success = await onSend(phone.trim(), message);
    if (success) {
      toast.success(t("sms.compose.toast.success"));
      setPhone("");
      setMessage("");
      onOpenChange(false);
    } else {
      toast.error(t("sms.compose.toast.error"));
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
          <DialogDescription>
            {t("sms.compose.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms-phone">{t("sms.compose.fields.phone_label")}</Label>
            <Input
              id="sms-phone"
              type="tel"
              placeholder={t("sms.compose.fields.phone_placeholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sms-message">{t("sms.compose.fields.message_label")}</Label>
              <span
                className={`text-xs ${
                  isOverLimit
                    ? "text-destructive font-medium"
                    : charCount > maxChars * 0.9
                      ? "text-warning"
                      : "text-muted-foreground"
                }`}
              >
                {t("sms.compose.fields.char_counter", { count: charCount, max: maxChars })}
                {isUcs2 && t("sms.compose.unicode_indicator")}
              </span>
            </div>
            <Textarea
              id="sms-message"
              placeholder={t("sms.compose.fields.message_placeholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSaving}
              rows={4}
              className="resize-none"
            />
            {isOverLimit && (
              <p className="text-xs text-destructive">
                {t("sms.compose.limit_warning")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={isSaving || !isValid}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("sms.compose.buttons.sending")}
                </>
              ) : (
                t("sms.compose.buttons.send")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

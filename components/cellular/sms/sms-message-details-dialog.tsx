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
import type { SmsAddrKind, SmsMessage } from "@/types/sms";

import { isOutbound, smsEpochMs } from "./sms-format";

// =============================================================================
// SmsMessageDetailsDialog — "Details..."
// =============================================================================
// ONLY real fields, deliberately: From/To (the raw stored address), the
// resolved display name when it differs, the sender type, the full localized
// date and time, and the body's character count. NO encoding, NO part count,
// NO storage slots: that is detail the payload does not carry per message.
// =============================================================================

const ADDR_KIND_LABEL: Record<SmsAddrKind, string> = {
  msisdn: "sms.center.details.kind.msisdn",
  shortcode: "sms.center.details.kind.shortcode",
  alphanumeric: "sms.center.details.kind.alphanumeric",
};

export interface SmsMessageDetailsDialogProps {
  /** The message to show details for. Dialog is open whenever this is non-null. */
  message: SmsMessage | null;
  onOpenChange: (open: boolean) => void;
}

export function SmsMessageDetailsDialog({
  message,
  onOpenChange,
}: SmsMessageDetailsDialogProps) {
  const { t, i18n } = useTranslation("cellular");

  const outbound = message ? isOutbound(message) : false;
  const addr = message?.addr || message?.sender || "";
  const displayName = message?.display_name?.trim();
  const hasResolvedName = Boolean(displayName && displayName !== addr);
  const kindKey = message?.addr_kind ? ADDR_KIND_LABEL[message.addr_kind] : null;

  const epochMs = message ? smsEpochMs(message) : 0;
  const timestampLabel = epochMs
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "long",
        timeStyle: "short",
      }).format(epochMs)
    : "";
  const charCount = message?.content?.length ?? 0;

  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sms.center.details.title")}</DialogTitle>
          <DialogDescription>
            {t("sms.center.details.description")}
          </DialogDescription>
        </DialogHeader>

        {message ? (
          <dl className="grid gap-3 text-sm">
            <DetailRow
              label={t(outbound ? "sms.center.details.to" : "sms.center.details.from")}
            >
              <span className="font-mono break-all">{addr}</span>
              {hasResolvedName ? (
                <span className="text-on-surface-variant block text-xs">
                  {displayName}
                </span>
              ) : null}
            </DetailRow>

            {kindKey ? (
              <DetailRow label={t("sms.center.details.sender_type")}>
                {t(kindKey)}
              </DetailRow>
            ) : null}

            <DetailRow
              label={t(
                outbound
                  ? "sms.center.details.sent_at"
                  : "sms.center.details.received_at",
              )}
            >
              <span className="tabular-nums">{timestampLabel}</span>
            </DetailRow>

            <DetailRow label={t("sms.center.details.length")}>
              <span className="tabular-nums">
                {t("sms.center.details.length_value", { count: charCount })}
              </span>
            </DetailRow>
          </dl>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("sms.center.details.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-on-surface-variant flex-none">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

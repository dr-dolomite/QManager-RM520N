"use client";

import React, { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSmsStorage,
  type SmsStorageChoice,
  type SmsStorageData,
  type SmsStorageUsage,
} from "@/hooks/use-sms-storage";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { SmscConfig } from "@/types/sms";

// =============================================================================
// SmsSettingsDialog — the SMS inbox's two device settings, opened from the
// header menu
// =============================================================================
// 1. Provider number (the SMS service center): the carrier number that routes
//    outgoing messages. Optional "+", then 3 to 20 digits — the same rule the
//    backend enforces, checked here first so a typo never costs a round trip.
// 2. Message storage: where NEW messages are saved (modem or SIM). The choice
//    only routes new messages; the inbox keeps reading both, so nothing moves
//    when it changes. A storage that is filling up earns a chip (warning at
//    90%, destructive when full); a SIM store that can't be read disables the
//    SIM option unless it is already the saved choice.
//
// Dialogs are exempt from the Card-Foot Apply Rule, so each section keeps its
// own Save. The body mounts with the dialog content, so the storage read only
// happens when the dialog is opened.
// =============================================================================

const NEARLY_FULL = 0.9;
/** An optional leading "+", then 3 to 20 digits and nothing else. */
const SMSC_PATTERN = /^\+?\d{3,20}$/;
const ROW = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm";
const STORAGES: SmsStorageChoice[] = ["ME", "SM"];

export interface SmsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provider number as read from the inbox; `null` when it could not be read. */
  smsc: SmscConfig | null;
  onSaveSmsc: (addr: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SmsSettingsDialog({
  open,
  onOpenChange,
  smsc,
  onSaveSmsc,
}: SmsSettingsDialogProps) {
  const { t } = useTranslation("cellular");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sms.settings.title")}</DialogTitle>
          <DialogDescription>{t("sms.settings.description")}</DialogDescription>
        </DialogHeader>
        <ProviderNumberSection smsc={smsc} onSaveSmsc={onSaveSmsc} />
        <Separator />
        <StorageSection />
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Provider number                                                            */
/* -------------------------------------------------------------------------- */

function ProviderNumberSection({
  smsc,
  onSaveSmsc,
}: Pick<SmsSettingsDialogProps, "smsc" | "onSaveSmsc">) {
  const { t } = useTranslation("cellular");
  const formId = useId();
  const inputId = useId();
  const { saved, markSaved } = useSaveFlash();
  const [isSaving, setIsSaving] = useState(false);
  const serverAddr = smsc?.addr ?? "";
  const [prevAddr, setPrevAddr] = useState(serverAddr);
  const [value, setValue] = useState(serverAddr);

  // Sync server -> local during render (React-Compiler safe): a refreshed
  // number replaces the field, so it never shows a stale draft after a save.
  if (serverAddr !== prevAddr) {
    setPrevAddr(serverAddr);
    setValue(serverAddr);
  }

  const trimmed = value.trim();
  const isDirty = trimmed !== serverAddr;
  const isValid = SMSC_PATTERN.test(trimmed);
  const showInvalid = trimmed.length > 0 && !isValid;
  const canSave = isDirty && isValid && !isSaving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    const result = await onSaveSmsc(trimmed);
    setIsSaving(false);
    if (result.ok) {
      markSaved();
      toast.success(t("sms.settings.smsc.toast_saved"));
    } else {
      toast.error(
        resolveErrorMessage(t, result.error, undefined, t("sms.settings.smsc.save_failed")),
      );
    }
  };

  return (
    <form id={formId} className="grid gap-3" onSubmit={handleSave}>
      <Field>
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={inputId}>{t("sms.settings.smsc.title")}</FieldLabel>
          <HintIcon label={t("sms.settings.smsc.hint_label")}>
            {t("sms.settings.smsc.hint")}
          </HintIcon>
        </div>
        <FieldDescription>{t("sms.settings.smsc.description")}</FieldDescription>
        <Input
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("sms.settings.smsc.placeholder")}
          disabled={isSaving}
          aria-invalid={showInvalid || undefined}
          className="font-mono tabular-nums"
        />
        {showInvalid ? (
          <FieldError>{t("sms.settings.smsc.invalid")}</FieldError>
        ) : smsc === null ? (
          <FieldDescription>{t("sms.settings.smsc.unreadable")}</FieldDescription>
        ) : null}
      </Field>
      <div className="flex justify-end">
        <SaveButton
          type="submit"
          form={formId}
          isSaving={isSaving}
          saved={saved}
          disabled={!canSave}
          size="action"
        />
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Message storage                                                            */
/* -------------------------------------------------------------------------- */

function UsageChip({ usage }: { usage: SmsStorageUsage }) {
  const { t } = useTranslation("cellular");
  if (usage.total <= 0) return null;
  if (usage.used >= usage.total) {
    return (
      <Badge variant="destructive">
        <MaterialSymbol name="error" size={12} />
        {t("sms.storage.full")}
      </Badge>
    );
  }
  if (usage.used / usage.total >= NEARLY_FULL) {
    return (
      <Badge variant="warning">
        <MaterialSymbol name="warning" size={12} />
        {t("sms.storage.nearly_full")}
      </Badge>
    );
  }
  return null;
}

function StorageSection() {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isSaving, error, save, refresh } = useSmsStorage();
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();
  const [prevData, setPrevData] = useState<SmsStorageData | null>(null);
  const [choice, setChoice] = useState<SmsStorageChoice>("ME");

  // Sync server -> local during render (React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setChoice(data.storage);
  }

  const heading = (
    <div className="grid gap-1">
      <h3 className="text-sm leading-none font-medium">{t("sms.storage.card_title")}</h3>
      <p className="text-muted-foreground text-sm">{t("sms.storage.card_description")}</p>
    </div>
  );

  if (isLoading) {
    return (
      <section className="grid gap-4" aria-busy="true">
        {heading}
        <Skeleton className="h-[2.625rem] w-44 rounded-pill" />
        <div className="grid gap-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-[2.625rem] w-32 rounded-pill" />
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="grid gap-4">
        {heading}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{error ?? t("sms.storage.load_failed")}</span>
          <Button variant="tonal-neutral" size="sm" onClick={refresh}>
            <MaterialSymbol name="refresh" size={16} />
            {t("common:actions.retry")}
          </Button>
        </div>
      </section>
    );
  }

  const simReadable = !!data.usage.SM;
  const isDirty = choice !== data.storage;
  const canSave = isDirty && !isSaving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const result = await save(choice);
    if (result.ok) {
      markSaved();
      toast.success(t("sms.storage.toast_saved"));
    } else {
      toast.error(result.error);
    }
  };

  return (
    <section className="grid gap-4">
      {heading}
      <form id={formId} className="grid gap-5" onSubmit={handleSave}>
        <Field>
          <div className="flex items-center gap-1.5">
            <FieldLabel>{t("sms.storage.field_label")}</FieldLabel>
            <HintIcon label={t("sms.storage.hint_label")}>{t("sms.storage.hint")}</HintIcon>
          </div>
          <SegmentedField
            value={choice}
            onValueChange={(v) => setChoice(v as SmsStorageChoice)}
            options={[
              { value: "ME", label: t("sms.storage.option_modem") },
              {
                value: "SM",
                label: t("sms.storage.option_sim"),
                disabled: !simReadable && data.storage !== "SM",
              },
            ]}
            ariaLabel={t("sms.storage.field_label")}
            breakpoint="never"
            className="w-fit"
            glyph={(className) => <MaterialSymbol name="check" size={16} className={className} />}
          />
        </Field>

        <div className="grid gap-2">
          {STORAGES.map((s) => {
            const usage = data.usage[s];
            return (
              <div key={s} className={ROW}>
                <span className="text-muted-foreground">
                  {s === "ME" ? t("sms.storage.row_modem") : t("sms.storage.row_sim")}
                </span>
                <span className="flex items-center gap-2">
                  {usage ? <UsageChip usage={usage} /> : null}
                  <span className="text-on-surface font-medium tabular-nums">
                    {usage
                      ? t("sms.storage.used_of_total", { used: usage.used, total: usage.total })
                      : t("sms.storage.unavailable")}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="action"
            onClick={() => setChoice(data.storage)}
            disabled={!isDirty || isSaving}
          >
            {t("common:actions.discard")}
          </Button>
          <SaveButton
            type="submit"
            isSaving={isSaving}
            saved={saved}
            disabled={!canSave}
            size="action"
          />
        </div>
      </form>
    </section>
  );
}

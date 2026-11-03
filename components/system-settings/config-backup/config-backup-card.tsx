"use client";

import { useId, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArchiveXIcon,
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardFoot } from "@/components/ui/card-foot";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MIN_PASSPHRASE_LEN,
  useConfigBackup,
  type UseBackupSupportReturn,
} from "@/hooks/use-config-backup";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import {
  effectiveKeys,
  initialSelection,
  SECTION_KEYS,
} from "@/lib/config-backup/sections";
import { cn } from "@/lib/utils";
import type { BackupSectionKey } from "@/types/config-backup";

import { ConditionBlock } from "../condition-block";
import {
  BACKUP_SKELETON,
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  CONDITION_PANEL,
  FIELD,
  MATCH,
  PICK,
  PILL_GLYPH,
  ROW,
  ROW_GROUP,
  STACK_ROW,
} from "../shapes";
import { SectionPicker } from "./section-picker";

const K = "config_backup.create";

/** The create card's passphrase field; the restore card links here. */
export const BACKUP_PASSPHRASE_ID = "backup-passphrase";

// These rows never flip, so the field always fills the row.
const FIELD_GROUP = cn(FIELD, "@2xl/card:w-full");
const FIELD_TOGGLE = `text-on-surface-variant hover:text-on-surface ${COARSE_TARGET}`;

interface PassphraseRowProps {
  id: string;
  label: string;
  consequence?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  describedBy?: string;
  children?: ReactNode;
}

function PassphraseRow({
  id,
  label,
  consequence,
  value,
  onChange,
  disabled,
  describedBy,
  children,
}: PassphraseRowProps) {
  const { t } = useTranslation("system-settings");
  const [visible, setVisible] = useState(false);
  const Glyph = visible ? EyeOffIcon : EyeIcon;

  return (
    <div className={STACK_ROW}>
      <div className={ROW.TEXT}>
        <label htmlFor={id} className={ROW.LABEL}>
          {label}
        </label>
        {consequence ? <span className={ROW.CONSEQUENCE}>{consequence}</span> : null}
      </div>
      <div className="relative w-full">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          host="container"
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn(FIELD_GROUP, "pr-11")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(FIELD_TOGGLE, "absolute top-1/2 right-1.5 -translate-y-1/2")}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={t(visible ? `${K}.passphrase_hide_aria` : `${K}.passphrase_show_aria`)}
        >
          <Glyph className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {children}
    </div>
  );
}

/** The picker's loading geometry: real `PICK.ROW`s with slivers inside. */
function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className={cn(BACKUP_SKELETON.LABEL, "mx-1 my-1.5")} />
      <div className={ROW_GROUP}>
        {Array.from({ length: BACKUP_SKELETON.ROWS }, (_, i) => (
          <div key={i} className={PICK.ROW}>
            <Skeleton className={BACKUP_SKELETON.BOX} />
            <Skeleton className={BACKUP_SKELETON.NAME} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface ConfigBackupCardProps {
  support: UseBackupSupportReturn;
}

const ConfigBackupCard = ({ support }: ConfigBackupCardProps) => {
  const { t } = useTranslation("system-settings");
  const confirmHintId = useId();
  const [selection, setSelection] = useState(initialSelection);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  // Bumped after a download to remount the passphrase rows, re-hiding a revealed field.
  const [formKey, setFormKey] = useState(0);
  const { runBackup, stage } = useConfigBackup();

  const { supported } = support;
  const keys: BackupSectionKey[] = useMemo(
    () => (supported ? SECTION_KEYS.filter((k) => supported.has(k)) : []),
    [supported],
  );
  const effective = useMemo(() => effectiveKeys(selection, supported), [selection, supported]);

  const busy = stage !== "idle";
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LEN;
  const matches = passphrase === confirm;
  const passphraseOk = passphrase.length >= MIN_PASSPHRASE_LEN && matches;
  const ready = supported !== null && keys.length > 0;
  const canDownload = ready && effective.length > 0 && passphraseOk && !busy;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canDownload) return;
    const result = await runBackup(effective, passphrase);
    if (result.ok) {
      if (result.unavailable.length > 0) {
        toast.warning(t(`${K}.toast_unavailable`, { count: result.unavailable.length }));
      } else {
        toast.success(t(`${K}.toast_success`));
      }
      setPassphrase("");
      setConfirm("");
      setFormKey((k) => k + 1);
    } else {
      toast.error(resolveErrorMessage(t, result.code, null, t(`${K}.toast_failed`)));
    }
  };

  let body: ReactNode;
  if (support.isLoading && !supported) {
    body = <PickerSkeleton />;
  } else if (!supported) {
    body = (
      <ConditionBlock
        tone="destructive"
        glyph={CircleAlertIcon}
        ariaRole="alert"
        title={t(`${K}.load_failed_title`)}
        description={t(`${K}.load_failed_description`)}
        onRetry={() => void support.refresh()}
        retryLabel={t("common:actions.retry")}
        className={CONDITION_PANEL.SCREEN}
      />
    );
  } else if (keys.length === 0) {
    body = (
      <ConditionBlock
        tone="neutral"
        glyph={ArchiveXIcon}
        ariaRole="status"
        title={t(`${K}.empty_title`)}
        description={t(`${K}.empty_description`)}
        className={CONDITION_PANEL.SCREEN}
      />
    );
  } else {
    body = (
      <>
        <SectionPicker
          idPrefix="backup-section"
          keys={keys}
          selection={selection}
          onChange={(key, checked) => setSelection((prev) => ({ ...prev, [key]: checked }))}
          busy={busy}
        />
        <p className={cn(PICK.WHY, "px-1")}>{t("config_backup.excluded")}</p>
      </>
    );
  }

  const status = busy ? (
    <span className="inline-flex items-center gap-2">
      <Loader2Icon className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
      {t(`${K}.stage_${stage}`)}
    </span>
  ) : ready ? (
    <span className="tabular-nums">{t(`${K}.selected_count`, { count: effective.length })}</span>
  ) : null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>{t(`${K}.card_description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form onSubmit={handleSubmit} className={cn(CARD_BODY, "gap-5")}>
          {body}

          <fieldset className="flex flex-col gap-2" disabled={!ready}>
            <legend className={cn(PICK.LABEL, "mb-2")}>{t(`${K}.group_encryption`)}</legend>
            <div key={formKey} className={ROW_GROUP}>
              <PassphraseRow
                id={BACKUP_PASSPHRASE_ID}
                label={t(`${K}.passphrase_label`)}
                consequence={t(tooShort ? `${K}.passphrase_too_short` : `${K}.warning`, {
                  min: MIN_PASSPHRASE_LEN,
                })}
                value={passphrase}
                onChange={setPassphrase}
                disabled={busy || !ready}
              />
              <PassphraseRow
                id="backup-passphrase-confirm"
                label={t(`${K}.confirm_label`)}
                value={confirm}
                onChange={setConfirm}
                disabled={busy || !ready}
                describedBy={confirm.length > 0 ? confirmHintId : undefined}
              >
                {confirm.length > 0 ? (
                  <p id={confirmHintId} className={cn(MATCH.ROOT, matches ? MATCH.OK : MATCH.BAD)}>
                    {matches ? (
                      <CheckIcon className={MATCH.GLYPH} aria-hidden="true" />
                    ) : (
                      <XIcon className={MATCH.GLYPH} aria-hidden="true" />
                    )}
                    {t(matches ? `${K}.confirm_match` : `${K}.confirm_mismatch`)}
                  </p>
                ) : null}
              </PassphraseRow>
            </div>
          </fieldset>

          <CardFoot
            className="mt-auto"
            status={status}
            actions={
              <Button type="submit" size="action" disabled={!canDownload}>
                {busy ? (
                  <Loader2Icon className={cn(PILL_GLYPH, "motion-safe:animate-spin")} aria-hidden="true" />
                ) : (
                  <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
                )}
                {t(`${K}.button_default`)}
              </Button>
            }
          />
        </form>
      </CardContent>
    </Card>
  );
};

export default ConfigBackupCard;

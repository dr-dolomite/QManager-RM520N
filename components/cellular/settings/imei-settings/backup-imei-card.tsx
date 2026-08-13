"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { validateImei } from "@/lib/imei-utils";
import { cn } from "@/lib/utils";
import type { BackupImeiConfig } from "@/types/imei-settings";

import SettingRow from "../setting-row";
import {
  CARD_PAD,
  CARD_SHELL,
  FIELD_SHELL,
  FIELD_SHELL_ON_FILL,
  INLINE_ERROR,
  PILL_ACTION,
  ROW_GROUP,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// Backup IMEI — the second identifier
// =============================================================================
// One row at rest ("Keep a backup"), because at rest there is exactly one
// decision to make. Turning it on reveals the row that decision creates — the
// identifier itself. Progressive disclosure rather than a permanently mounted
// field that is disabled 90% of the time.
//
// THE LUHN GATE, AND FIELD PARITY. This field had no `aria-invalid`, no
// `FieldError`, and validated with the same bare `/^\d{15}$/` shape regex as the
// device field — so a Luhn-invalid backup identifier could be persisted, and the
// only thing that ever told the user was a toast. It now runs `validateImei()`
// and reports inline, exactly like the device field, because the two fields do
// the same job and a user who learns one should not have to learn the other.
//
// The field shape comes from the shared `FIELD_SHELL` / `FIELD_SHELL_ON_FILL`
// pair in `../shapes`, which is also where the note about not using
// `components/ui/input.tsx` lives. The pair is not optional here: typing in this
// field is what promotes its row, so the neutral shell alone would paint a dead
// grey hole in the brand fill for the whole edit.
// =============================================================================

export interface BackupIMEICardProps {
  backupEnabled: boolean | null;
  backupImei: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (config: BackupImeiConfig) => Promise<boolean>;
}

const BackupIMEICard = ({
  backupEnabled,
  backupImei,
  isLoading,
  isSaving,
  onSave,
}: BackupIMEICardProps) => {
  const { t } = useTranslation("cellular");
  const K = "core_settings.imei.backup";

  const { saved, markSaved } = useSaveFlash();
  const [enabled, setEnabled] = React.useState(false);
  const [imei, setImei] = React.useState("");
  const [explainOpen, setExplainOpen] = React.useState(false);

  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    if (backupEnabled === null && backupImei === null) return;
    seededRef.current = true;
    setEnabled(backupEnabled ?? false);
    setImei(backupImei ?? "");
  }, [backupEnabled, backupImei]);

  const storedEnabled = backupEnabled ?? false;
  const storedImei = backupImei ?? "";

  const isComplete = /^\d{15}$/.test(imei);
  const isLuhnValid = validateImei(imei);
  const shapeError = enabled && imei.length > 0 && !isComplete;
  const luhnError = enabled && isComplete && !isLuhnValid;

  const hasChanged = enabled !== storedEnabled || imei !== storedImei;
  // Hoisted, because the row's promotion and the field's own fill are ONE fact.
  const valueDirty = imei !== storedImei;
  const canSave =
    hasChanged && !isSaving && (!enabled || (isComplete && isLuhnValid));

  const handleToggle = (next: boolean) => {
    // Turning this ON arms an automatic identity swap and an automatic reboot,
    // so it is explained before it is armed. Turning it OFF is not a decision
    // that needs a dialog.
    if (next) {
      setExplainOpen(true);
      return;
    }
    setEnabled(false);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImei(event.target.value.replace(/\D/g, "").slice(0, 15));
  };

  const handleReset = () => {
    setEnabled(storedEnabled);
    setImei(storedImei);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;

    const success = await onSave({ enabled, imei });
    if (!success) {
      toast.error(t(`${K}.toasts.failed`));
      return;
    }
    markSaved();
    toast.success(t(`${K}.toasts.saved`));
  };

  // --- Loading ---------------------------------------------------------------

  if (isLoading) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${K}.title`)}</CardTitle>
          <CardDescription>{t(`${K}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className={ROW_GROUP.ROOT}>
            <SettingRow
              label={t(`${K}.rows.keep.label`)}
              // The consequence reports the STORED state, not the draft: it is
              // the sentence that tells the user what the device is doing right
              // now, and the draft's own pendingness is already carried by the
              // row's promotion.
              consequence={
                storedEnabled && storedImei
                  ? t(`${K}.rows.keep.consequence_on`, { imei: storedImei })
                  : t(`${K}.rows.keep.consequence_off`)
              }
              dirty={enabled !== storedEnabled}
              labelId="backup-imei-toggle-label"
              control={
                <Switch
                  id="backup-imei-toggle"
                  checked={enabled}
                  onCheckedChange={handleToggle}
                  disabled={isSaving}
                  aria-labelledby="backup-imei-toggle-label"
                />
              }
            />

            {enabled ? (
              <>
                <div className={ROW_GROUP.DIVIDER} />
                <SettingRow
                  label={t(`${K}.rows.value.label`)}
                  consequence={t(`${K}.rows.value.consequence`)}
                  dirty={valueDirty}
                  labelId="backup-imei-value-label"
                  control={
                    <div className="flex w-full items-center gap-2.5 @2xl/card:w-auto">
                      <input
                        id="backup-imei-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={15}
                        value={imei}
                        onChange={handleChange}
                        disabled={isSaving}
                        placeholder={t(`${K}.rows.value.placeholder`)}
                        aria-labelledby="backup-imei-value-label"
                        aria-invalid={shapeError || luhnError}
                        aria-describedby={
                          shapeError
                            ? "backup-imei-shape-error"
                            : luhnError
                              ? "backup-imei-luhn-error"
                              : undefined
                        }
                        className={cn(
                          valueDirty ? FIELD_SHELL_ON_FILL : FIELD_SHELL,
                          "@2xl/card:w-[14.5rem]",
                        )}
                      />
                      {/* Sans + tabular-nums, never mono: a count that changes
                          while the user watches is the interface speaking. The
                          ink moves with the row for the same reason the
                          consequence line does. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex-none text-[0.78125rem] tabular-nums",
                          valueDirty ? "opacity-90" : "text-on-surface-variant",
                        )}
                      >
                        {imei.length}/15
                      </span>
                    </div>
                  }
                />
              </>
            ) : null}
          </div>

          {shapeError ? (
            <FieldError id="backup-imei-shape-error" className={INLINE_ERROR}>
              {t(`${K}.errors.length`, { entered: imei.length })}
            </FieldError>
          ) : luhnError ? (
            <FieldError id="backup-imei-luhn-error" className={INLINE_ERROR}>
              {t(`${K}.errors.luhn`)}
            </FieldError>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.actions.save`)}
              disabled={!canSave}
              className={PILL_ACTION}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleReset}
              disabled={isSaving || !hasChanged}
              aria-label={t(`${K}.actions.reset`)}
              // 36px is under the 44px coarse-pointer floor; bumped only there,
              // matching the device-IMEI card's reset control exactly.
              className="rounded-pill [@media(pointer:coarse)]:size-11"
            >
              <MaterialSymbol name="restart_alt" size={18} />
            </Button>
          </div>
        </form>
      </CardContent>

      <AlertDialog open={explainOpen} onOpenChange={setExplainOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => setEnabled(true)}>
              {t(`${K}.dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default BackupIMEICard;

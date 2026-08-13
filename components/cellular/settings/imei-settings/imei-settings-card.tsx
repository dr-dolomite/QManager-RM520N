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
import { Badge } from "@/components/ui/badge";
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
import { validateImei } from "@/lib/imei-utils";
import { cn } from "@/lib/utils";

import SettingRow from "../setting-row";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  FIELD_SHELL,
  FIELD_SHELL_ON_FILL,
  INLINE_ERROR,
  PILL_ACTION,
  READOUT_ROW,
  ROW_GROUP,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// Device IMEI — the write surface
// =============================================================================
// Two rows: what the modem reports now, and what it will report after the next
// boot. The split is the whole point — an IMEI write lands in NVM immediately
// and in the network's view of the device only after a restart, and the previous
// single-field form collapsed those two facts into one input that was sometimes
// a readout and sometimes a draft.
//
// -----------------------------------------------------------------------------
// THE LUHN GATE
// -----------------------------------------------------------------------------
// The incumbent guard was a bare shape regex, `/^\d{15}$/`, which happily let a
// Luhn-invalid identifier through to NVM — a number the network will reject,
// written to a device that then needs a reboot to find out. `validateImei()` has
// been sitting in `lib/imei-utils.ts` (used only by the Tools card) the whole
// time. It is now the gate, and it fails INLINE with a named recovery rather
// than as a toast: a toast is gone in four seconds, and this is the one message
// the user has to act on to proceed.
//
// -----------------------------------------------------------------------------
// THE FIELD SHAPE
// -----------------------------------------------------------------------------
// A raw <input>, not `components/ui/input.tsx`. The reasoning lives on
// `FIELD_INPUT` in `../shapes` — in short, the primitive's `dark:` and `md:`
// scoped classes survive tailwind-merge against unprefixed ones, so the field
// silently reverts in dark mode and above 768px.
//
// The field is composed from the shared PAIR (`FIELD_SHELL` /
// `FIELD_SHELL_ON_FILL`) rather than from the neutral shell alone. Typing in
// this field is exactly what promotes its row to `primary-container`, so a
// field that kept the neutral `surface-container-high` fill would render as a
// dead grey hole punched in the brand fill for the entire time the user is
// entering an IMEI. The counter beside it moves for the same reason.
// =============================================================================

export interface IMEISettingsCardProps {
  /** Scroll anchor for the deferred-reboot banner's "Review" action. */
  anchorId?: string;
  currentImei: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (imei: string) => Promise<boolean>;
  /** Hand off to /reboot/ now. */
  onRebootNow: () => void;
  /** Record that a reboot is owed, so the page can keep asking. */
  onRebootDeferred: () => void;
}

const IMEISettingsCard = ({
  anchorId,
  currentImei,
  isLoading,
  isSaving,
  onSave,
  onRebootNow,
  onRebootDeferred,
}: IMEISettingsCardProps) => {
  const { t } = useTranslation("cellular");
  const K = "core_settings.imei.device";

  const { saved, markSaved } = useSaveFlash();
  const [imei, setImei] = React.useState("");
  const [rebootOpen, setRebootOpen] = React.useState(false);

  // Seed the draft from the modem once it is known. Only when the user has not
  // started typing — a silent re-fetch must never overwrite an edit in progress.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    if (currentImei === null) return;
    seededRef.current = true;
    setImei(currentImei);
  }, [currentImei]);

  const reported = currentImei ?? "";
  const hasReading = reported.length > 0;

  const isEmpty = imei.length === 0;
  const isComplete = /^\d{15}$/.test(imei);
  const isLuhnValid = validateImei(imei);
  const hasChanged = imei !== reported;

  // Shape first, then checksum: naming "not 15 digits" while the number is still
  // being typed would be noise, so the length message waits for a full field.
  const shapeError = !isEmpty && !isComplete;
  const luhnError = isComplete && !isLuhnValid;
  const canWrite = isComplete && isLuhnValid && hasChanged && !isSaving;

  // Hoisted, because the row's promotion and the field's own fill are ONE fact.
  // Computing it twice is how the field ended up neutral on a promoted row.
  const writeDirty = hasChanged && !isEmpty;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImei(event.target.value.replace(/\D/g, "").slice(0, 15));
  };

  const handleReset = () => {
    setImei(reported);
  };

  const handleCopy = async () => {
    if (!hasReading) return;
    try {
      await navigator.clipboard.writeText(reported);
      toast.success(t(`${K}.toasts.copied`));
    } catch {
      toast.error(t(`${K}.toasts.copy_failed`));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite) return;

    const success = await onSave(imei);
    if (!success) {
      toast.error(t(`${K}.toasts.failed`));
      return;
    }

    markSaved();
    toast.success(t(`${K}.toasts.saved`));
    setRebootOpen(true);
  };

  const handleRebootLater = () => {
    setRebootOpen(false);
    onRebootDeferred();
  };

  // --- Loading ---------------------------------------------------------------
  // Geometry is MIRRORED from the shape constants (`SETTING_ROW.HEIGHT`), never
  // restated, and the header text is the real one in both states — the incumbent
  // skeleton carried a third, differently worded legal sentence that visibly
  // swapped out when the data landed.

  if (isLoading) {
    return (
      <Card id={anchorId} className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${K}.title`)}</CardTitle>
          <CardDescription>{t(`${K}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
            <div className={ROW_GROUP.DIVIDER} />
            <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id={anchorId} className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className={ROW_GROUP.ROOT}>
            <SettingRow
              label={t(`${K}.rows.current.label`)}
              consequence={t(`${K}.rows.current.consequence`)}
              control={
                hasReading ? (
                  <span
                    className={cn(
                      READOUT_ROW.ROOT,
                      // One tone step up: this pill sits INSIDE the group's own
                      // `surface-container` fill, so it needs the next step to
                      // read as a distinct object rather than as flat text.
                      "gap-2 bg-surface-container-high",
                    )}
                  >
                    <span className={READOUT_ROW.VALUE_MONO}>{reported}</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label={t(`${K}.actions.copy`)}
                      // 44px hit target via an inset overlay, so the visual pill
                      // stays dense without failing a coarse pointer.
                      className="relative grid size-6 flex-none place-items-center rounded-pill text-on-surface-variant transition-colors duration-[--duration-quick] ease-[--ease-standard] before:absolute before:-inset-2.5 before:content-[''] hover:text-on-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <MaterialSymbol name="content_copy" size={16} />
                    </button>
                  </span>
                ) : (
                  // Honest empty state. `muted`, not `destructive`: the poller
                  // simply has not published an IMEI yet, which is a wait, not a
                  // fault.
                  <Badge variant="muted">
                    <MaterialSymbol name="help" size={BADGE_GLYPH_SIZE} />
                    {t(`${K}.rows.current.unavailable`)}
                  </Badge>
                )
              }
            />

            <div className={ROW_GROUP.DIVIDER} />

            <SettingRow
              label={t(`${K}.rows.write.label`)}
              consequence={t(`${K}.rows.write.consequence`)}
              dirty={writeDirty}
              labelId="imei-write-label"
              control={
                <div className="flex w-full items-center gap-2.5 @2xl/card:w-auto">
                  <input
                    id="imei-write-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={15}
                    value={imei}
                    onChange={handleChange}
                    disabled={isSaving}
                    placeholder={t(`${K}.rows.write.placeholder`)}
                    aria-labelledby="imei-write-label"
                    aria-invalid={shapeError || luhnError}
                    aria-describedby={
                      shapeError
                        ? "imei-write-shape-error"
                        : luhnError
                          ? "imei-write-luhn-error"
                          : "imei-write-status"
                    }
                    className={cn(
                      writeDirty ? FIELD_SHELL_ON_FILL : FIELD_SHELL,
                      "@2xl/card:w-[14.5rem]",
                    )}
                  />
                  {/* A count that changes while the user watches is the
                      interface speaking, not the machine — sans + tabular-nums,
                      never mono (The Machine-Voice Rule).

                      The ink moves with the row, mirroring
                      `SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL` one element away:
                      `on-surface-variant` on a `primary-container` row is the
                      cross-pair the shapes file names as this surface's most
                      common failure. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex-none text-[0.78125rem] tabular-nums",
                      writeDirty ? "opacity-90" : "text-on-surface-variant",
                    )}
                  >
                    {imei.length}/15
                  </span>
                </div>
              }
            />
          </div>

          {shapeError ? (
            <FieldError id="imei-write-shape-error" className={INLINE_ERROR}>
              {t(`${K}.errors.length`, { entered: imei.length })}
            </FieldError>
          ) : luhnError ? (
            <FieldError id="imei-write-luhn-error" className={INLINE_ERROR}>
              {t(`${K}.errors.luhn`)}
            </FieldError>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.actions.write`)}
              disabled={!canWrite}
              className={PILL_ACTION}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleReset}
              disabled={isSaving || !hasChanged}
              aria-label={t(`${K}.actions.reset`)}
              // `size="icon"` is 36px, under the 44px coarse-pointer floor.
              // Bumped at the media query rather than always, so the dense
              // desktop cluster keeps its proportions.
              className="rounded-pill [@media(pointer:coarse)]:size-11"
            >
              <MaterialSymbol name="restart_alt" size={18} />
            </Button>

            {/* One status line, and only when there is no error occupying the
                same slot — two contradicting sentences under one field is how
                the incumbent form read. */}
            {!shapeError && !luhnError ? (
              <span
                id="imei-write-status"
                aria-live="polite"
                className="text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty"
              >
                {isEmpty
                  ? t(`${K}.status.empty`)
                  : !hasChanged
                    ? t(`${K}.status.unchanged`)
                    : t(`${K}.status.ready`)}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>

      {/* Deferred-reboot dialog. "Later" is a real answer that is RECORDED —
          it hands the pending state up to the page, which then keeps the
          `deferred-reboot` banner on screen until the modem actually restarts.
          Nothing reboots inline: the app is served by the device it restarts. */}
      <AlertDialog open={rebootOpen} onOpenChange={setRebootOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("core_settings.imei.reboot.dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("core_settings.imei.reboot.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRebootLater}>
              {t("core_settings.imei.reboot.dialog.later")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onRebootNow}>
              {t("core_settings.imei.reboot.dialog.now")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default IMEISettingsCard;

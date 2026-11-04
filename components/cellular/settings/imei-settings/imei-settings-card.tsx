"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { FieldError } from "@/components/ui/field";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { HintIcon } from "@/components/ui/hint-icon";
import { validateImei } from "@/lib/imei-utils";
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ApplyFootSkeleton } from "../apply-foot";
import SettingRow from "../setting-row";
import ResetButton from "./reset-button";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_CLUSTER,
  FIELD_COUNTER,
  FIELD_SHELL,
  INLINE_ERROR,
  ROW_GROUP,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// Device IMEI — the write surface
// =============================================================================
// One row: the draft, seeded from the modem. An IMEI write lands in NVM at once but reaches the network only after a
// restart, so a check badge marks a draft matching the modem and the footer says what a write will do.
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
// `<Input host="container">` with the family `FIELD_SHELL`: the row group is the host.
//
// =============================================================================

export interface IMEISettingsCardProps {
  /** Scroll anchor for the deferred-reboot banner's "Review" action. */
  anchorId?: string;
  currentImei: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (imei: string) => Promise<boolean>;
  /** Fire the reboot and hand off to /reboot/. */
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
  const formId = React.useId();
  const [imei, setImei] = React.useState("");
  const [rebootOpen, setRebootOpen] = React.useState(false);
  // Set when "Reboot now" closes the dialog, so the close isn't also read as a
  // deferral. Every other way out (Later, Escape) records the owed reboot.
  const rebootingNowRef = React.useRef(false);

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
  const matchesModem = hasReading && !hasChanged;

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
    rebootingNowRef.current = false;
    setRebootOpen(true);
  };

  const handleRebootDialogChange = (open: boolean) => {
    setRebootOpen(open);
    if (!open && !rebootingNowRef.current) onRebootDeferred();
  };

  const handleRebootNow = () => {
    rebootingNowRef.current = true;
    onRebootNow();
  };

  // --- Loading ---------------------------------------------------------------
  // Geometry is MIRRORED from the shape constants (`SETTING_ROW.HEIGHT`), never
  // restated, and the header text is the real one in both states — the incumbent
  // skeleton carried a third, differently worded legal sentence that visibly
  // swapped out when the data landed.
  //
  // THE CARD NO LONGER REBUILDS ITSELF. Each state used to `return` its own
  // `<Card>`, so the header — an identical title and description in both
  // branches — was torn down and remounted the instant the read landed, and
  // blinked. One shell renders unconditionally now and only the BODY swaps,
  // keyed by state, inside an enter-only `AnimatePresence`. Same pattern as
  // Network Priority and Blocked Networks; `initial={false}` is what keeps this
  // crossfade from firing on top of the page's own card cascade on first paint.

  const skeleton = (
    <div className={ROW_GROUP.ROOT}>
      <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
    </div>
  );

  const form = (
    <form id={formId} className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className={ROW_GROUP.ROOT}>
        <SettingRow
          label={t(`${K}.rows.write.label`)}
          consequence={t(`${K}.rows.write.consequence`)}
          dirty={writeDirty}
          labelId="imei-write-label"
          control={
            <div className={FIELD_CLUSTER}>
              {/* Only while the draft IS the modem's IMEI. The tip carries the
                  sentence the footer used to; HintIcon, since a Tooltip never opens on tap. */}
              {matchesModem ? (
                <span className="flex flex-none items-center gap-1.5">
                  <Badge
                    variant="success"
                    role="img"
                    aria-label={t(`${K}.status.unchanged`)}
                    className="size-7 flex-none bg-success p-0 text-success-foreground"
                  >
                    <MaterialSymbol name="check" size={BADGE_GLYPH_SIZE} />
                  </Badge>
                  <HintIcon label={t(`${K}.status.unchanged_tip_label`)}>
                    {t(`${K}.status.unchanged`)}
                  </HintIcon>
                </span>
              ) : null}
              <Input
                host="container"
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
                className={cn(FIELD_SHELL, "@2xl/card:w-[14.5rem]")}
              />
              {/* A count that changes while the user watches is the
                      interface speaking, not the machine — sans + tabular-nums,
                      never mono (The Machine-Voice Rule). See `FIELD_COUNTER`. */}
              <span aria-hidden="true" className={FIELD_COUNTER}>
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

    </form>
  );

  return (
    <Card id={anchorId} className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        <AnimatePresence initial={false}>
          <motion.div
            // The key IS the swap. `initial`/`animate` are declared here even
            // though the variant carries both states: an `AnimatePresence`
            // child remounts on every key change, so there is no parent clock
            // left to inherit and a variants-only child would render blank.
            key={isLoading ? "loading" : "loaded"}
            variants={staggerRowItem}
            initial="hidden"
            animate="visible"
          >
            {isLoading ? skeleton : form}
          </motion.div>
        </AnimatePresence>
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      {isLoading ? (
        <ApplyFootSkeleton />
      ) : (
        <CardFoot
          className={CARD_PAD}
          // The status span is its own live region; one announcement per change.
          liveStatus={false}
          status={
            <>
              <ResetButton
                label={t(`${K}.actions.reset_short`)}
                onClick={handleReset}
                disabled={isSaving || !hasChanged}
              />
              {/* Hidden while a field error owns the message, so two sentences never contradict. */}
              {!shapeError && !luhnError ? (
                <span id="imei-write-status" aria-live="polite">
                  {isEmpty
                    ? t(`${K}.status.empty`)
                    : hasChanged
                      ? t(`${K}.status.ready`)
                      : null}
                </span>
              ) : null}
            </>
          }
          actions={
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.actions.write`)}
              disabled={!canWrite}
              size="action"
            />
          }
        />
      )}

      {/* Deferred-reboot dialog. "Later" is a real answer that is RECORDED:
          the page sets the app-wide pending-reboot flag, so the shell's
          deferred-reboot banner stays on every route until the modem restarts.
          Nothing reboots inline: the app is served by the device it restarts. */}
      <AlertDialog open={rebootOpen} onOpenChange={handleRebootDialogChange}>
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
            <AlertDialogCancel>
              {t("core_settings.imei.reboot.dialog.later")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRebootNow}>
              {t("core_settings.imei.reboot.dialog.now")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default IMEISettingsCard;

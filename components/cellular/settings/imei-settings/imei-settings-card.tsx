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
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import SettingRow from "../setting-row";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_CLUSTER,
  FIELD_COUNTER,
  FIELD_SHELL,
  ICON_ACTION,
  ICON_ACTION_GLYPH,
  INLINE_ERROR,
  PILL_ACTION,
  READOUT_ICON_ACTION,
  READOUT_ICON_GLYPH,
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
      <div className={ROW_GROUP.DIVIDER} />
      <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
    </div>
  );

  const form = (
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
                  className={READOUT_ICON_ACTION}
                >
                  <MaterialSymbol
                    name="content_copy"
                    size={READOUT_ICON_GLYPH}
                  />
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
            <div className={FIELD_CLUSTER}>
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
          className={ICON_ACTION}
        >
          <MaterialSymbol name="restart_alt" size={ICON_ACTION_GLYPH} />
        </Button>

        {/* One status line, and only when there is no error occupying the
                same slot — two contradicting sentences under one field is how
                the incumbent form read. */}
        {!shapeError && !luhnError ? (
          <span
            id="imei-write-status"
            aria-live="polite"
            className={SETTING_ROW.CONSEQUENCE}
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

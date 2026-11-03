"use client";

import * as React from "react";
import { motion } from "motion/react";
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
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { requestRebootLater } from "@/lib/reboot";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  MbnActionResult,
  MbnProfile,
  MbnSaveRequest,
} from "@/types/mbn-settings";

import { ApplyFootSkeleton } from "../apply-foot";
import SettingRow from "../setting-row";
import {
  BANNER_ACTION,
  EMPTY_BLOCK,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHOICE_ROW,
  ROW_GROUP,
  SETTING_ROW,
} from "../shapes";

// Carrier Profile (MBN). A save never reboots: the dialog offers it, and any
// other close defers it to the app-wide pending-reboot banner.

const K = "core_settings.apn.mbn";

export interface MBNCardProps {
  profiles: MbnProfile[] | null;
  autoSel: number | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Why the last read failed (translated), or null. */
  loadError: string | null;
  onRetry: () => void;
  onSave: (request: MbnSaveRequest) => Promise<MbnActionResult>;
  /** Fires the reboot and enters the /reboot/ flow; false if it was not accepted. */
  onReboot: () => Promise<boolean>;
}

function MbnCardHeader() {
  const { t } = useTranslation("cellular");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
      <CardDescription>{t(`${K}.description`)}</CardDescription>
    </CardHeader>
  );
}

export function MBNCard({
  profiles,
  autoSel,
  isLoading,
  isSaving,
  loadError,
  onRetry,
  onSave,
  onReboot,
}: MBNCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const liveSelected = profiles?.find((profile) => profile.selected) ?? null;
  const liveSelectedName = liveSelected?.name ?? "";

  // Re-seed the draft whenever the baseline changes, so a refetch after apply lands the new truth.
  const baselineKey =
    autoSel !== null ? `${autoSel} ${liveSelectedName}` : null;

  const [syncedKey, setSyncedKey] = React.useState<string | null>(null);
  const [autoOn, setAutoOn] = React.useState(false);
  const [selectedName, setSelectedName] = React.useState("");

  if (baselineKey !== null && baselineKey !== syncedKey) {
    setSyncedKey(baselineKey);
    setAutoOn(autoSel === 1);
    setSelectedName(liveSelectedName);
  }

  const [showRebootDialog, setShowRebootDialog] = React.useState(false);
  const [isRebooting, setIsRebooting] = React.useState(false);

  // Roving tabindex refs; declared above the early returns (hooks cannot branch).
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  if (isLoading) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <MbnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
          </div>
          <div className="flex flex-col gap-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(CHOICE_ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
        </CardContent>
        <ApplyFootSkeleton />
      </Card>
    );
  }

  // Only the never-read case; a failed re-read keeps the last snapshot under a banner.
  if (loadError && profiles === null) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <MbnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col")}>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t(`${K}.error_title`)}
            description={loadError}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="flex-1 rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  const autoDirty = autoSel !== null && autoOn !== (autoSel === 1);
  const profileDirty = !autoOn && !!selectedName && selectedName !== liveSelectedName;
  const changeCount = (autoDirty ? 1 : 0) + (profileDirty ? 1 : 0);

  const bundles = profiles ?? [];

  // APG radio group: one tab stop (the chosen row, else the first); arrows move focus and selection.
  const activeIndex = Math.max(
    0,
    bundles.findIndex((bundle) => bundle.name === selectedName),
  );

  const listDisabled = isSaving || autoOn;

  const focusBundle = (index: number) => {
    const bundle = bundles[index];
    if (!bundle) return;
    setSelectedName(bundle.name);
    rowRefs.current[index]?.focus();
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (listDisabled || bundles.length === 0) return;

    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;

    if (step !== 0) {
      event.preventDefault();
      focusBundle((activeIndex + step + bundles.length) % bundles.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusBundle(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusBundle(bundles.length - 1);
    }
  };

  const discard = () => {
    setAutoOn(autoSel === 1);
    setSelectedName(liveSelectedName);
  };

  const handleSave = async () => {
    // Auto-select must be off before a pinned bundle means anything, so it is written first.
    let result: MbnActionResult = { ok: true };
    let successKey: string | null = null;

    if (autoDirty) {
      result = await onSave({ action: "auto_sel", auto_sel: autoOn ? 1 : 0 });
      if (result.ok) {
        successKey = autoOn ? `${K}.toast.auto_enabled` : `${K}.toast.auto_disabled`;
      }
    }
    if (result.ok && profileDirty) {
      result = await onSave({
        action: "apply_profile",
        profile_name: selectedName,
      });
      if (result.ok) successKey = `${K}.toast.profile_applied`;
    }

    if (!result.ok) {
      // A first write that landed still needs its reboot.
      if (successKey) requestRebootLater("mbn");
      toast.error(t(`${K}.toast.error`), { description: result.error });
      return;
    }

    markSaved();
    if (successKey) toast.success(t(successKey));
    setShowRebootDialog(true);
  };

  const handleRebootLater = () => {
    requestRebootLater("mbn");
    setShowRebootDialog(false);
  };

  const handleReboot = async (event: React.MouseEvent) => {
    event.preventDefault();
    setIsRebooting(true);
    // The /reboot/ hand-off is the success signal; only a failure toasts.
    const sent = await onReboot();
    if (!sent) {
      toast.error(t(`${K}.toast.reboot_error`));
      setIsRebooting(false);
    }
  };

  return (
    <Card className={cn(CARD_SHELL)}>
      <MbnCardHeader />

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {loadError ? (
          <TonalBanner
            tone="destructive"
            icon="error"
            title={t(`${K}.error_title`)}
          >
            <span className="flex flex-wrap items-center gap-2">
              {loadError}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRetry}
                className={BANNER_ACTION}
              >
                {t("actions.retry", { ns: "common" })}
              </Button>
            </span>
          </TonalBanner>
        ) : null}

        <div className={ROW_GROUP.ROOT}>
          <SettingRow
            labelId="mbn-auto-label"
            label={t(`${K}.auto.label`)}
            consequence={t(`${K}.auto.consequence`)}
            dirty={autoDirty}
            control={
              <SegmentedField
                value={autoOn ? "on" : "off"}
                onValueChange={(next) => setAutoOn(next === "on")}
                options={[
                  { value: "on", label: t("state.on", { ns: "common" }) },
                  { value: "off", label: t("state.off", { ns: "common" }) },
                ]}
                ariaLabel={t(`${K}.auto.label`)}
                disabled={isSaving}
                breakpoint="never"
                glyph={(className) => (
                  <MaterialSymbol
                    name="check"
                    filled
                    size={SEGMENTED.GLYPH}
                    aria-hidden="true"
                    className={className}
                  />
                )}
              />
            }
          />
        </div>

        {/* Empty copy is only true of a successful read that returned nothing. */}
        {profiles !== null && bundles.length === 0 ? (
          <div className={EMPTY_BLOCK.ROOT}>
            <MaterialSymbol
              name="sim_card"
              size={EMPTY_BLOCK.GLYPH}
              className="text-on-surface-variant"
            />
            <span className={EMPTY_BLOCK.TITLE}>{t(`${K}.empty.title`)}</span>
            <span className={EMPTY_BLOCK.BODY}>{t(`${K}.empty.body`)}</span>
          </div>
        ) : bundles.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className={SETTING_ROW.CONSEQUENCE}>
              {t(`${K}.list_label`)}
            </span>
            <motion.div
              role="radiogroup"
              aria-label={t(`${K}.list_label`)}
              className={cn(CHOICE_ROW.SCROLL_CAP, "flex flex-col gap-1")}
              variants={staggerRows}
              initial="hidden"
              animate="visible"
              onKeyDown={handleListKeyDown}
            >
              {bundles.map((bundle, index) => {
                const chosen = bundle.name === selectedName;
                return (
                  <motion.button
                    key={`${bundle.index}-${bundle.name}`}
                    ref={(node) => {
                      rowRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    tabIndex={index === activeIndex ? 0 : -1}
                    variants={staggerRowItem}
                    disabled={listDisabled}
                    onClick={() => setSelectedName(bundle.name)}
                    className={cn(
                      CHOICE_ROW.ROOT,
                      chosen ? CHOICE_ROW.SELECTED : CHOICE_ROW.REST,
                      listDisabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className={CHOICE_ROW.TEXT}>
                      <span className={CHOICE_ROW.NAME}>{bundle.name}</span>
                      {/* The modem's live selection, not the draft: a bundle runs only after boot. */}
                      {bundle.selected && bundle.activated ? (
                        <span className={CHOICE_ROW.CAPTION}>
                          {t(`${K}.selected_caption`)}
                        </span>
                      ) : null}
                    </span>
                    {chosen ? (
                      <MaterialSymbol
                        name="check_circle"
                        filled
                        size={CHOICE_ROW.GLYPH}
                      />
                    ) : null}
                  </motion.button>
                );
              })}
            </motion.div>
          </div>
        )}
      </CardContent>

      {/* Persistent; the reboot note shows only while a change is pending. */}
      <CardFoot
        className={CARD_PAD}
        status={
          changeCount > 0 ? (
            <>
              <span className="text-foreground font-semibold tabular-nums">
                {t("core_settings.basic.save_bar.count", { count: changeCount })}
              </span>
              <span className="text-pretty">{t(`${K}.pending_note`)}</span>
            </>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={discard}
              disabled={isSaving || changeCount === 0}
              size="action" className="gap-0"
            >
              {t("core_settings.basic.save_bar.discard")}
            </Button>
            <SaveButton
              type="button"
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.save`)}
              disabled={changeCount === 0}
              size="action"
            />
          </>
        }
      />

      {/* Opened only after a successful write; any close but Reboot now defers to the banner. */}
      <AlertDialog
        open={showRebootDialog}
        onOpenChange={(open) => {
          if (isRebooting) return;
          if (!open) handleRebootLater();
          else setShowRebootDialog(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.reboot.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.reboot.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRebooting}>
              {t(`${K}.reboot.later`)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isRebooting}
              onClick={handleReboot}
            >
              {isRebooting ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={16}
                    className="motion-safe:animate-spin"
                  />
                  {t(`${K}.reboot.rebooting`)}
                </>
              ) : (
                t(`${K}.reboot.now`)
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default MBNCard;

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
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TonalBanner } from "@/components/ui/tonal-banner";
import {
  DUR,
  EASE_STANDARD,
  staggerRowItem,
  staggerRows,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { MbnProfile, MbnSaveRequest } from "@/types/mbn-settings";

import SettingRow from "../setting-row";
import {
  EMPTY_BLOCK,
  CARD_PAD,
  CARD_SHELL,
  CHOICE_ROW,
  PILL_ACTION,
  ROW_GROUP,
  SAVE_BAR,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// Carrier Profile (MBN) — a switch and a choice list, not two dropdowns
// =============================================================================
// An MBN bundle is a firmware payload that sets a carrier's APN, IMS and band
// defaults in one go. Two things follow from that, and both drove this shape:
//
// SELECTION IS A PROMOTION, NOT A RADIO CIRCLE. The comp drew Material's
// `radio_button_checked` / `radio_button_unchecked` pair; neither glyph is in
// the font subset, and adding them would mean a Google Fonts round-trip plus a
// committed binary for an affordance this system already expresses better. The
// chosen row IS a `primary-container` block (`CHOICE_ROW`), which reads across
// the card at a glance where an 18px circle does not, and survives grayscale.
//
// THE REBOOT IS OFFERED, NEVER TAKEN. QManager runs ON the modem it manages, so
// a reboot kills the very HTTP request that asked for it. The write completes
// first; the reboot is a separate, explicitly-confirmed action afterwards.
//
// The old card was two Selects with an always-live Save that answered a no-op
// press with a toast reading "No changes to save" — it could not tell you
// whether you had changed anything, so it waited for you to ask and said no.
// The bar below exists only while something is pending, and Save is disabled
// until then.
// =============================================================================

export interface MBNCardProps {
  profiles: MbnProfile[] | null;
  autoSel: number | null;
  isLoading: boolean;
  isSaving: boolean;
  error?: string | null;
  onSave: (request: MbnSaveRequest) => Promise<boolean>;
  onRetry?: () => void;
}

export function MBNCard({
  profiles,
  autoSel,
  isLoading,
  isSaving,
  error = null,
  onSave,
  onRetry,
}: MBNCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const K = "core_settings.apn.mbn";

  const liveSelected = profiles?.find((profile) => profile.selected) ?? null;
  const liveSelectedName = liveSelected?.name ?? "";

  // Draft state, re-seeded whenever the BASELINE changes rather than once on
  // first fetch — same reasoning as the APN card: a refetch after a successful
  // apply must move the form onto the new truth, and a refetch that changes
  // nothing must not disturb an edit in progress.
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

  // Roving tabindex for the bundle radiogroup. Declared above the loading
  // early-return, because hooks cannot sit behind a branch.
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

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
          <div className="flex flex-col gap-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(CHOICE_ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const autoDirty = autoSel !== null && autoOn !== (autoSel === 1);
  const profileDirty = !autoOn && !!selectedName && selectedName !== liveSelectedName;
  const changeCount = (autoDirty ? 1 : 0) + (profileDirty ? 1 : 0);

  const bundles = profiles ?? [];

  // ---------------------------------------------------------------------------
  // The radiogroup's keyboard contract
  // ---------------------------------------------------------------------------
  // `role="radiogroup"` over `role="radio"` children is a PROMISE, and the list
  // shipped without keeping it: every bundle was its own tab stop (twenty of
  // them on some carrier firmware) and the arrow keys did nothing, so a screen
  // reader announced a radio group whose members behaved like a button list.
  //
  // The fix is the real one rather than downgrading to `aria-pressed`: exactly
  // one row is tabbable, and the arrows move focus AND selection through the
  // group, which is what APG specifies for radios and what makes twenty bundles
  // reachable in one Tab plus a held arrow key. The tabbable row is the chosen
  // one — or the first, before anything is chosen — so Tab always lands where
  // the user's attention already is.
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

    // Both axes: a vertical list still gets Left/Right, because a radio group's
    // arrow contract is direction-agnostic and users arrive with either habit.
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;

    if (step !== 0) {
      event.preventDefault();
      // Wrapping, per APG — a radio group is a ring, not a list with ends.
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
    // Sequential, in dependency order: auto-select must be OFF before a pinned
    // bundle means anything, so the toggle is written first and the bundle only
    // if that write landed. The previous card wrote whichever ONE change it
    // noticed first, so turning auto off and picking a bundle in the same pass
    // silently dropped the bundle.
    let ok = true;

    if (autoDirty) {
      ok = await onSave({ action: "auto_sel", auto_sel: autoOn ? 1 : 0 });
    }
    if (ok && profileDirty) {
      ok = await onSave({
        action: "apply_profile",
        profile_name: selectedName,
      });
    }

    if (ok) {
      markSaved();
      toast.success(t(`${K}.toast.applied`));
      setShowRebootDialog(true);
    } else {
      toast.error(t(`${K}.toast.error`));
    }
  };

  const handleReboot = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsRebooting(true);

    // Prepare session state for the countdown page.
    sessionStorage.setItem("qm_rebooting", "1");
    document.cookie = "qm_logged_in=; Path=/; Max-Age=0";

    // Fire-and-forget: `keepalive` is what lets the request survive the
    // navigation on the next line — and the modem is about to kill this
    // connection anyway, so there is no response to wait for.
    fetch("/cgi-bin/quecmanager/cellular/mbn.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reboot" }),
      keepalive: true,
    }).catch(() => {});

    window.location.href = "/reboot/";
  };

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {error ? (
          <TonalBanner
            tone="destructive"
            icon="error"
            title={t(`${K}.error_title`)}
          >
            <span className="flex flex-wrap items-center gap-2">
              {t("core_settings.apn.page.error_load_description")}
              {onRetry ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  className="h-8 rounded-pill px-3 text-xs font-semibold"
                >
                  {t("actions.retry", { ns: "common" })}
                </Button>
              ) : null}
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
              // The Switch ships as-is — no sizing classes. Its own track/thumb
              // geometry is the product's, and a one-off resize here would make
              // this the only switch in the app at a different size.
              <Switch
                checked={autoOn}
                onCheckedChange={setAutoOn}
                disabled={isSaving}
                aria-labelledby="mbn-auto-label"
              />
            }
          />
        </div>

        {bundles.length === 0 ? (
          // Honest empty state: some firmware simply returns no bundle list, in
          // which case automatic selection is not a preference, it is the only
          // thing available. Geometry imported from the family's empty-state
          // constant rather than restated.
          <div className={EMPTY_BLOCK.ROOT}>
            <MaterialSymbol
              name="sim_card"
              size={EMPTY_BLOCK.GLYPH}
              className="text-on-surface-variant"
            />
            <span className={EMPTY_BLOCK.TITLE}>{t(`${K}.empty.title`)}</span>
            <span className={EMPTY_BLOCK.BODY}>{t(`${K}.empty.body`)}</span>
          </div>
        ) : (
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
                    // Exactly one tab stop for the whole group; the arrows do
                    // the rest. See `handleListKeyDown`.
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
                      {/* A bundle name is a firmware identifier read straight
                          back off the modem — machine voice. */}
                      <span className={CHOICE_ROW.NAME}>{bundle.name}</span>
                      {/* The caption reports the MODEM's live selection, not
                          the draft: a bundle only starts running at boot, so
                          claiming it for a row the user just clicked would be
                          asserting something that has not happened yet. */}
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

        <TonalBanner tone="warning" icon="warning">
          {t(`${K}.reboot_notice`)}
        </TonalBanner>

        {/* The bar exists only while something is pending. Enter-only motion —
            `SaveButton` keeps all three of its layers mounted to hold its width
            lock, so it is never placed under an AnimatePresence. */}
        {changeCount > 0 || isSaving ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
            className={SAVE_BAR.ROOT}
            role="status"
            aria-live="polite"
          >
            <div className={SAVE_BAR.TEXT}>
              <span className={SAVE_BAR.COUNT}>
                {t("core_settings.basic.save_bar.count", {
                  count: changeCount,
                })}
              </span>
              <span className={SAVE_BAR.NOTE}>{t(`${K}.pending_note`)}</span>
            </div>
            <div className={SAVE_BAR.ACTIONS}>
              <Button
                type="button"
                variant="ghost"
                onClick={discard}
                disabled={isSaving || changeCount === 0}
                className={cn(PILL_ACTION, "gap-0")}
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
                className={PILL_ACTION}
              />
            </div>
          </motion.div>
        ) : null}
      </CardContent>

      {/* Deferred reboot. Opened only AFTER a successful write, never as part
          of it — the modem serving this page is the one being rebooted. */}
      <AlertDialog
        open={showRebootDialog}
        onOpenChange={(open) => {
          if (!isRebooting) setShowRebootDialog(open);
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
                    className="animate-spin motion-reduce:animate-none"
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

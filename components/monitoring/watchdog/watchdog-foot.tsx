"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon } from "lucide-react";

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
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CARD_PAD, FOOT, SKELETON } from "./shapes";
import {
  FIELD_LABEL_KEY,
  type WatchdogForm,
  type WatchdogScope,
} from "./use-watchdog-form";

/** A real list for the active locale: separator and conjunction are language facts. */
function formatList(items: string[], language: string): string {
  if (items.length === 0) return "";
  try {
    return new Intl.ListFormat(language, {
      style: "long",
      type: "conjunction",
    }).format(items);
  } catch {
    return items.join(", ");
  }
}

/**
 * One card's commit, on that card's bottom edge. The Ladder's save carries the
 * tier-4 reboot-authority confirm; Detection's never can.
 */
export function WatchdogFoot({
  form,
  scope,
}: {
  form: WatchdogForm;
  scope: WatchdogScope;
}) {
  const { t, i18n } = useTranslation("common");
  const state = form.scopes[scope];
  const blocked = state.dirty && state.blockedFields.length > 0;
  const nameList = formatList(
    state.blockedFields.map((key) => t(FIELD_LABEL_KEY[key])),
    i18n.language,
  );
  const blockedText = t("watchdog.save.blockedIn", { fields: nameList });

  const [confirmReboot, setConfirmReboot] = React.useState(false);
  const saveWrapRef = React.useRef<HTMLSpanElement | null>(null);

  // The gate is the save, not the tier-4 control: a stock device seeds tier 4
  // armed under a master that is off.
  const handleSave = () => {
    if (scope === "ladder" && form.grantsRebootAuthority) {
      setConfirmReboot(true);
      return;
    }
    void state.submit();
  };

  // `SaveButton` stops the event while `blockedReason` is set, so the jump to
  // the offending field runs in the capture phase.
  const jumpToBlocked = () => {
    if (blocked) state.focusFirstBlocked();
  };

  return (
    <>
      <CardFoot
        className={CARD_PAD}
        status={
          blocked ? (
            <span className={cn(FOOT.LINE, "text-destructive-on-surface")}>
              <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
              <span className="font-medium text-pretty">{blockedText}</span>
            </span>
          ) : state.dirty ? (
            <span className={FOOT.LINE}>
              <span className={FOOT.DOT} aria-hidden />
              <span className="text-on-surface font-medium text-pretty">
                {t("watchdog.save.dirty")}
              </span>
            </span>
          ) : (
            <span className="text-pretty">{t("watchdog.save.clean")}</span>
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              className="text-on-surface-variant"
              onClick={state.discard}
              disabled={!state.dirty || state.isSaving}
            >
              {t("watchdog.save.discard")}
            </Button>
            <span ref={saveWrapRef} className="contents" onClickCapture={jumpToBlocked}>
              <SaveButton
                type="button"
                size="action"
                label={t("watchdog.save.action")}
                isSaving={state.isSaving}
                saved={state.saved}
                blockedReason={blocked ? blockedText : null}
                disabled={!state.dirty || state.busy}
                onClick={handleSave}
              />
            </span>
          </>
        }
      />

      {scope === "ladder" ? (
        // No AlertDialogTrigger renders, so focus is handed back to the Save pill.
        <AlertDialog open={confirmReboot} onOpenChange={setConfirmReboot}>
          <AlertDialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              saveWrapRef.current?.querySelector("button")?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("watchdog.save.confirmReboot.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("watchdog.save.confirmReboot.body")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {t("watchdog.save.confirmReboot.cap", {
                cap: Number(form.draft.maxReboots) || 3,
              })}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("watchdog.save.confirmReboot.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void state.submit()}>
                {t("watchdog.save.confirmReboot.action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

/** Mirrors the loaded foot: a status line, then Discard and Save pills. */
export function WatchdogFootSkeleton() {
  return (
    <CardFoot
      className={CARD_PAD}
      liveStatus={false}
      aria-hidden="true"
      status={<Skeleton className={cn(SKELETON.FOOT_STATUS, "w-32")} />}
      actions={
        <>
          <Skeleton className={cn(SKELETON.PILL, "w-20")} />
          <Skeleton className={cn(SKELETON.PILL, "w-24")} />
        </>
      }
    />
  );
}

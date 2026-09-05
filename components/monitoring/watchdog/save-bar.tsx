"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

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
import { SaveButton } from "@/components/ui/save-button";
import { cn } from "@/lib/utils";

import { PILL_ACTION, SAVEBAR, SKELETON } from "./shapes";
import { FIELD_LABEL_KEY, type WatchdogForm } from "./use-watchdog-form";

import { Skeleton } from "@/components/ui/skeleton";

export function SaveBar({ form }: { form: WatchdogForm }) {
  const { t, i18n } = useTranslation("common");
  const blocked = form.blockedFields.length > 0;

  const names = form.blockedFields.map((key) => t(FIELD_LABEL_KEY[key]));
  // A real list for the active locale, never a `", "` join: the separator and
  // the final conjunction are language facts, not punctuation.
  const nameList = React.useMemo(() => {
    if (names.length === 0) return "";
    try {
      return new Intl.ListFormat(i18n.language, {
        style: "long",
        type: "conjunction",
      }).format(names);
    } catch {
      return names.join(", ");
    }
  }, [names, i18n.language]);

  const [confirmReboot, setConfirmReboot] = React.useState(false);
  const saveWrapRef = React.useRef<HTMLSpanElement | null>(null);

  // The gate is here, not on the tier-4 switch: a stock device seeds tier 4
  // armed under a master that is off, so on the default path the tier switch is
  // never touched and a switch-level intercept would never fire.
  const handleSave = React.useCallback(() => {
    if (form.grantsRebootAuthority) {
      setConfirmReboot(true);
      return;
    }
    void form.submit();
  }, [form]);

  // `SaveButton` stops the event when `blockedReason` is set, so its `onClick`
  // never fires while blocked. The jump to the offending field has to run in
  // the capture phase to survive that guard — Enter on the button included.
  const jumpToBlocked = React.useCallback(() => {
    if (blocked) form.focusFirstBlocked();
  }, [blocked, form]);

  return (
    <div className={SAVEBAR.ROOT}>
      {/* The bar is the only account of why Save will not take. */}
      <SaveStatus
        isDirty={form.isDirty}
        blocked={blocked}
        saved={form.saved}
        nameList={nameList}
      />
      <div className={SAVEBAR.ACTIONS}>
        <Button
          type="button"
          variant="ghost"
          className={cn(PILL_ACTION, "text-on-surface-variant")}
          onClick={form.discard}
          disabled={!form.isDirty || form.isSaving}
        >
          {t("watchdog.save.discard")}
        </Button>
        <span ref={saveWrapRef} className="contents" onClickCapture={jumpToBlocked}>
          <SaveButton
            type="button"
            className={PILL_ACTION}
            label={t("watchdog.save.action")}
            isSaving={form.isSaving}
            saved={form.saved}
            blockedReason={
              form.isDirty && blocked
                ? t("watchdog.save.blockedIn", { fields: nameList })
                : null
            }
            disabled={!form.isDirty || form.isSaving}
            onClick={handleSave}
          />
        </span>
      </div>

      {/* Nothing renders an AlertDialogTrigger, so Radix has no element to
          restore focus to and would drop it on <body>. Hand it the Save pill. */}
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
              {/* The cost sentence is the rung's own key, not a second copy of
                  the same claim written here. */}
              {t("watchdog.save.confirmReboot.body")}{" "}
              {t("watchdog.ladder.tier4.consequence")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
            {/* Interpolated, never pluralised: a `_one`/`_other` split would
                need matching key sets in five packs the parity gate compares. */}
            {t("watchdog.save.confirmReboot.cap", {
              cap: Number(form.maxRebootsPerHour) || 3,
            })}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("watchdog.save.confirmReboot.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void form.submit();
              }}
            >
              {t("watchdog.save.confirmReboot.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Four honest states. Blocked names the control, because there is no tab. */
function SaveStatus({
  isDirty,
  blocked,
  saved,
  nameList,
}: {
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  nameList: string;
}) {
  const { t } = useTranslation("common");

  if (isDirty && blocked) {
    return (
      <p role="status" className={cn(SAVEBAR.STATUS, "text-destructive-on-surface min-w-0")}>
        <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">
          {t("watchdog.save.blockedIn", { fields: nameList })}
        </span>
      </p>
    );
  }
  if (isDirty) {
    return (
      <p role="status" className={cn(SAVEBAR.STATUS, "min-w-0")}>
        <span className={SAVEBAR.PULSE} aria-hidden />
        <span className="text-on-surface truncate font-medium">
          {t("watchdog.save.dirty")}
        </span>
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className={cn(SAVEBAR.STATUS, "text-success-on-surface min-w-0")}>
        <CheckCircle2Icon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">{t("watchdog.save.saved")}</span>
      </p>
    );
  }
  return (
    <p role="status" className={cn(SAVEBAR.STATUS, "min-w-0")}>
      <span className="truncate">{t("watchdog.save.clean")}</span>
    </p>
  );
}

export function SaveBarSkeleton() {
  return (
    <div className={SAVEBAR.ROOT} aria-hidden>
      <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-32")} />
      <div className={SAVEBAR.ACTIONS}>
        <Skeleton className={cn(SKELETON.LINE, "h-9 w-20 rounded-pill")} />
        <Skeleton className={cn(SKELETON.LINE, "h-9 w-24 rounded-pill")} />
      </div>
    </div>
  );
}

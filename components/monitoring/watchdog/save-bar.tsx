"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

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

  const handleSave = React.useCallback(() => {
    if (blocked) {
      form.focusFirstBlocked();
      return;
    }
    void form.submit();
  }, [blocked, form]);

  return (
    <div className={SAVEBAR.ROOT}>
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
      </div>
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
      <p className={cn(SAVEBAR.STATUS, "text-destructive-on-surface min-w-0")}>
        <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">
          {t("watchdog.save.blockedIn", { fields: nameList })}
        </span>
      </p>
    );
  }
  if (isDirty) {
    return (
      <p className={cn(SAVEBAR.STATUS, "min-w-0")}>
        <span className={SAVEBAR.PULSE} aria-hidden />
        <span className="text-on-surface truncate font-medium">
          {t("watchdog.save.dirty")}
        </span>
      </p>
    );
  }
  if (saved) {
    return (
      <p className={cn(SAVEBAR.STATUS, "text-success-on-surface min-w-0")}>
        <CheckCircle2Icon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">{t("watchdog.save.saved")}</span>
      </p>
    );
  }
  return (
    <p className={cn(SAVEBAR.STATUS, "min-w-0")}>
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

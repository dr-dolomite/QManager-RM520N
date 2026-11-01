"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Loader2Icon, RotateCwIcon, Trash2Icon } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { UseKnownSimsReturn } from "@/hooks/use-known-sims";

import { RevealLabelButton } from "@/components/ui/reveal-label-button";
import {
  GROUP_LABEL,
  PILL_GLYPH,
  ROW,
  ROW_GROUP,
  SKELETON,
  VALUE,
  VALUE_NONE,
} from "./shapes";

// Tracked SIMs: the device keeps a set it can count and clear but not name; Clear is inline, off the card foot.
// `count === null` is a failed read, `0` a genuinely empty set; the row shows which.

const K = "known_sims";

export type TrackedSimsGroupProps = Pick<
  UseKnownSimsReturn,
  "count" | "isLoading" | "isClearing" | "refresh" | "clear"
>;

export default function TrackedSimsGroup({
  count,
  isLoading,
  isClearing,
  refresh,
  clear,
}: TrackedSimsGroupProps) {
  const { t } = useTranslation("system-settings");
  const [open, setOpen] = useState(false);

  const handleClear = useCallback(async () => {
    const result = await clear();
    setOpen(false);
    if (!result.ok) {
      // The device's own words go beneath the translated line, never into it.
      toast.error(t(`${K}.toast_clear_failed`), {
        description: result.detail || undefined,
      });
      return;
    }
    // The set cleared but the registry sidecar did not (or the backend predates
    // the two-store clear): say so rather than claim a clean wipe.
    if (result.registryCleared) {
      toast.success(t(`${K}.toast_cleared`));
    } else {
      toast.warning(t(`${K}.toast_cleared_partial`), {
        description: t(`${K}.toast_cleared_partial_detail`),
      });
    }
  }, [clear, t]);

  const label = <span className={GROUP_LABEL}>{t(`${K}.section`)}</span>;

  // --- Loading: the real row box wearing slivers, so the height resolves ---
  if (isLoading) {
    return (
      <>
        {label}
        <div className={ROW_GROUP} aria-hidden="true">
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <Skeleton className={cn(SKELETON.SIMS.LABEL, "w-36")} />
              <Skeleton className={cn(SKELETON.SIMS.ID, "w-full")} />
              <Skeleton className={cn(SKELETON.SIMS.ID, "w-2/3")} />
            </div>
            <div className={cn(ROW.CONTROL, "gap-3")}>
              <Skeleton className={SKELETON.SIMS.CHIP} />
              <Skeleton className={SKELETON.SIMS.ACTION} />
            </div>
          </div>
        </div>
      </>
    );
  }

  const failed = count === null;
  const empty = count === 0;

  const consequence = failed
    ? t(`${K}.states.error_description`)
    : empty
      ? t(`${K}.states.empty_description`)
      : t(`${K}.rows.count.consequence`);

  return (
    <>
      {label}
      <div className={ROW_GROUP}>
        {/* Declared here and not inherited: the count lands after the page's
            cascade has run, and a variants-only child would wait at opacity 0. */}
        <motion.div
          variants={staggerRowItem}
          initial="hidden"
          animate="visible"
          className={ROW.ROOT}
          role={failed ? "alert" : undefined}
        >
          <div className={ROW.TEXT}>
            <span className={ROW.LABEL}>
              {failed
                ? t(`${K}.states.error_title`)
                : t(`${K}.rows.count.label`)}
            </span>
            <span className={ROW.CONSEQUENCE}>{consequence}</span>
          </div>
          <div className={cn(ROW.CONTROL, "gap-3")}>
            <span className={VALUE}>{failed ? VALUE_NONE : count}</span>
            {failed ? (
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => void refresh()}
              >
                <RotateCwIcon className={PILL_GLYPH} aria-hidden="true" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            ) : empty ? null : (
              <RevealLabelButton
                icon={Trash2Icon}
                label={t(`${K}.clear_button`)}
                variant="tonal-destructive"
                onClick={() => setOpen(true)}
                disabled={isClearing}
              />
            )}
          </div>
        </motion.div>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.clear_dialog_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.clear_dialog_description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing} size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="action"
              disabled={isClearing}
              onClick={(e) => {
                // Keep the dialog mounted through the request so the button can
                // show its own in-flight state; Radix would close it otherwise.
                e.preventDefault();
                void handleClear();
              }}
            >
              {isClearing ? (
                <>
                  <Loader2Icon
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  {t(`${K}.clear_dialog_clearing`)}
                </>
              ) : (
                t(`${K}.clear_dialog_confirm`)
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

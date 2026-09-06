"use client";

import type * as React from "react";
import { DownloadIcon, Loader2Icon, PlayIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { PAGE_HEAD, PILL_ACTION, PILL_GLYPH, SKELETON, SPIN } from "./shapes";

const K = "actions";

export interface PageHeaderProps {
  isLoading: boolean;
  isRunning: boolean;
  isStarting: boolean;
  isClearing: boolean;
  isDownloading: boolean;
  canDownload: boolean;
  canClear: boolean;
  onRun: () => void;
  onClear: () => void;
  onDownload: () => void;
}

/**
 * The page's one title and its one Run button. The actions live here rather
 * than in a card so they wrap under the title instead of into a phone-width grid.
 */
export function PageHeader({
  isLoading,
  isRunning,
  isStarting,
  isClearing,
  isDownloading,
  canDownload,
  canClear,
  onRun,
  onClear,
  onDownload,
}: PageHeaderProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const busy = isRunning || isStarting;

  return (
    <motion.header variants={staggerItem} className={PAGE_HEAD.ROOT}>
      <div className={PAGE_HEAD.TITLES}>
        <h1 className={PAGE_HEAD.TITLE}>{t("page.title")}</h1>
        <p className={PAGE_HEAD.DESC}>{t("page.description")}</p>
      </div>

      <div className={PAGE_HEAD.ACTIONS}>
        {isLoading ? (
          <Skeleton className={SKELETON.ACTION} />
        ) : (
          <>
            <Button className={PILL_ACTION} onClick={onRun} disabled={busy}>
              {busy ? (
                <>
                  <Loader2Icon
                    className={cn(PILL_GLYPH, SPIN)}
                    aria-hidden="true"
                  />
                  {t(`${K}.running`)}
                </>
              ) : (
                <>
                  <PlayIcon className={PILL_GLYPH} aria-hidden="true" />
                  {t(`${K}.run`)}
                </>
              )}
            </Button>

            {canDownload && (
              <Button
                variant="outline"
                className={PILL_ACTION}
                onClick={onDownload}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <>
                    <Loader2Icon
                      className={cn(PILL_GLYPH, SPIN)}
                      aria-hidden="true"
                    />
                    {t(`${K}.downloading`)}
                  </>
                ) : (
                  <>
                    <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
                    {t(`${K}.download`)}
                  </>
                )}
              </Button>
            )}

            {canClear && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="tonal-destructive"
                    className={PILL_ACTION}
                    disabled={isClearing}
                  >
                    {isClearing ? (
                      <>
                        <Loader2Icon
                          className={cn(PILL_GLYPH, SPIN)}
                          aria-hidden="true"
                        />
                        {t(`${K}.clearing`)}
                      </>
                    ) : (
                      <>
                        <Trash2Icon className={PILL_GLYPH} aria-hidden="true" />
                        {t(`${K}.clear`)}
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("clear_dialog.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("clear_dialog.description")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("clear_dialog.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onClear}
                      className={buttonVariants({ variant: "destructive" })}
                    >
                      {t("clear_dialog.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        )}
      </div>
    </motion.header>
  );
}

export default PageHeader;

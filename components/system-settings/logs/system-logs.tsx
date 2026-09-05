"use client";

import * as React from "react";
import { Loader2Icon, RefreshCcwIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import { useSystemLogs } from "@/hooks/use-system-logs";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { StatusBand } from "./status-band";
import { TranscriptCard } from "./transcript-card";
import { PAGE_HEAD, PAGE_ROOT, PILL_ACTION, PILL_GLYPH } from "./shapes";

const K = "logs";

export function SystemLogs(): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const [clearOpen, setClearOpen] = React.useState(false);
  // A confirmation dialog is a deliberate suspension of the feed, and the tile
  // says so: the poll is torn down for as long as this is open.
  const logs = useSystemLogs({ paused: clearOpen });
  const { isRefreshing, isClearing, refresh, clear } = logs;

  const handleRefresh = async () => {
    const ok = await refresh();
    // The toast belongs to the USER-initiated read only. A failed background
    // poll drives the stale notice instead of interrupting.
    if (!ok) toast.error(t(`${K}.toast.refresh_failed`));
  };

  const handleClear = async () => {
    const ok = await clear();
    if (ok) {
      toast.success(t(`${K}.toast.cleared`));
      setClearOpen(false);
    } else {
      toast.error(t(`${K}.toast.clear_failed`));
    }
  };

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once. Every child below is a
          staggerItem and must NOT declare its own, or it detaches from the clock. */}
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              className={PILL_ACTION}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isRefreshing && "animate-spin")}
              />
              {t(`${K}.page.refresh`)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setClearOpen(true)}
              className={PILL_ACTION}
            >
              <Trash2Icon className={PILL_GLYPH} />
              {t(`${K}.page.clear`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusBand logs={logs} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <TranscriptCard logs={logs} />
      </motion.div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.clear_dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.clear_dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>
              {t(`${K}.clear_dialog.cancel`)}
            </AlertDialogCancel>
            {/* The variant carries the role, so the confirm keeps its own
                destructive focus ring — a hand-written fill loses it. */}
            <AlertDialogAction
              variant="destructive"
              disabled={isClearing}
              onClick={(event) => {
                event.preventDefault();
                void handleClear();
              }}
            >
              {isClearing ? (
                <Loader2Icon className={cn(PILL_GLYPH, "animate-spin")} />
              ) : null}
              {isClearing
                ? t(`${K}.clear_dialog.clearing`)
                : t(`${K}.clear_dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export default SystemLogs;

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { itemVariants } from "@/lib/motion";
import { authFetch } from "@/lib/auth-fetch";
import { useTranslation } from "react-i18next";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Loader2, Trash2Icon } from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/known_sims.sh";

interface KnownSimsResponse {
  success: boolean;
  count: number;
  error?: string;
  detail?: string;
}

// A single row inside the System Settings card: shows how many SIMs QManager
// remembers and a Clear control. Clearing keeps the currently-inserted SIM so
// the active SIM is never re-flagged as "new". Self-contained state — fetches
// its own count and survives the parent form's remount-on-save.
export default function KnownSimsRow() {
  const { t } = useTranslation("system-settings");

  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchCount = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return;
      if (data.success) setCount(data.count ?? 0);
    } catch {
      // Silent — the count is informational; clearing still works.
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const handleClear = async () => {
    setIsClearing(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success(t("known_sims.toast_cleared"));
        setCount(data.count ?? 0);
        setShowClearDialog(false);
      } else {
        toast.error(data.detail || t("known_sims.toast_clear_failed"));
      }
    } catch {
      if (mountedRef.current) toast.error(t("known_sims.toast_clear_failed"));
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  };

  return (
    <>
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex"
                aria-label={t("known_sims.info_aria")}
              >
                <TbInfoCircleFilled className="size-5 text-info" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-balance max-w-sm">{t("known_sims.tooltip")}</p>
            </TooltipContent>
          </Tooltip>
          <p className="font-semibold text-muted-foreground text-sm">
            {t("known_sims.row_label")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Skeleton className="h-5 w-14" />
          ) : (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("known_sims.remembered_count", { count })}
            </span>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowClearDialog(true)}
            disabled={isLoading}
          >
            <Trash2Icon className="size-4 mr-1" />
            {t("known_sims.clear_button")}
          </Button>
        </div>
      </motion.div>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("known_sims.clear_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("known_sims.clear_dialog_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              onClick={handleClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1" />
                  {t("known_sims.clear_dialog_clearing")}
                </>
              ) : (
                t("known_sims.clear_dialog_confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

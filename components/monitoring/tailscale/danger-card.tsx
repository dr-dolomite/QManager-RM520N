"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon } from "lucide-react";

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
import { Button } from "@/components/ui/button";

import type { TailscaleActionResult } from "@/hooks/use-tailscale";
import { rebootNow } from "@/lib/reboot";

import { DANGER } from "./shapes";

// -----------------------------------------------------------------------------
// Remove Tailscale — a low-emphasis row. Destructive is the button, not the row.
// -----------------------------------------------------------------------------

export function DangerRow({
  isUninstalling,
  isBusy,
  uninstall,
  onUninstalled,
}: {
  isUninstalling: boolean;
  /** An update holds the install lock; removing the binary under it is refused. */
  isBusy: boolean;
  uninstall: () => Promise<TailscaleActionResult>;
  onUninstalled: () => void;
}) {
  const { t } = useTranslation("common");

  const handleUninstall = async () => {
    const result = await uninstall();
    if (result.ok) {
      toast.success(t("tailscale.toast.uninstalled"));
      onUninstalled();
    } else {
      toast.error(t("tailscale.toast.uninstallFailed"), {
        description: result.reason || undefined,
      });
    }
  };

  return (
    <div className={DANGER.ROOT}>
      <div className={DANGER.TEXT}>
        <p className={DANGER.TITLE}>{t("tailscale.danger.title")}</p>
        <p className={DANGER.DESC}>{t("tailscale.danger.description")}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            disabled={isUninstalling || isBusy}
            size="action"
          >
            {isUninstalling ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            {isUninstalling
              ? t("tailscale.danger.removing")
              : t("tailscale.danger.uninstall")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tailscale.danger.dialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tailscale.danger.dialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleUninstall}>
              {t("tailscale.danger.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The post-uninstall reboot handoff. Owned by the page shell, not by the row —
 * a successful uninstall flips the surface to its not-installed shape, which
 * would unmount the row and take the dialog with it.
 */
export function RebootDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("common");
  const [isRebooting, setIsRebooting] = React.useState(false);

  const reboot = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRebooting(true);
    // Fire-and-forget POST, then the shared /reboot/ countdown hand-off.
    rebootNow("tailscale");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!isRebooting) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tailscale.danger.rebootTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tailscale.danger.rebootDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRebooting}>
            {t("tailscale.danger.rebootLater")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={isRebooting} onClick={reboot}>
            {isRebooting ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : null}
            {isRebooting
              ? t("tailscale.danger.rebooting")
              : t("tailscale.danger.rebootNow")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

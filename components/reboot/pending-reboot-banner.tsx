"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Banner, bannerActionVariants } from "@/components/ui/banner";
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
import { authFetch } from "@/lib/auth-fetch";
import {
  usePendingReboot,
  clearPendingReboot,
  requestRebootLater,
  enterRebootFlow,
  type RebootSource,
} from "@/lib/reboot";

// Deferred-reboot banner, mounted once in the shell. Dismiss sits behind a confirm: the flag
// lives in browser storage and a reboot done another way cannot clear it.

const REBOOT_CGI = "/cgi-bin/quecmanager/system/reboot.sh";

/** Sources with their own consequence line; anything else reads `default`. */
const DESCRIBED_SOURCES: ReadonlySet<RebootSource> = new Set([
  "config_restore",
  "imei",
  "mbn",
]);

export function PendingRebootBanner() {
  const { t } = useTranslation("common");
  const pending = usePendingReboot();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!pending) return null;

  const source = pending.source;
  const descriptionKey = DESCRIBED_SOURCES.has(source) ? source : "default";

  const handleRebootNow = async () => {
    setBusy(true);
    clearPendingReboot();
    try {
      const res = await authFetch(REBOOT_CGI, { method: "POST" });
      if (!res.ok) throw new Error(`reboot_failed: HTTP ${res.status}`);
      // Ends in the /reboot/ hand-off, which is its own confirmation.
      enterRebootFlow(source);
    } catch {
      requestRebootLater(source);
      setBusy(false);
      toast.error(t("pending_reboot.reboot_failed_toast"));
    }
  };

  return (
    <div className="mx-2 mb-2 lg:mx-6">
      <Banner
        role="deferred-reboot"
        title={t("pending_reboot.title")}
        description={t(`pending_reboot.description.${descriptionKey}`)}
        action={
          <>
            <button
              type="button"
              className={bannerActionVariants({ tone: "on-warning" })}
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
            >
              {t("pending_reboot.dismiss")}
            </button>
            <button
              type="button"
              className={bannerActionVariants({ tone: "warning" })}
              onClick={handleRebootNow}
              disabled={busy}
            >
              {busy ? t("pending_reboot.rebooting") : t("pending_reboot.reboot_now")}
            </button>
          </>
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pending_reboot.dismiss_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pending_reboot.dismiss_dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pending_reboot.dismiss_dialog.keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearPendingReboot();
                setConfirmOpen(false);
              }}
            >
              {t("pending_reboot.dismiss_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

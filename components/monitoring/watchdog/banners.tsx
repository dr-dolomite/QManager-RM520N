"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CardSimIcon, RotateCcwIcon } from "lucide-react";

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
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import type { SimFailoverStatus } from "@/types/modem-status";

export interface FailoverBannerProps {
  failover: SimFailoverStatus;
  /** Relative time since the switch, already translated. */
  since: string;
  revertSim: () => Promise<boolean>;
}

/**
 * Running on the backup SIM. The one place the failover can be undone, so it
 * carries the Revert action — dropping it would strand a user on the backup.
 */
export function FailoverBanner({
  failover,
  since,
  revertSim,
}: FailoverBannerProps) {
  const { t } = useTranslation("common");
  const [reverting, setReverting] = React.useState(false);

  const handleRevert = React.useCallback(async () => {
    setReverting(true);
    const ok = await revertSim();
    setReverting(false);
    if (ok) toast.success(t("watchdog.failover.requested"));
    else toast.error(t("watchdog.failover.failed"));
  }, [revertSim, t]);

  return (
    <Banner
      role="degraded"
      icon={CardSimIcon}
      title={t("watchdog.failover.title")}
      description={t("watchdog.failover.body", {
        current: failover.current_slot ?? "?",
        original: failover.original_slot ?? "?",
        since,
      })}
      action={
        <AlertDialog>
          <AlertDialogTrigger
            className={bannerActionVariants({ tone: "on-warning" })}
            disabled={reverting}
          >
            <RotateCcwIcon />
            {reverting
              ? t("watchdog.failover.reverting")
              : t("watchdog.failover.revert")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("watchdog.failover.confirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("watchdog.failover.confirmBody", {
                  original: failover.original_slot ?? "?",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("watchdog.failover.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleRevert()}>
                {t("watchdog.failover.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";
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
import { useModemStatus } from "@/hooks/use-modem-status";
import { postSimDismissal } from "@/hooks/use-sim-registry";

// =============================================================================
// SimSwapBanner — the app-level "new SIM detected" notice.
// =============================================================================
// Mounted once in AppLayout, so it outlives any single page (the persistent
// banner pattern in DESIGN.md). Visibility is driven entirely by the device:
// the poller derives `status.json.sim_swap.detected` from the persistent SIM
// registry, so dismissing a SIM here is durable and un-dismissing it from
// System Settings genuinely brings the banner back. There is deliberately no
// client-side dismissal store — one source of truth, and it is the modem.
//
// The only client-side state is `optimisticallyHidden`: the poll cycle is ~2s,
// so the banner hides immediately on a confirmed dismiss and un-hides if the
// write turns out to have failed.
// =============================================================================

export function SimSwapBanner() {
  const { t } = useTranslation("common");
  const { data: modemStatus } = useModemStatus();

  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [optimisticallyHidden, setOptimisticallyHidden] = useState(false);

  const simSwap = modemStatus?.sim_swap;
  const iccid = modemStatus?.device?.iccid?.trim() ?? "";
  const carrier = modemStatus?.network?.carrier?.trim() ?? "";
  const phoneNumber = modemStatus?.device?.phone_number?.trim() ?? "";

  // Once the device confirms the alert is gone, drop the optimistic hide. The
  // banner is mounted for the whole session, so without this a later
  // un-dismiss from System Settings would need a page reload to be felt.
  useEffect(() => {
    if (!simSwap?.detected) setOptimisticallyHidden(false);
  }, [simSwap?.detected, iccid]);

  const handleDismissConfirm = useCallback(async () => {
    if (!iccid) return;
    setIsDismissing(true);
    const ok = await postSimDismissal(iccid, true);
    setIsDismissing(false);
    setShowDismissDialog(false);

    if (ok) {
      setOptimisticallyHidden(true);
      toast.success(t("sim_swap.toast_dismissed"), {
        description: t("sim_swap.toast_dismissed_detail"),
      });
    } else {
      toast.error(t("sim_swap.toast_dismiss_failed"));
    }
  }, [iccid, t]);

  if (!simSwap?.detected) return null;
  if (optimisticallyHidden) return null;

  const hasMatchingProfile = !!simSwap.matching_profile_id;
  const identity = [carrier, phoneNumber].filter(Boolean);

  return (
    <>
      <div className="px-2 lg:px-6">
        <Banner
          role={hasMatchingProfile ? "sim-swap-matched" : "sim-swap-unmatched"}
          className="mb-2"
          title={t("sim_swap.title")}
          // SIM identity line — carrier, then the MSISDN as a technical
          // identifier (machine voice), or an honest "not provisioned".
          identity={
            <>
              <span className="font-semibold">
                {carrier || t("sim_swap.carrier_unknown")}
              </span>
              <span aria-hidden="true" className="opacity-50">
                ·
              </span>
              {phoneNumber ? (
                <span className="font-mono opacity-85">{phoneNumber}</span>
              ) : (
                <span className="opacity-85">
                  {t("sim_swap.no_phone_number")}
                </span>
              )}
              {identity.length === 0 && iccid ? (
                <span className="font-mono break-all opacity-85">{iccid}</span>
              ) : null}
            </>
          }
          description={
            hasMatchingProfile ? (
              <Trans
                i18nKey="sim_swap.description_match"
                ns="common"
                values={{
                  profile_name: simSwap.matching_profile_name ?? "",
                }}
                components={{
                  strong: <span className="font-semibold break-all" />,
                }}
              />
            ) : (
              t("sim_swap.description_no_match")
            )
          }
          // Exactly one CTA: apply the matching profile, or create one.
          action={
            hasMatchingProfile ? (
              <Link
                href="/cellular/custom-profiles"
                className={bannerActionVariants()}
              >
                {t("sim_swap.apply_profile")}
              </Link>
            ) : (
              <Link
                href="/cellular/custom-profiles?action=create"
                className={bannerActionVariants()}
              >
                {t("sim_swap.create_profile")}
              </Link>
            )
          }
          onDismiss={() => setShowDismissDialog(true)}
          dismissLabel={t("sim_swap.dismiss_aria")}
        />
      </div>

      <AlertDialog
        open={showDismissDialog}
        onOpenChange={(open) => !isDismissing && setShowDismissDialog(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sim_swap.dismiss_dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sim_swap.dismiss_dialog.description", {
                carrier: carrier || t("sim_swap.carrier_unknown"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* The SIM this applies to, spelled out — the scope is this SIM only. */}
          {iccid ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t("sim_swap.dismiss_dialog.sim_label")}
              </p>
              <p className="mt-0.5 font-mono text-sm break-all">{iccid}</p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDismissing}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDismissConfirm();
              }}
              disabled={isDismissing || !iccid}
            >
              {isDismissing ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t("sim_swap.dismiss_dialog.dismissing")}
                </>
              ) : (
                t("sim_swap.dismiss_dialog.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { CardSimIcon, Loader2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
        <Alert className="relative mb-2 border-info/30 bg-info/10 pr-11 duration-300 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none">
          <CardSimIcon className="size-4 text-info" />
          <div className="col-start-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="space-y-1">
              <AlertTitle className="text-foreground">
                {t("sim_swap.title")}
              </AlertTitle>

              {/* SIM identity line — carrier, then the MSISDN as a technical
                  identifier (machine voice), or an honest "not provisioned". */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-medium text-foreground">
                  {carrier || t("sim_swap.carrier_unknown")}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                {phoneNumber ? (
                  <span className="font-mono text-muted-foreground">
                    {phoneNumber}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("sim_swap.no_phone_number")}
                  </span>
                )}
                {identity.length === 0 && iccid ? (
                  <span className="font-mono text-muted-foreground break-all">
                    {iccid}
                  </span>
                ) : null}
              </div>

              <AlertDescription>
                {hasMatchingProfile ? (
                  <Trans
                    i18nKey="sim_swap.description_match"
                    ns="common"
                    values={{
                      profile_name: simSwap.matching_profile_name ?? "",
                    }}
                    components={{
                      strong: (
                        <span className="font-medium text-foreground break-all" />
                      ),
                    }}
                  />
                ) : (
                  t("sim_swap.description_no_match")
                )}
              </AlertDescription>
            </div>

            {/* Exactly one CTA: apply the matching profile, or create one. */}
            {hasMatchingProfile ? (
              <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
                <Link href="/cellular/custom-profiles">
                  {t("sim_swap.apply_profile")}
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
                <Link href="/cellular/custom-profiles?action=create">
                  {t("sim_swap.create_profile")}
                </Link>
              </Button>
            )}
          </div>

          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowDismissDialog(true)}
            aria-label={t("sim_swap.dismiss_aria")}
            className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-4" />
          </Button>
        </Alert>
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

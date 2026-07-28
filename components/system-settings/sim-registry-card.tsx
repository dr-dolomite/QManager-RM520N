"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  CardSimIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  MinusCircleIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useKnownSims } from "@/hooks/use-known-sims";
import { useSimRegistry } from "@/hooks/use-sim-registry";
import type { SimRegistryEntry } from "@/types/sim-registry";

// =============================================================================
// SimRegistryCard — every SIM QManager remembers, and its alert state.
// =============================================================================
// The read side of the persistent SIM registry. The SIM-swap banner writes the
// "stop alerting for this SIM" flag; this card is where a user takes it back.
// Dismissing is deliberately NOT offered here — silencing an alert belongs to
// the alert itself, so this surface only ever re-enables.
//
// The card also owns Clear (previously a row inside the System Settings card,
// where a destructive SIM action sat oddly on top of display preferences).
// Colocating matters beyond tidiness: Clear acts on the known-SIMs SET while
// this list renders the registry SIDECAR, two separate stores. With one owner,
// a clear necessarily refreshes the list, so the count and the list cannot
// drift apart the way they did when the control lived on another card.
// =============================================================================

function formatFirstSeen(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale || undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SimRegistryRow({
  sim,
  isPending,
  onShowAlert,
}: {
  sim: SimRegistryEntry;
  isPending: boolean;
  onShowAlert: (sim: SimRegistryEntry) => void;
}) {
  const { t, i18n } = useTranslation("system-settings");
  const addedOn = formatFirstSeen(sim.first_seen, i18n.language);

  return (
    <motion.div
      variants={staggerItem}
      className={
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-2 py-1.5 " +
        (sim.active ? "border border-primary/30 bg-primary/5" : "border border-transparent")
      }
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold break-words">
            {sim.carrier || t("sim_registry.carrier_unknown")}
          </p>
          {sim.active && (
            <Badge variant="success">
              <CheckCircle2Icon className="size-3" />
              {t("sim_registry.badge_active")}
            </Badge>
          )}
        </div>

        <p className="text-sm">
          {sim.phone_number ? (
            <span className="font-mono tabular-nums">{sim.phone_number}</span>
          ) : (
            <span className="text-muted-foreground">
              {t("sim_registry.no_phone_number")}
            </span>
          )}
        </p>

        <p className="text-xs text-muted-foreground">
          <span className="font-mono break-all">{sim.iccid}</span>
          <span aria-hidden="true"> · </span>
          {addedOn
            ? t("sim_registry.added_on", { date: addedOn })
            : t("sim_registry.added_unknown")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {sim.dismissed ? (
          <Badge variant="muted">
            <MinusCircleIcon className="size-3" />
            {t("sim_registry.badge_alerts_off")}
          </Badge>
        ) : (
          <Badge variant="info">
            <BellIcon className="size-3" />
            {t("sim_registry.badge_alerts_on")}
          </Badge>
        )}

        {sim.dismissed && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => onShowAlert(sim)}
          >
            {isPending ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                {t("sim_registry.restoring")}
              </>
            ) : (
              <>
                <BellIcon className="size-4" />
                {t("sim_registry.show_alert")}
              </>
            )}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// --- Footer: how many SIMs are remembered, and the control that forgets them --
// Rendered whenever EITHER store has something in it, so a divergence between
// them (list empty, count non-zero) still leaves the user a way to reset.
function ClearKnownSimsFooter({
  count,
  isLoading,
  isClearing,
  onConfirm,
}: {
  count: number;
  isLoading: boolean;
  isClearing: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation("system-settings");
  const [open, setOpen] = useState(false);

  const handleConfirm = useCallback(async () => {
    await onConfirm();
    setOpen(false);
  }, [onConfirm]);

  return (
    <>
      <CardFooter className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                // -ml-1.5 cancels the icon button's own box inset so the glyph
                // sits on the card's content column, flush with the title and
                // description above it rather than 6px inboard of them.
                className="-ml-1.5 text-info hover:text-info"
                aria-label={t("known_sims.info_aria")}
              >
                <InfoIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-sm text-balance">{t("known_sims.tooltip")}</p>
            </TooltipContent>
          </Tooltip>

          {isLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <span className="tabular-nums">
              {t("sim_registry.remembered_count", { count })}
            </span>
          )}
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={isLoading || isClearing}
        >
          <Trash2Icon className="size-4" />
          {t("known_sims.clear_button")}
        </Button>
      </CardFooter>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("known_sims.clear_dialog_title")}
            </AlertDialogTitle>
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
              onClick={(e) => {
                // Keep the dialog mounted through the request so the button can
                // show its own in-flight state; Radix would close it otherwise.
                e.preventDefault();
                void handleConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
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

export default function SimRegistryCard() {
  const { t } = useTranslation("system-settings");
  const { sims, isLoading, error, pendingIccid, refresh, setDismissed } =
    useSimRegistry();
  const {
    count: knownCount,
    isLoading: isKnownLoading,
    isClearing,
    clear: clearKnownSims,
  } = useKnownSims();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleShowAlert = useCallback(
    async (sim: SimRegistryEntry) => {
      const ok = await setDismissed(sim.iccid, false);
      if (ok) {
        toast.success(t("sim_registry.toast_restored"), {
          description: t("sim_registry.toast_restored_detail", {
            carrier: sim.carrier || t("sim_registry.carrier_unknown"),
          }),
        });
      } else {
        toast.error(t("sim_registry.toast_restore_failed"));
      }
    },
    [setDismissed, t],
  );

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    await refresh();
    setIsRetrying(false);
  }, [refresh]);

  const handleClear = useCallback(async () => {
    const result = await clearKnownSims();

    if (!result.ok) {
      toast.error(result.detail || t("known_sims.toast_clear_failed"));
      return;
    }

    // The device clears both stores, so the list this card renders has changed
    // underneath us. Refetch rather than trusting a local prediction of it.
    await refresh();

    if (result.registryCleared) {
      toast.success(t("known_sims.toast_cleared"));
    } else {
      // The set was cleared but the registry sidecar was not. Say so instead
      // of reporting a clean sweep the device did not perform.
      toast.warning(t("sim_registry.toast_cleared_partial"), {
        description: t("sim_registry.toast_cleared_partial_detail"),
      });
    }
  }, [clearKnownSims, refresh, t]);

  const header = (
    <CardHeader>
      <CardTitle>{t("sim_registry.title")}</CardTitle>
      <CardDescription>{t("sim_registry.description")}</CardDescription>
    </CardHeader>
  );

  // Only offer Clear when there is something to forget. Either store counts:
  // if they ever disagree, the reset is exactly what resolves it.
  const footer =
    knownCount > 0 || sims.length > 0 ? (
      <ClearKnownSimsFooter
        count={knownCount}
        isLoading={isKnownLoading}
        isClearing={isClearing}
        onConfirm={handleClear}
      />
    ) : null;

  // --- Loading skeleton (mirrors three data rows) ---
  if (isLoading) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <div className="grid gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Separator className="mb-2" />
                <div className="flex items-center justify-between gap-4 px-2 py-1.5">
                  <div className="space-y-1.5">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between border-t">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-20" />
        </CardFooter>
      </Card>
    );
  }

  // --- Error state (only when there is nothing to show) ---
  if (error && sims.length === 0) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="flex flex-col gap-3">
          <Alert variant="destructive">
            <TriangleAlertIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isRetrying}
            className="self-start"
          >
            {isRetrying && <Loader2Icon className="size-4 animate-spin" />}
            {t("sim_registry.retry")}
          </Button>
        </CardContent>
        {footer}
      </Card>
    );
  }

  // --- Empty state ---
  if (sims.length === 0) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent>
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CardSimIcon />
              </EmptyMedia>
              <EmptyTitle>{t("sim_registry.empty_title")}</EmptyTitle>
              <EmptyDescription>
                {t("sim_registry.empty_description")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
        {footer}
      </Card>
    );
  }

  // --- Data state ---
  return (
    <Card className="@container/card">
      {header}
      <CardContent>
        <motion.div
          // Keeps a long registry from stretching the settings grid; short
          // lists (the normal case) never reach the cap.
          className="grid max-h-96 gap-2 overflow-y-auto"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {sims.map((sim) => (
            <div key={sim.iccid} className="grid gap-2">
              <Separator />
              <SimRegistryRow
                sim={sim}
                isPending={pendingIccid === sim.iccid}
                onShowAlert={handleShowAlert}
              />
            </div>
          ))}
        </motion.div>

        {/* A stale read shouldn't blank the list; say so instead. */}
        {error && (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {t("sim_registry.stale_notice")}
          </p>
        )}
      </CardContent>
      {footer}
    </Card>
  );
}

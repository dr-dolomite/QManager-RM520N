"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  CardSimIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { containerVariants, itemVariants } from "@/lib/motion";
import { useSimRegistry } from "@/hooks/use-sim-registry";
import type { SimRegistryEntry } from "@/types/sim-registry";

// =============================================================================
// SimRegistryCard — every SIM QManager remembers, and its alert state.
// =============================================================================
// The read side of the persistent SIM registry. The SIM-swap banner writes the
// "stop alerting for this SIM" flag; this card is where a user takes it back.
// Dismissing is deliberately NOT offered here — silencing an alert belongs to
// the alert itself, so this surface only ever re-enables.
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
      variants={itemVariants}
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
            <Badge
              variant="outline"
              className="bg-success/15 text-success hover:bg-success/20 border-success/30"
            >
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
          <Badge
            variant="outline"
            className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
          >
            <MinusCircleIcon className="size-3" />
            {t("sim_registry.badge_alerts_off")}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-info/15 text-info hover:bg-info/20 border-info/30"
          >
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

export default function SimRegistryCard() {
  const { t } = useTranslation("system-settings");
  const { sims, isLoading, error, pendingIccid, refresh, setDismissed } =
    useSimRegistry();
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

  const header = (
    <CardHeader>
      <CardTitle>{t("sim_registry.title")}</CardTitle>
      <CardDescription>{t("sim_registry.description")}</CardDescription>
    </CardHeader>
  );

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
          variants={containerVariants}
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
    </Card>
  );
}

"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { useForceTcp } from "@/hooks/use-force-tcp";

// =============================================================================
// ForceTcpTile — QUIC Force-TCP control, fully independent of the engine.
// Renders at the very bottom of the Traffic Engine page (below onboarding,
// the tabs, and the Test bypass card) so it never reads as part of "the
// traffic engine stuff". The switch auto-applies: toggling POSTs
// action=save_force_tcp, and the CGI applies/removes the iptables rule
// immediately (the 60s ensure timer reconciles it afterwards). No engine
// binary, no engine state, no mutex — install/uninstall ignore it.
// =============================================================================

export interface ForceTcpTileProps {
  /** Show a skeleton in place of the tile body (page-level loading). */
  compact?: boolean;
}

const ForceTcpTile = ({ compact = false }: ForceTcpTileProps) => {
  const { t } = useTranslation("common");
  const forceTcp = useForceTcp();

  const commit = async (next: boolean) => {
    const ok = await forceTcp.save(next);
    if (ok) {
      toast.success(
        next
          ? t("trafficEngine.forceTcp.toast_enabled")
          : t("trafficEngine.forceTcp.toast_disabled"),
      );
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("trafficEngine.forceTcp.title")}</CardTitle>
        <CardDescription>
          {t("trafficEngine.forceTcp.description")}
        </CardDescription>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("trafficEngine.forceTcp.independent")}
        </p>
      </CardHeader>
      <CardContent>
        {compact || forceTcp.isLoading ? (
          <div className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {t("trafficEngine.forceTcp.label")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("trafficEngine.forceTcp.switch_hint")}
                </p>
              </div>
              <Switch
                checked={forceTcp.data?.force_tcp ?? false}
                disabled={forceTcp.isSaving}
                aria-label={t("trafficEngine.forceTcp.switch_aria")}
                onCheckedChange={commit}
              />
            </div>

            <div className="flex items-start gap-2 rounded-tile bg-surface-container p-3">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("trafficEngine.forceTcp.compatible")}
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-tile bg-surface-container p-3">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm text-muted-foreground">
                {t("trafficEngine.forceTcp.caveat")}
              </p>
            </div>

            {forceTcp.error && (
              <Alert variant="destructive">
                <TriangleAlertIcon className="size-4" />
                <AlertDescription>{forceTcp.error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ForceTcpTile;
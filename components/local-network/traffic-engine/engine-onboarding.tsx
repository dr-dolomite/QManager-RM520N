"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import type { InstallPhase } from "@/types/traffic-engine";

// =============================================================================
// engine-onboarding — binary provisioning: shown whenever the tpws binary is
// missing. One-click "Download & install" spawns qmanager_dpi_install (the
// CGI's install action) and reports progress from install_status until the
// terminal state. The engine starts automatically once installed (the
// ensure timer picks it up), so this card is also the engine's "ready"
// confirmation.
// =============================================================================

export interface EngineOnboardingProps {
  binaryInstalled: boolean;
  isInstalling: boolean;
  installPhase: InstallPhase;
  installMessage: string | null;
  onInstall: () => Promise<boolean>;
}

const EngineOnboarding = ({
  binaryInstalled,
  isInstalling,
  installPhase,
  installMessage,
  onInstall,
}: EngineOnboardingProps) => {
  const { t } = useTranslation("common");

  if (binaryInstalled) {
    return null;
  }

  const isBusy = isInstalling || installPhase === "running";
  const failed = installPhase === "error";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("trafficEngine.onboarding.title")}</CardTitle>
        <CardDescription>{t("trafficEngine.onboarding.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {failed ? (
            <Alert variant="destructive">
              <XCircleIcon className="size-4" />
              <AlertDescription>
                {t("trafficEngine.onboarding.error", { detail: installMessage ?? "" })}
              </AlertDescription>
            </Alert>
          ) : (
            installPhase === "complete" && (
              <Alert>
                <CheckCircle2Icon className="size-4" />
                <AlertDescription>{t("trafficEngine.onboarding.done")}</AlertDescription>
              </Alert>
            )
          )}

          <div className="flex items-center gap-3">
            <Button onClick={onInstall} disabled={isBusy}>
              {isBusy ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t("trafficEngine.onboarding.installing")}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-4" />
                  {t("trafficEngine.onboarding.install")}
                </>
              )}
            </Button>
            <Badge variant={failed ? "destructive" : "muted"}>
              {failed ? <TriangleAlertIcon /> : <DownloadIcon />}
              {failed
                ? t("trafficEngine.status.error")
                : installPhase === "complete"
                  ? t("trafficEngine.onboarding.done")
                  : installPhase === "running"
                    ? t("trafficEngine.onboarding.installing")
                    : t("trafficEngine.status.binary_missing")}
            </Badge>
          </div>

          {installMessage && (
            <p className="text-sm text-muted-foreground break-words">{installMessage}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EngineOnboarding;
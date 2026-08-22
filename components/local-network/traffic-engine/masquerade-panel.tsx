"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircleIcon } from "lucide-react";

import EngineEnableRow from "./engine-enable-row";
import EngineCheckRow from "./engine-check-row";
import type { UseTrafficMasqueradeReturn } from "@/hooks/use-traffic-masquerade";

// =============================================================================
// masquerade-panel — Traffic Masquerade tab: enable row only.
// Enabling disables Video Optimizer (backend-enforced mutex, UI confirms via
// the takeover dialog in engine-enable-row).
//
// Divergence from the RM551 UI: the spoofed-SNI domain field is not shown —
// tpws has no fake-ClientHello mode (nfqws-only). Masquerade instead applies
// the ClientHello-splitting desync to EVERY connection, which defeats
// SNI-based throttling for all destinations. The API contract's sni_domain
// key is still sent (speedtest.net default) and stored, but is inert in the
// tpws engine — see docs/reference/dpi.md.
// =============================================================================

export interface MasqueradePanelProps {
  masquerade: UseTrafficMasqueradeReturn;
  videoOptimizerEnabled: boolean;
}

const MasqueradePanel = ({ masquerade, videoOptimizerEnabled }: MasqueradePanelProps) => {
  const { t } = useTranslation("common");

  const data = masquerade.data;
  const [prevData, setPrevData] = useState(data);
  const [isEnabled, setIsEnabled] = useState(data?.enabled ?? false);

  // Render-phase sync of server state (React-Compiler safe, mirrors ttl card).
  if (data !== prevData) {
    setPrevData(data);
    setIsEnabled(data?.enabled ?? false);
  }

  if (masquerade.isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.tabs.masquerade")}</CardTitle>
          <CardDescription>
            {t("trafficEngine.enable.description_masq")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {masquerade.error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>{masquerade.error}</AlertDescription>
        </Alert>
      )}

      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.tabs.masquerade")}</CardTitle>
          <CardDescription>
            {t("trafficEngine.enable.description_masq")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* The enable row saves on toggle (like the Video Optimizer tab) —
              no explicit Apply button. The RM551 UI this was ported from
              needed one for its SNI text field, which tpws made moot. */}
          <EngineEnableRow
            enabled={isEnabled}
            otherEnabled={videoOptimizerEnabled}
            isSaving={masquerade.isSaving}
            otherModeLabel={t("trafficEngine.tabs.video_optimizer")}
            title={t("trafficEngine.enable.masquerade")}
            description={t("trafficEngine.enable.description_masq")}
            toastEnabled={t("trafficEngine.enable.toast_enabled_masq")}
            toastDisabled={t("trafficEngine.enable.toast_disabled_masq")}
            onSave={async (v) => masquerade.save(v, "speedtest.net")}
          />
        </CardContent>
      </Card>

      <EngineCheckRow binaryInstalled={data?.binary_installed ?? false} />
    </div>
  );
};

export default MasqueradePanel;
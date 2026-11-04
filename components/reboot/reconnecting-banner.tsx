"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnectionStatus } from "@/lib/reboot/connection";

/**
 * Banner shown while health checks are failing, driven by use-auto-logout. Enter-only motion
 * (DESIGN.md > The Enter-Only Rule): it leaves instantly when contact returns.
 */
export function ReconnectingBanner() {
  const { reconnecting } = useConnectionStatus();
  const { t } = useTranslation("common");

  if (!reconnecting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-banner-in mx-2 mb-2 flex items-center gap-2 rounded-field bg-warning-container px-3 py-2 text-sm text-on-warning-container lg:mx-6"
    >
      <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      <span>{t("connection.reconnecting")}</span>
    </div>
  );
}

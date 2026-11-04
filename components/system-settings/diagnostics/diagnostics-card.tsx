"use client";

import type * as React from "react";
import { CircleAlertIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CARD_FOOT, CARD_FOOT_ACTIONS } from "@/components/ui/card-foot";
import { useDiagnostics } from "@/hooks/use-diagnostics";
import { cn } from "@/lib/utils";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  NOTICE,
  PILL_GLYPH,
} from "../shapes";

// Debug Report: a one-click plain-text snapshot, mounted at the foot of System
// Health Check in every state. An operational action, so the foot holds only it.

const K = "diagnostics";

export function DiagnosticsCard(): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const { stage, error, capture } = useDiagnostics();

  const isCapturing = stage === "capturing";

  const handleCapture = async () => {
    const result = await capture();
    if (result.ok) {
      toast.success(t(`${K}.toast_success`));
    } else {
      toast.error(t(`${K}.toast_failed`), { description: result.reason });
    }
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card_description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        <p className="text-on-surface-variant max-w-[72ch] text-sm leading-relaxed text-pretty">
          {t(`${K}.body`)}
        </p>

        {/* Not a live region: the failure toast already announces this reason. */}
        {stage === "error" && error ? (
          <div className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{error}</span>
          </div>
        ) : null}

        <div className={cn(CARD_FOOT, "pt-0")}>
          <div className={CARD_FOOT_ACTIONS}>
            <Button
              type="button"
              size="action"
              onClick={() => void handleCapture()}
              disabled={isCapturing}
            >
              {isCapturing ? (
                <Loader2Icon
                  className={cn(PILL_GLYPH, "motion-safe:animate-spin")}
                  aria-hidden="true"
                />
              ) : (
                <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              )}
              {isCapturing
                ? t(`${K}.button_capturing`)
                : t(`${K}.button_capture`)}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default DiagnosticsCard;

"use client";

import { useTranslation } from "react-i18next";
import { DownloadIcon, Loader2Icon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CHIP_GLYPH, CONDITION } from "./shapes";
import type { InstallPhase } from "@/types/traffic-engine";

// =============================================================================
// Onboarding — the engine-not-installed condition screen
// =============================================================================
// Replaces `engine-onboarding.tsx`, which was a card with a stock `Alert`, a
// button and a badge in a row. This is a CONDITION SCREEN: the page has no
// engine to report on, so there is no strip above it and nothing else to
// anchor — which makes this the anchor, and the one surface in the family
// wearing `rounded-hero`.
//
// The three states it can be in are three different sentences, not one card
// with a chip that changes:
//
//   not installed  what will happen, what it costs, and one action.
//   installing     what is being verified right now, with the spinner ON the
//                  disc rather than beside the button. The install genuinely
//                  takes about a minute, so the screen has to be readable for
//                  that long rather than being a button in a busy state.
//   failed         the modem's own detail, verbatim, plus the action again.
//                  A retry that hides why the last one failed is a dare.
//
// `info` resolves to the brand ramp per The Info-Is-Brand Rule. The CTA takes
// the `Button` primitive's default `bg-primary` fill on that container — the
// same pairing `bannerActionVariants` uses for its `primary` tone.
// =============================================================================

export interface OnboardingProps {
  isInstalling: boolean;
  installPhase: InstallPhase;
  installMessage: string | null;
  onInstall: () => Promise<boolean>;
  onDismissError: () => void;
}

export function Onboarding({
  isInstalling,
  installPhase,
  installMessage,
  onInstall,
  onDismissError,
}: OnboardingProps) {
  const { t } = useTranslation("common");

  const busy = isInstalling || installPhase === "running";
  const failed = installPhase === "error";

  if (busy) {
    return (
      <div className={cn(CONDITION.ROOT, CONDITION.INFO)} role="status">
        <span className={cn(CONDITION.DISC, CONDITION.DISC_INFO)}>
          <Loader2Icon className={cn(CONDITION.GLYPH, "animate-spin")} aria-hidden="true" />
        </span>
        <h2 className={CONDITION.TITLE}>
          {t("trafficEngine.onboarding.installing_heading")}
        </h2>
        <p className={CONDITION.BODY}>
          {t("trafficEngine.onboarding.installing_body")}
        </p>
        {installMessage !== null ? (
          <Badge variant="info">
            <DownloadIcon className={CHIP_GLYPH} aria-hidden="true" />
            {installMessage}
          </Badge>
        ) : null}
      </div>
    );
  }

  if (failed) {
    return (
      <div className={cn(CONDITION.ROOT, CONDITION.DESTRUCTIVE)} role="alert">
        <span className={cn(CONDITION.DISC, CONDITION.DISC_DESTRUCTIVE)}>
          <XCircleIcon className={CONDITION.GLYPH} aria-hidden="true" />
        </span>
        <h2 className={CONDITION.TITLE}>
          {t("trafficEngine.onboarding.failed_heading")}
        </h2>
        <p className={CONDITION.BODY}>
          {installMessage ?? t("trafficEngine.binary_op_failed")}
        </p>
        <Button
          onClick={() => {
            // Clearing the previous failure first, so the retry does not start
            // underneath the error that describes the attempt before it.
            onDismissError();
            onInstall();
          }}
          className={CONDITION.ACTION}
        >
          <DownloadIcon className="size-4" />
          {t("trafficEngine.onboarding.install")}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(CONDITION.ROOT, CONDITION.INFO)}>
      <span className={cn(CONDITION.DISC, CONDITION.DISC_INFO)}>
        <DownloadIcon className={CONDITION.GLYPH} aria-hidden="true" />
      </span>
      <h2 className={CONDITION.TITLE}>{t("trafficEngine.onboarding.heading")}</h2>
      <p className={CONDITION.BODY}>{t("trafficEngine.onboarding.body")}</p>
      <Button onClick={onInstall} className={CONDITION.ACTION}>
        <DownloadIcon className="size-4" />
        {t("trafficEngine.onboarding.install")}
      </Button>
    </div>
  );
}

export default Onboarding;

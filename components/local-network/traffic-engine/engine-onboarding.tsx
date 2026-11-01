"use client";

import { Trans, useTranslation } from "react-i18next";
import { Download, Loader2, PackageIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { InstallPhase } from "@/types/traffic-engine";
import { ResultAlert } from "./result-alert";
import { CARD_PAD, CONDITION, CONDITION_TONE, HERO_SHELL, NOTICE_DETAIL } from "./shapes";

/** The installer's step lines end in "..."; this surface shows no trailing ellipsis. */
const stepText = (message: string) => message.replace(/\s*(\.\.\.|…)$/, "");

interface EngineOnboardingProps {
  phase: InstallPhase;
  /** The worker's current step, or its failure text. */
  message: string | null;
  installing: boolean;
  onInstall: () => void;
  onRefresh: () => void;
}

/**
 * The not-installed shape of the page: one hero card that IS the state. One install unlocks
 * both modes, so it replaces the Engine card and the mode pair.
 */
export function EngineOnboarding({
  phase,
  message,
  installing,
  onInstall,
  onRefresh,
}: EngineOnboardingProps) {
  const { t } = useTranslation("local-network");
  const running = installing || phase === "running";
  const tone = CONDITION_TONE.muted;

  return (
    <Card className={HERO_SHELL}>
      <CardContent className={CARD_PAD} aria-live="polite">
        <div className={cn(CONDITION.ROOT, tone.ROOT)}>
          <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
            <PackageIcon className={CONDITION.GLYPH} />
          </span>
          <h2 className={CONDITION.TITLE}>{t("traffic_engine.onboarding_title")}</h2>
          <p className={CONDITION.DESC}>
            {t("traffic_engine.onboarding_description")}{" "}
            <Trans
              i18nKey="traffic_engine.onboarding_zapret_attribution"
              ns="local-network"
              components={{
                link: (
                  <a
                    href="https://github.com/bol-van/zapret"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  />
                ),
              }}
            />
          </p>

          <div className={CONDITION.ACTIONS}>
            <Button size="action" onClick={onInstall} disabled={running}>
              {running ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {running
                ? t("traffic_engine.onboarding_installing")
                : t("traffic_engine.onboarding_install")}
            </Button>
            <Button
              variant="ghost"
              size="action"
              onClick={onRefresh}
              disabled={running}
              className={tone.ACTION}
            >
              <RefreshCcwIcon aria-hidden="true" />
              {t("traffic_engine.onboarding_check_again")}
            </Button>
          </div>

          {running && message ? <p className={CONDITION.STEP}>{stepText(message)}</p> : null}

          {phase === "error" ? (
            <div className={CONDITION.NOTES}>
              <ResultAlert tone="destructive">
                {t("traffic_engine.onboarding_failed")}
                {message ? <span className={NOTICE_DETAIL}>{message}</span> : null}
              </ResultAlert>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

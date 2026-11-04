"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DUR, EASE_EMPHASIZED, EASE_STANDARD } from "@/lib/motion";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { SHELL_CARD } from "./shapes";

// One card on the canvas (a wizard shell, not a feature page, so the column cap is allowed).
// Steps enter with a directional slide and no exit; the dots animate width so the caps stay round.

const STEP_LABEL_KEYS = [
  "step_label_welcome",
  "step_label_password",
  "step_label_network_mode",
  "step_label_connection",
  "step_label_band_preferences",
  "step_label_web_port",
  "step_label_complete",
] as const;

export const TOTAL_STEPS = STEP_LABEL_KEYS.length;

interface OnboardingShellProps {
  /** 1-based step index */
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  isLoading?: boolean;
  continueLabel?: string;
  continueDisabled?: boolean;
  children: React.ReactNode;
}

export function OnboardingShell({
  currentStep,
  onNext,
  onBack,
  onSkip,
  isLoading = false,
  continueLabel,
  continueDisabled = false,
  children,
}: OnboardingShellProps) {
  const [prevStep, setPrevStep] = useState(currentStep);
  const [direction, setDirection] = useState(1);

  const { t } = useTranslation("onboarding");

  // Derived during render: the slide direction follows the step prop.
  if (prevStep !== currentStep) {
    setDirection(currentStep > prevStep ? 1 : -1);
    setPrevStep(currentStep);
  }

  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === TOTAL_STEPS;
  const showBack = !isFirstStep && !isLastStep;
  const showSkip = !!onSkip && !isFirstStep && !isLastStep;

  const defaultContinueLabel = isFirstStep
    ? t("shell.button_continue_first")
    : isLastStep
      ? t("shell.button_continue_last")
      : t("shell.button_continue");

  const labelKey = STEP_LABEL_KEYS[currentStep - 1];
  const currentStepLabel = labelKey ? t(`shell.${labelKey}`) : "";

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-6 sm:p-6">
      {/* Screen-reader live region */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {currentStepLabel
          ? t("shell.aria_live_step_indicator", {
              step: currentStep,
              total: TOTAL_STEPS,
              label: currentStepLabel,
            })
          : ""}
      </p>

      <div className="w-full max-w-md">
        <div className={SHELL_CARD}>
          <div
            role="progressbar"
            aria-valuenow={currentStep}
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-label={t("shell.aria_progressbar_label", {
              step: currentStep,
              total: TOTAL_STEPS,
            })}
            className="flex items-center justify-center gap-2"
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => {
              const step = i + 1;
              const reached = step <= currentStep;
              const isCurrent = step === currentStep;
              return (
                <motion.span
                  key={step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "block h-2 rounded-pill transition-colors duration-[var(--duration-standard)] ease-standard",
                    reached ? "bg-primary" : "bg-surface-container-high",
                  )}
                  initial={false}
                  animate={{ width: isCurrent ? "1.5rem" : "0.5rem" }}
                  transition={{ duration: DUR.emphasized, ease: EASE_EMPHASIZED }}
                />
              );
            })}
          </div>

          <div className="overflow-hidden">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
            >
              {children}
            </motion.div>
          </div>

          {!isLastStep && (
            <div className="flex items-center justify-between gap-3">
              {showBack ? (
                <Button
                  variant="ghost"
                  onClick={onBack}
                  disabled={isLoading}
                  className="gap-1.5 text-on-surface-variant"
                >
                  <ArrowLeftIcon className="size-4" />
                  {t("shell.button_back")}
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                {showSkip && (
                  <Button
                    variant="ghost"
                    onClick={onSkip}
                    disabled={isLoading}
                    className="text-on-surface-variant"
                  >
                    {t("shell.button_skip")}
                  </Button>
                )}
                <Button
                  onClick={onNext}
                  disabled={isLoading || continueDisabled}
                  className="group min-w-[6.5rem] gap-1.5"
                >
                  {isLoading ? (
                    <>
                      <Spinner className="size-4" />
                      <span>{t("shell.button_saving")}</span>
                    </>
                  ) : (
                    <>
                      {continueLabel ?? defaultContinueLabel}
                      {!isFirstStep && (
                        <ArrowRightIcon className="size-4 transition-transform duration-[var(--duration-quick)] ease-out group-hover:translate-x-0.5 motion-reduce:transition-none" />
                      )}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-on-surface-variant">
          {t("shell.footer_branding")}
        </p>
      </div>
    </div>
  );
}

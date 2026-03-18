"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

// =============================================================================
// OnboardingShell — Full-screen centered card wrapper for onboarding wizard
// =============================================================================

const TOTAL_STEPS = 6;

const STEP_LABELS = [
  "Welcome",
  "Password",
  "Network Mode",
  "Connection",
  "Band Preferences",
  "Complete",
];

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
  const prevStepRef = useRef(currentStep);
  const [direction, setDirection] = useState(1);
  const liveRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (currentStep !== prevStepRef.current) {
      setDirection(currentStep > prevStepRef.current ? 1 : -1);
      prevStepRef.current = currentStep;
    }
  }, [currentStep]);

  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === TOTAL_STEPS;
  const showBack = !isFirstStep && !isLastStep;
  const showSkip = !!onSkip && !isFirstStep && !isLastStep;

  const defaultContinueLabel = isFirstStep
    ? "Get Started"
    : isLastStep
      ? "Go to Dashboard"
      : "Continue";

  const currentStepLabel = STEP_LABELS[currentStep - 1] ?? "";

  const slideVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      {/* Screen-reader live region */}
      <p
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {currentStepLabel ? `Step ${currentStep} of ${TOTAL_STEPS}: ${currentStepLabel}` : ""}
      </p>

      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card shadow-2xl ring-1 ring-border/50 px-10 py-10 flex flex-col gap-8">

          {/* Progress dots — active dot morphs to pill */}
          <div
            role="progressbar"
            aria-valuenow={currentStep}
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-label={`Step ${currentStep} of ${TOTAL_STEPS}`}
            className="flex items-center justify-center gap-2"
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => {
              const step = i + 1;
              const isPast = step < currentStep;
              const isCurrent = step === currentStep;
              return (
                <motion.span
                  key={step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "block h-2 rounded-full",
                    isPast || isCurrent
                      ? "bg-primary"
                      : "bg-muted-foreground/25",
                    isCurrent &&
                      "ring-2 ring-primary/30 ring-offset-1 ring-offset-background"
                  )}
                  animate={{ width: isCurrent ? "1.5rem" : "0.5rem" }}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              );
            })}
          </div>

          {/* Step content — directional slide transition */}
          <div className="overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer buttons */}
          {!isLastStep && (
            <div className="flex items-center justify-between gap-3">
              {showBack ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBack}
                  disabled={isLoading}
                  className="gap-1.5 text-muted-foreground"
                >
                  <ArrowLeftIcon className="size-3.5" />
                  Back
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                {showSkip && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSkip}
                    disabled={isLoading}
                    className="text-muted-foreground"
                  >
                    Skip
                  </Button>
                )}
                <Button
                  onClick={onNext}
                  disabled={isLoading || continueDisabled}
                  size="sm"
                  className="group gap-1.5 min-w-[100px]"
                >
                  {isLoading ? (
                    <>
                      <Spinner className="size-3.5" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      {continueLabel ?? defaultContinueLabel}
                      {!isFirstStep && (
                        <ArrowRightIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                      )}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Branding footer */}
        <p className="mt-4 text-center text-xs text-muted-foreground/50">
          QManager — Quectel Modem Management
        </p>
      </div>
    </div>
  );
}

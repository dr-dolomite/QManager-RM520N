"use client";

import { useCallback, useRef, useState } from "react";
import { OnboardingShell, TOTAL_STEPS } from "./onboarding-shell";
import { StepWelcome } from "./steps/step-welcome";
import { StepPassword } from "./steps/step-password";
import { StepNetworkMode } from "./steps/step-network-mode";
import { StepConnection } from "./steps/step-connection";
import { StepBandLocking } from "./steps/step-band-locking";
import { StepWebPort } from "./steps/step-web-port";
import { StepDone } from "./steps/step-done";
import type { PendingMove } from "@/lib/web-port";

// Steps: 1 Welcome, 2 Password (required), 3 Network mode, 4 Connection, 5 Bands, 6 Web port, 7 Done.
// Steps 3-6 are skippable; each registers the submit fn the shell's Continue calls.

type AsyncVoidFn = () => Promise<void>;
type SyncVoidFn = () => void;

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [passwordValid, setPasswordValid] = useState(false);
  // Set by the web-port step when the server moves; Done opens the dashboard there.
  const [movedOrigin, setMovedOrigin] = useState<PendingMove | null>(null);

  const submitFnRef = useRef<AsyncVoidFn | SyncVoidFn | null>(null);
  const inFlightRef = useRef(false);

  // The ref is cleared only on a step change, so a failed submit can be retried.
  const advance = useCallback(() => {
    submitFnRef.current = null;
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, []);

  const goBack = useCallback(() => {
    submitFnRef.current = null;
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  const handleContinue = useCallback(async () => {
    if (inFlightRef.current) return;
    const fn = submitFnRef.current;
    if (!fn) {
      advance();
      return;
    }
    inFlightRef.current = true;
    try {
      await fn();
    } finally {
      inFlightRef.current = false;
    }
  }, [advance]);

  const registerSubmit = useCallback((fn: AsyncVoidFn | SyncVoidFn) => {
    submitFnRef.current = fn;
  }, []);

  return (
    <OnboardingShell
      currentStep={currentStep}
      onNext={currentStep === 1 ? advance : handleContinue}
      onBack={goBack}
      onSkip={currentStep >= 3 && currentStep <= 6 ? advance : undefined}
      isLoading={isLoading}
      continueDisabled={currentStep === 2 && !passwordValid}
    >
      {currentStep === 1 && <StepWelcome />}

      {currentStep === 2 && (
        <StepPassword
          onSuccess={advance}
          onLoadingChange={setIsLoading}
          onSubmitRef={registerSubmit}
          onValidityChange={setPasswordValid}
        />
      )}

      {currentStep === 3 && (
        <StepNetworkMode
          onSubmitRef={registerSubmit}
          onLoadingChange={setIsLoading}
          onSuccess={advance}
        />
      )}

      {currentStep === 4 && (
        <StepConnection
          onSubmitRef={registerSubmit}
          onLoadingChange={setIsLoading}
          onSuccess={advance}
        />
      )}

      {currentStep === 5 && (
        <StepBandLocking
          onSubmitRef={registerSubmit}
          onLoadingChange={setIsLoading}
          onSuccess={advance}
        />
      )}

      {currentStep === 6 && (
        <StepWebPort
          onSubmitRef={registerSubmit}
          onLoadingChange={setIsLoading}
          onSuccess={advance}
          onMove={setMovedOrigin}
        />
      )}

      {currentStep === 7 && <StepDone movedOrigin={movedOrigin} />}
    </OnboardingShell>
  );
}

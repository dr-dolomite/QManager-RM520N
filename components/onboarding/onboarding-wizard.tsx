"use client";

import { useCallback, useRef, useState } from "react";
import { OnboardingShell, TOTAL_STEPS } from "./onboarding-shell";
import { StepWelcome } from "./steps/step-welcome";
import { StepPassword } from "./steps/step-password";
import { StepNetworkMode } from "./steps/step-network-mode";
import { StepConnection } from "./steps/step-connection";
import { StepBandLocking } from "./steps/step-band-locking";
import { StepDone } from "./steps/step-done";

// Steps: 1 Welcome, 2 Password (required), 3 Network mode, 4 Connection, 5 Bands, 6 Done.
// Steps 3-5 are skippable; each registers the submit fn the shell's Continue calls.

type AsyncVoidFn = () => Promise<void>;
type SyncVoidFn = () => void;

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [passwordValid, setPasswordValid] = useState(false);

  const submitFnRef = useRef<AsyncVoidFn | SyncVoidFn | null>(null);

  const advance = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  // Null the ref before awaiting so a double click cannot fire a stale step's fn.
  const handleContinue = useCallback(async () => {
    if (submitFnRef.current) {
      const fn = submitFnRef.current;
      submitFnRef.current = null;
      await fn();
    } else {
      advance();
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
      onSkip={currentStep >= 3 && currentStep <= 5 ? advance : undefined}
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

      {currentStep === 6 && <StepDone />}
    </OnboardingShell>
  );
}

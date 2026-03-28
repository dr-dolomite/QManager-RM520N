"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Zap,
} from "lucide-react";
import type { MasqueradeTestResult } from "@/types/video-optimizer";

type TestStep = "idle" | "reading_before" | "sending_request" | "reading_after";

const STEPS: { key: TestStep; label: string; duration: number }[] = [
  { key: "reading_before", label: "Reading packet counter", duration: 500 },
  {
    key: "sending_request",
    label: "Sending HTTPS request to CDN",
    duration: 5000,
  },
  {
    key: "reading_after",
    label: "Reading packet counter again",
    duration: 1500,
  },
];

function StepIndicator({
  step,
  currentStep,
  isComplete,
}: {
  step: (typeof STEPS)[number];
  currentStep: TestStep;
  isComplete: boolean;
}) {
  const stepIndex = STEPS.findIndex((s) => s.key === step.key);
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  const isDone = isComplete || stepIndex < currentIndex;
  const isActive = !isComplete && step.key === currentStep;

  return (
    <div className="flex items-center gap-2.5 text-sm">
      {isDone ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : isActive ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}
      <span
        className={
          isDone
            ? "text-success"
            : isActive
              ? "text-foreground"
              : "text-muted-foreground/60"
        }
      >
        {step.label}
      </span>
    </div>
  );
}

interface TestInjectionCardProps {
  testResult: MasqueradeTestResult;
  runTest: () => void;
  serviceRunning: boolean;
}

export default function TestInjectionCard({
  testResult,
  runTest,
  serviceRunning,
}: TestInjectionCardProps) {
  const [currentStep, setCurrentStep] = useState<TestStep>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advance through visual steps when test is running
  useEffect(() => {
    if (testResult.status !== "running") {
      setCurrentStep("idle");
      return;
    }

    // Walk through steps with cumulative delays
    let cumulativeDelay = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const step of STEPS) {
      const timer = setTimeout(() => {
        setCurrentStep(step.key);
      }, cumulativeDelay);
      timers.push(timer);
      cumulativeDelay += step.duration;
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [testResult.status]);

  // Clean up timer ref on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleRunTest = useCallback(() => {
    runTest();
  }, [runTest]);

  const isRunning = testResult.status === "running";
  const isComplete =
    testResult.status === "complete" || testResult.status === "error";

  if (!serviceRunning) {
    return null;
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Test Injection</CardTitle>
        <CardDescription>
          Make an HTTPS request to a CDN and verify that fake SNI packets are
          being injected by comparing nftables counters before and after
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Step-by-step progress */}
        {isRunning && currentStep !== "idle" && (
          <div className="space-y-2 rounded-lg border p-3">
            {STEPS.map((step) => (
              <StepIndicator
                key={step.key}
                step={step}
                currentStep={currentStep}
                isComplete={false}
              />
            ))}
          </div>
        )}

        {/* Result */}
        {testResult.status === "complete" && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border p-3">
              {STEPS.map((step) => (
                <StepIndicator
                  key={step.key}
                  step={step}
                  currentStep={currentStep}
                  isComplete
                />
              ))}
            </div>
            <Alert
              className={
                testResult.injected
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }
            >
              {testResult.injected ? <CheckCircle2 /> : <AlertTriangle />}
              <AlertDescription
                className={
                  testResult.injected ? "text-success" : "text-destructive"
                }
              >
                {testResult.message}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {testResult.status === "error" && testResult.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{testResult.error}</AlertDescription>
          </Alert>
        )}

        {/* Action */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleRunTest}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 className="animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Zap />
              Run Test
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

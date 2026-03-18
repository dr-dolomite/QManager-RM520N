"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// =============================================================================
// StepDone — Onboarding step 6: completion screen + confetti
// =============================================================================

// Brand-derived confetti colors (primary blue-indigo palette)
const CONFETTI_COLORS = ["#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff"];

export function StepDone() {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [show, setShow] = useState(prefersReducedMotion);
  const dashboardBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = setTimeout(() => setShow(true), 80);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion]);

  // Confetti burst on mount
  useEffect(() => {
    if (prefersReducedMotion) return;

    let cancelled = false;

    const fire = async () => {
      const confetti = (await import("canvas-confetti")).default;
      if (cancelled) return;

      // Center burst
      confetti({
        particleCount: 70,
        spread: 55,
        origin: { x: 0.5, y: 0.45 },
        colors: CONFETTI_COLORS,
        scalar: 0.85,
        gravity: 1.1,
      });

      // Side bursts after a short delay
      setTimeout(() => {
        if (cancelled) return;
        confetti({
          particleCount: 30,
          spread: 50,
          angle: 65,
          origin: { x: 0.15, y: 0.5 },
          colors: CONFETTI_COLORS,
          scalar: 0.8,
        });
        confetti({
          particleCount: 30,
          spread: 50,
          angle: 115,
          origin: { x: 0.85, y: 0.5 },
          colors: CONFETTI_COLORS,
          scalar: 0.8,
        });
      }, 180);
    };

    const timer = setTimeout(fire, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prefersReducedMotion]);

  useEffect(() => {
    dashboardBtnRef.current?.focus();
  }, []);

  const handleGoToDashboard = () => {
    window.location.href = "/dashboard/";
  };

  return (
    <div className="flex flex-col items-center gap-6 text-center py-2">
      {/* Animated checkmark */}
      <div
        className="flex size-16 items-center justify-center rounded-full bg-primary/10 transition-[opacity,transform] duration-500"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "scale(1)" : "scale(0.6)",
        }}
      >
        <CheckIcon className="size-8 text-primary stroke-[2.5]" />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">You&apos;re all set!</h2>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          QManager is ready. Everything you configured is active, and you can
          change any setting anytime from the sidebar.
        </p>
      </div>

      {/* Tip callout */}
      <div className="w-full rounded-xl bg-muted/60 border border-border px-4 py-3 text-left">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Pro tip:</span> Visit{" "}
          <span className="font-medium">Cellular › Band Locking</span> to
          fine-tune signal strength, or{" "}
          <span className="font-medium">Monitoring › Watchdog</span> to set up
          automatic recovery.
        </p>
      </div>

      <Button ref={dashboardBtnRef} onClick={handleGoToDashboard} className="w-full" size="lg">
        Go to Dashboard
      </Button>
    </div>
  );
}

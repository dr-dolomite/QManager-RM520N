"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import { INNER_TILE, STEP_DESCRIPTION, STEP_HEADING } from "../shapes";
import { useMotionReduced } from "@/components/motion-preference";

// Confetti wears the primary ramp, read from the live tokens so it follows the theme.
// canvas-confetti only parses hex, so each oklch() token is resolved through a 1x1 canvas.
const CONFETTI_TOKENS = [
  "--primary",
  "--primary-on-surface",
  "--primary-container",
  "--on-primary-container",
];
const CONFETTI_FALLBACK = ["#3b82f6"];

function confettiColors(): string[] {
  try {
    const style = getComputedStyle(document.documentElement);
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) return CONFETTI_FALLBACK;
    const colors: string[] = [];
    for (const token of CONFETTI_TOKENS) {
      const value = style.getPropertyValue(token).trim();
      if (!value) continue;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      colors.push(`#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
    }
    return colors.length > 0 ? colors : CONFETTI_FALLBACK;
  } catch {
    return CONFETTI_FALLBACK;
  }
}

export function StepDone() {
  const { t } = useTranslation("onboarding");
  const prefersReducedMotion = useMotionReduced();

  const [show, setShow] = useState(prefersReducedMotion);
  const dashboardBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = setTimeout(() => setShow(true), 80);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    let cancelled = false;

    const fire = async () => {
      const confetti = (await import("canvas-confetti")).default;
      if (cancelled) return;
      const colors = confettiColors();

      confetti({
        particleCount: 70,
        spread: 55,
        origin: { x: 0.5, y: 0.45 },
        colors,
        scalar: 0.85,
        gravity: 1.1,
      });

      setTimeout(() => {
        if (cancelled) return;
        confetti({
          particleCount: 30,
          spread: 50,
          angle: 65,
          origin: { x: 0.15, y: 0.5 },
          colors,
          scalar: 0.8,
        });
        confetti({
          particleCount: 30,
          spread: 50,
          angle: 115,
          origin: { x: 0.85, y: 0.5 },
          colors,
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

  return (
    <div className="flex flex-col items-center gap-6 py-2 text-center">
      {/* Completion glyph: a filled success disc on the emphasized clock */}
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-success text-success-foreground transition-[opacity,transform] duration-[var(--duration-emphasized)] ease-emphasized"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "scale(1)" : "scale(0.6)",
        }}
      >
        <CheckIcon className="size-8" strokeWidth={2.5} />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className={STEP_HEADING}>{t("done.heading")}</h2>
        <p className={`${STEP_DESCRIPTION} max-w-xs leading-relaxed`}>{t("done.description")}</p>
      </div>

      <div className={`${INNER_TILE} w-full px-4 text-left`}>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          <Trans
            i18nKey="done.callout_body"
            ns="onboarding"
            components={{
              bold: <span className="font-medium text-on-surface" />,
              menu: <span className="font-medium text-on-surface" />,
            }}
          />
        </p>
      </div>

      <Button
        ref={dashboardBtnRef}
        onClick={() => {
          window.location.href = "/dashboard/";
        }}
        className="w-full gap-2"
        size="action"
      >
        {t("done.button_dashboard")}
      </Button>
    </div>
  );
}

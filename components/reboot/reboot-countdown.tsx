"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DUR, EASE_EMPHASIZED, EASE_STANDARD } from "@/lib/motion";
import { BODY, EMPHASIS } from "@/components/pre-auth-type";

const TOTAL_SECONDS = 70;
const POLL_START_AT = 35; // seconds remaining when polling begins
const POLL_INTERVAL = 5000; // ms between polls
const REDIRECT_DELAY = 3000; // ms to wait after device responds before redirecting
const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";
const OVERTIME_ESCAPE_AT = -180; // show escape link after 3 minutes past zero
const SESSION_KEY = "qm_rebooting";

// SVG ring geometry
const RING_SIZE = 120;
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_STROKE = 5;

type PhaseKey = "shutting_down" | "restarting" | "almost_ready" | "overtime";

interface Phase {
  key: PhaseKey;
  segment: number; // 1-indexed active segment
}

function getPhase(remaining: number): Phase {
  if (remaining > 47) return { key: "shutting_down", segment: 1 };
  if (remaining > 23) return { key: "restarting", segment: 2 };
  if (remaining > 0) return { key: "almost_ready", segment: 3 };
  return { key: "overtime", segment: 3 };
}

export function RebootCountdown() {
  const { t } = useTranslation("common");
  const [verified, setVerified] = useState(false);
  const [remaining, setRemaining] = useState(TOTAL_SECONDS);
  const pollingRef = useRef(false);
  const remainingRef = useRef(TOTAL_SECONDS);
  const guardRanRef = useRef(false);

  // Direct-access guard. The flag is one-shot, so a ref keeps StrictMode's double-invoke
  // from reading it as missing and bouncing to /login/ mid-reboot.
  useEffect(() => {
    if (guardRanRef.current) return;
    guardRanRef.current = true;
    const flag = sessionStorage.getItem(SESSION_KEY);
    if (!flag) {
      window.location.href = "/login/";
      return;
    }
    sessionStorage.removeItem(SESSION_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount guard with real side effects (consumes sessionStorage, may redirect); must remain an effect
    setVerified(true);

    // Tells a waiting OTA worker the page has loaded so it can reboot; harmless otherwise.
    fetch("/cgi-bin/quecmanager/system/update.sh?action=reboot_ack", {
      keepalive: true,
    }).catch(() => {});
  }, []);

  // Keep ref in sync so the polling effect can read it without re-subscribing
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  // Countdown timer — only start after guard passes
  useEffect(() => {
    if (!verified) return;
    const id = setInterval(() => {
      setRemaining((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [verified]);

  // Device health polling — single interval, checks remainingRef each tick
  useEffect(() => {
    if (!verified) return;
    const id = setInterval(async () => {
      // Don't poll until countdown reaches the threshold
      if (remainingRef.current > POLL_START_AT) return;
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const res = await fetch(CHECK_ENDPOINT);
        if (res.ok) {
          clearInterval(id);
          // Wait a few seconds for the poller to initialize
          // so the dashboard isn't blank on first load
          setTimeout(() => {
            window.location.href = "/login/";
          }, REDIRECT_DELAY);
          return;
        }
      } catch {
        // Device still offline
      }
      pollingRef.current = false;
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [verified]);

  // Don't render until guard passes
  if (!verified) return null;

  const phase = getPhase(remaining);
  const isOvertime = remaining <= 0;
  const displaySeconds = Math.max(0, remaining);
  const showEscape = remaining <= OVERTIME_ESCAPE_AT;

  // Ring progress: 0 at start → full at 0 remaining
  const progress = Math.min(1, (TOTAL_SECONDS - remaining) / TOTAL_SECONDS);
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.emphasized, ease: EASE_EMPHASIZED }}
        className="flex flex-col items-center"
      >
      {/* Card */}
      <div className="card-sheen flex w-full max-w-[340px] flex-col items-center gap-6 rounded-hero bg-card px-12 py-10 text-card-foreground shadow-[var(--shadow-whisper)] dark:shadow-none">
        {/* Logo */}
        <img
          src="/qmanager-mark.svg"
          alt="QManager"
          className="size-9"
        />

        {/* Progress ring with countdown */}
        <div
          role="timer"
          aria-label={
            isOvertime
              ? t("reboot_page.timer_overtime_aria")
              : t("reboot_page.timer_aria", { count: displaySeconds })
          }
          className="relative"
          style={{ width: RING_SIZE, height: RING_SIZE }}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            {/* Background track */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              className="stroke-surface-container-high"
              strokeWidth={RING_STROKE}
            />
            {/* Progress arc */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              className="stroke-primary"
              strokeWidth={RING_STROKE}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{
                // Linear progress: one step per 1 s tick, outside the motion scale.
                transition: "stroke-dashoffset 1s linear",
                filter:
                  "drop-shadow(0 0 6px color-mix(in oklch, var(--primary) 30%, transparent))",
              }}
            />
          </svg>

          {/* Countdown number */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isOvertime ? (
              <Spinner className="size-6" />
            ) : (
              <>
                <span className="text-[32px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                  {displaySeconds}
                </span>
                <span className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("reboot_page.seconds_unit")}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Phase message */}
        <div className="text-center min-h-[48px] flex flex-col items-center justify-center">
          {/* Visually hidden live region for screen reader phase announcements */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {t(`reboot_page.phase.${phase.key}`)}
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
              aria-hidden="true"
            >
              <p className={cn(EMPHASIS, "text-foreground")}>
                {t(`reboot_page.phase.${phase.key}`)}
              </p>
              <p className={cn(BODY, "mt-1.5 text-muted-foreground")}>
                {isOvertime
                  ? t("reboot_page.subtitle.overtime")
                  : t("reboot_page.subtitle.normal")}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Segmented progress bar */}
        <div className="flex w-full gap-1.5">
          {[1, 2, 3].map((seg) => (
            <div
              key={seg}
              className={cn(
                "h-[3px] flex-1 rounded-pill transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
                seg < phase.segment
                  ? "bg-primary"
                  : seg === phase.segment
                    ? "bg-primary/60"
                    : "bg-surface-container-high"
              )}
            />
          ))}
        </div>
      </div>

      {/* Brand text below card */}
      <p className="mt-5 text-xs text-muted-foreground/40">QManager</p>

      {/* Overtime escape — appears after 3 minutes with no response */}
      {showEscape && (
        <a
          href="/login/"
          className="mt-3 text-xs text-muted-foreground underline underline-offset-4 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:text-foreground"
        >
          {t("reboot_page.escape")}
        </a>
      )}
      </motion.div>
    </div>
  );
}

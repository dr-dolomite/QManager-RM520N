"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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

interface Phase {
  label: string;
  segment: number; // 1-indexed active segment
}

function getPhase(remaining: number): Phase {
  if (remaining > 47) return { label: "Shutting down...", segment: 1 };
  if (remaining > 23) return { label: "Restarting services...", segment: 2 };
  if (remaining > 0) return { label: "Almost ready...", segment: 3 };
  return { label: "Reconnecting \u2014 taking longer than usual...", segment: 3 };
}

export function RebootCountdown() {
  const [verified, setVerified] = useState(false);
  const [remaining, setRemaining] = useState(TOTAL_SECONDS);
  const pollingRef = useRef(false);
  const remainingRef = useRef(TOTAL_SECONDS);

  // Direct-access guard: only show countdown if a reboot was actually triggered
  useEffect(() => {
    const flag = sessionStorage.getItem(SESSION_KEY);
    if (!flag) {
      window.location.href = "/login/";
      return;
    }
    sessionStorage.removeItem(SESSION_KEY);
    setVerified(true);

    // Tell the OTA worker (if any) that the static reboot page has loaded
    // so it can stop waiting and fire the reboot syscall. Harmless on
    // non-OTA reboots — the worker simply isn't watching.
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
        transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
        className="flex flex-col items-center"
      >
      {/* Card */}
      <div className="flex flex-col items-center gap-6 rounded-xl border bg-card px-12 py-10 shadow-sm max-w-[340px] w-full">
        {/* Logo */}
        <img
          src="/qmanager-logo.svg"
          alt="QManager"
          className="size-9"
        />

        {/* Progress ring with countdown */}
        <div
          role="timer"
          aria-label={
            isOvertime
              ? "Reconnecting, taking longer than usual"
              : `${displaySeconds} seconds remaining`
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
              className="stroke-muted/20"
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
                  sec
                </span>
              </>
            )}
          </div>
        </div>

        {/* Phase message */}
        <div className="text-center min-h-[48px] flex flex-col items-center justify-center">
          {/* Visually hidden live region for screen reader phase announcements */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {phase.label}
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              aria-hidden="true"
            >
              <p className="text-[15px] font-medium text-foreground">
                {phase.label}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {isOvertime
                  ? "The device is still restarting"
                  : "Your device will be back online shortly"}
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
                "h-[3px] flex-1 rounded-full transition-colors duration-500",
                seg < phase.segment
                  ? "bg-primary"
                  : seg === phase.segment
                    ? "bg-primary/60"
                    : "bg-muted/30"
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
          className="mt-3 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Device may need manual attention — go to login
        </a>
      )}
      </motion.div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";

import { useMotionReduced } from "@/components/motion-preference";
import { EASE_STANDARD, EASE_QUICK, DUR, STAGGER_STEP } from "@/lib/motion";

// LanReconnecting — after a LAN address change the modem reboots; probe the new address and open it once it answers.
// no-cors fetch resolves on any HTTP reply and rejects on a connection failure, which is the reachability signal across origins.

const POLL_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 1500; // per-probe abort so an unreachable host can't hang
const OPEN_GRACE_MS = 600; // tiny settle before navigating after a hit
const REBOOT_GRACE_S = 25;
const MIN_CEILING_S = 60;

// Compact progress ring (card-sized; mirrors the reboot countdown's language).
const RING_SIZE = 104;
const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_STROKE = 5;

type Phase = "connecting" | "opening" | "manual";

interface LanReconnectingProps {
  /** Address the device will be reachable at after the reload, e.g. "192.168.2.1" */
  newIpaddr: string;
  /** CIDR prefix that was applied */
  prefix: number;
  /** Backend estimate of the unreachable window (about one reboot) */
  windowSeconds: number;
  /** True when the backend bounces the carrier (DHCP clients reconnect on their own) */
  carrierBounce: boolean;
}

export function LanReconnecting({
  newIpaddr,
  prefix,
  windowSeconds,
  carrierBounce,
}: LanReconnectingProps) {
  const { t } = useTranslation("common");
  const reduceMotion = useMotionReduced();

  // The modem keeps answering for a few seconds after the reboot is armed, so
  // probing waits out that window; the ceiling rides the backend's reboot estimate.
  const grace = REBOOT_GRACE_S;
  const ceiling = Math.max(windowSeconds, MIN_CEILING_S);

  const [remaining, setRemaining] = useState(ceiling);
  const [phase, setPhase] = useState<Phase>("connecting");

  const remainingRef = useRef(ceiling);
  const pollingRef = useRef(false);
  const navigatedRef = useRef(false);

  // Keep this page's protocol and port: the web port is user-configurable
  // (System Settings > Device Access), so the new address answers on the same one.
  const loc = typeof window === "undefined" ? null : window.location;
  const url = `${loc?.protocol ?? "http:"}//${newIpaddr}${loc?.port ? `:${loc.port}` : ""}`;
  const address = `${newIpaddr}/${prefix}`;

  // Single guarded navigation (survives StrictMode's double-invoke).
  const goToNewAddress = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    window.location.href = url;
  };

  // One reachability probe. Resolves true if the device answered at all.
  const probe = async (): Promise<boolean> => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      await fetch(`${url}/?_qm=${Date.now()}`, {
        mode: "no-cors",
        cache: "no-store",
        redirect: "manual",
        signal: ctrl.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  };

  // Keep the ref in sync so the poll interval reads the latest value.
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  // Countdown (display only) — pure decrement in a timer callback.
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Ceiling — flip to the manual banner if nothing answered in time.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!navigatedRef.current) setPhase("manual");
    }, ceiling * 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ceiling derives from props that don't change; run once
  }, []);

  // Poll the new address through the grace→ceiling window; navigate on first hit.
  useEffect(() => {
    const id = setInterval(async () => {
      const r = remainingRef.current;
      if (r > ceiling - grace) return; // still in the grace period
      if (r <= 0) {
        clearInterval(id);
        return;
      }
      if (pollingRef.current || navigatedRef.current) return;
      pollingRef.current = true;
      const reachable = await probe();
      if (reachable && !navigatedRef.current) {
        clearInterval(id);
        setPhase("opening");
        window.setTimeout(goToNewAddress, OPEN_GRACE_MS);
        return;
      }
      pollingRef.current = false;
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url/probe/grace/ceiling derive from props that don't change; run once
  }, []);

  // Determinate ring: fills as the grace→ceiling window elapses. The redirect is
  // event-driven (probe success), so the centre shows a spinner, not a number.
  const progress = Math.min(1, (ceiling - remaining) / ceiling);
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  const addressLink = (
    <a
      href={url}
      className="inline-flex min-w-0 items-center gap-1.5 break-all font-mono text-[0.8125rem] font-medium underline underline-offset-4"
    >
      <ExternalLinkIcon className="size-3.5" />
      {url}
    </a>
  );

  return (
    <motion.div
      key="reconnecting"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === "manual" ? (
          // --- Fallback: device didn't answer in time — point the user manually ---
          <motion.div
            key="manual"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.quick, ease: EASE_QUICK }}
          >
            {/* Solid tonal container with its glyph on the strong fill: a 10%
                wash collapses in dark mode and in sunlight. */}
            <div
              role="alert"
              className="animate-banner-in flex items-start gap-3 rounded-field bg-warning-container p-4 text-on-warning-container"
            >
              <span
                aria-hidden="true"
                className="grid size-8 flex-none place-items-center rounded-pill bg-warning text-warning-foreground"
              >
                <TriangleAlertIcon className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5 break-words">
                <p className="text-sm font-semibold">
                  {t("ethernet.lan_config.applied_title")}
                </p>
                <p className="text-sm">
                  {t(
                    carrierBounce
                      ? "ethernet.lan_config.applied_body_auto"
                      : "ethernet.lan_config.applied_body",
                    { address, seconds: windowSeconds },
                  )}
                </p>
                {addressLink}
              </div>
            </div>
          </motion.div>
        ) : (
          // --- Active: progress ring while we grace + probe the new address -----
          <motion.div
            key="connecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.quick, ease: EASE_QUICK }}
            className="flex flex-col items-center gap-5 py-2 text-center"
          >
            <div
              role="status"
              aria-label={
                phase === "opening"
                  ? t("ethernet.lan_config.reconnecting_opening")
                  : t("ethernet.lan_config.reconnecting_title")
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
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  className="stroke-surface-container-high"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={RING_STROKE}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={phase === "opening" ? 0 : dashOffset}
                  strokeLinecap="round"
                  // Linear over the 1s tick it tracks: the ring is a clock, not a gesture.
                  style={{
                    transition: reduceMotion
                      ? "none"
                      : "stroke-dashoffset 1s linear",
                  }}
                />
              </svg>

              <div
                className="absolute inset-0 flex items-center justify-center gap-1.5"
                aria-hidden="true"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-2 rounded-pill bg-primary"
                    animate={reduceMotion ? { opacity: 1 } : { opacity: [0.25, 1, 0.25] }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            duration: DUR.emphasized,
                            ease: EASE_STANDARD,
                            repeat: Infinity,
                            repeatDelay: DUR.quick,
                            delay: i * STAGGER_STEP,
                          }
                    }
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-base font-semibold text-on-surface">
                {phase === "opening"
                  ? t("ethernet.lan_config.reconnecting_opening")
                  : t("ethernet.lan_config.reconnecting_title")}
              </p>
              <p className="mx-auto max-w-prose text-sm text-on-surface-variant">
                {t("ethernet.lan_config.reconnecting_auto_note")}
              </p>
            </div>

            {addressLink}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

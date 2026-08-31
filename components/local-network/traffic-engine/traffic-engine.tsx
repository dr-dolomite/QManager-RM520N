"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2Icon, RefreshCcwIcon, Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { useVideoOptimizer } from "@/hooks/use-video-optimizer";

import ForceTcpCard from "./force-tcp-card";
import LiveStrip, { type LiveStripReading } from "./live-strip";
import ModeCard from "./mode-card";
import Onboarding from "./onboarding";
import TargetsCard from "./targets-card";
import VerifyCard from "./verify-card";
import { PAGE_HEAD, PAGE_ROOT, PILL_ACTION, TILE } from "./shapes";
import type { DpiEngineStatus, DpiMode } from "@/types/traffic-engine";

// =============================================================================
// TrafficEngine — the /local-network/traffic-engine page shell
// =============================================================================
// The page used to be organised around the CONFIG FILE: a status card, two tabs
// named after the two config keys, a test, a QUIC toggle. The user arrives with
// one question — "is my video throttled, and is the fix on?" — and a second one
// they ask once: "is it actually helping?"
//
// It is now a page header, a live tile strip, and a stack of peer cards ordered
// by CADENCE: what is happening right now, then the one decision, then what
// that decision operates on, then the occasional test, then the independent
// QUIC control. QUIC is last because its independence from the engine is
// documented and deliberate (docs/reference/dpi.md > QUIC handling).
//
// -----------------------------------------------------------------------------
// ONE ANSWER TO "WHICH MODE IS ACTIVE", AND IT IS DERIVED HERE
// -----------------------------------------------------------------------------
// This is the fix for the correctness bug. The shell used to hand the status
// card `videoOptimizer.data ?? masquerade.data` and let the card work out its
// own shape from `"sni_domain" in data`. Both hooks fetch, so the Video
// Optimizer's payload essentially always won — and with MASQUERADE enabled the
// card still rendered "Domains loaded", a figure for a mode that has no domain
// list.
//
// `mode` is now derived ONCE, from the two `enabled` flags, and passed down. No
// component below infers it, and no component sniffs a payload for its shape.
//
// The four LIVE fields are a separate question and are read differently: status,
// uptime, packet count and rule presence are ENGINE-GLOBAL — there is one tpws
// process and one REDIRECT rule, and both CGI sections report the same ones — so
// either section answers them identically and the shell simply takes whichever
// read succeeded. That was never the bug. The bug was using the same fallback to
// decide the MODE.
//
// The backend contract is untouched: same endpoint, same actions, same fields,
// same 2s cadence, same mutex enforced on the CGI side.
// =============================================================================

/**
 * Sent with every masquerade write and inert on this platform.
 *
 * tpws has no fake-ClientHello mode (that is nfqws-only), so masquerade means
 * "split everything" rather than "spoof this name". The key is accepted and
 * stored for API-contract compatibility with the RM551E and is documented as
 * inert (docs/reference/dpi.md > Modes). It is a constant here rather than a
 * field because there is nothing for a user to decide about it — the retired UI
 * removed the input for exactly that reason, and the orphaned
 * `trafficEngine.status.sni` key went with this re-author.
 */
const MASQUERADE_SNI = "speedtest.net";

/**
 * True only once `active` has held for `delayMs`.
 *
 * Suppresses the flash-of-skeleton on fast loads, and this app runs ON the
 * modem, so loads are routinely sub-100ms. `setState` lives only in the timer
 * callback and the cleanup — never synchronously in the effect body — to stay
 * clear of the React-compiler setState-in-effect rule. Preserved verbatim from
 * the retired shell; it was already right.
 */
function useDelayedFlag(active: boolean, delayMs = 160) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(id);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}

const TrafficEngine = () => {
  const { t } = useTranslation("common");

  const videoOptimizer = useVideoOptimizer();
  const masquerade = useTrafficMasquerade();
  const hostlist = useCdnHostlist();

  // ---------------------------------------------------------------------------
  // The two derivations, kept apart on purpose
  // ---------------------------------------------------------------------------
  // The mode comes from the two `enabled` flags, which the backend keeps
  // mutually exclusive. Masquerade is tested first only so the expression has a
  // fixed order; the mutex means at most one can be true.
  const mode: DpiMode = masquerade.data?.enabled
    ? "masquerade"
    : videoOptimizer.data?.enabled
      ? "video_optimizer"
      : "none";

  // The live fields are engine-global, so either section answers them. Written
  // out rather than as a `??` chain because the chain is what the wrong-mode bug
  // looked like, and the two reads should not resemble each other.
  const primary = videoOptimizer.data;
  const secondary = masquerade.data;
  const source = primary !== null ? primary : secondary;

  const reading: LiveStripReading | null = source
    ? {
        status: source.status,
        uptime: source.uptime,
        packets_processed: source.packets_processed,
        kernel_module_loaded: source.kernel_module_loaded,
      }
    : null;

  const status = (source?.status ?? "stopped") as DpiEngineStatus;
  const installed = source?.binary_installed ?? false;

  // ---------------------------------------------------------------------------
  // Packets per second, from successive samples of the same 2s poll
  // ---------------------------------------------------------------------------
  const prevRef = React.useRef<{ ts: number; pkts: number } | null>(null);
  const [packetsPerSecond, setPacketsPerSecond] = React.useState(0);
  const packets = source?.packets_processed ?? null;

  React.useEffect(() => {
    if (packets === null) return;
    const now = Date.now();
    const prev = prevRef.current;
    if (prev && now > prev.ts) {
      const delta = packets - prev.pkts;
      setPacketsPerSecond(Math.max(0, Math.round((delta * 1000) / (now - prev.ts))));
    }
    prevRef.current = { ts: now, pkts: packets };
  }, [packets]);

  // ---------------------------------------------------------------------------
  // Read states
  // ---------------------------------------------------------------------------
  const isLoading = videoOptimizer.isLoading && masquerade.isLoading;
  const showSkeleton = useDelayedFlag(isLoading);
  // Nothing was ever read. Distinct from a poll that failed on top of data.
  const readFailed = source === null && !isLoading;
  // The figures are STALE: they are held, because they are still the last thing
  // the modem confirmed, and the banner says so rather than letting a dead poll
  // and a healthy one render identically.
  const pollFailed =
    source !== null &&
    (videoOptimizer.error !== null || masquerade.error !== null);

  const retry = () => {
    videoOptimizer.refresh();
    masquerade.refresh();
  };

  // ---------------------------------------------------------------------------
  // The one write this page makes: which mode owns the engine
  // ---------------------------------------------------------------------------
  const [isSwitching, setIsSwitching] = React.useState(false);

  const selectMode = async (next: DpiMode) => {
    setIsSwitching(true);
    try {
      const ok =
        next === "video_optimizer"
          ? await videoOptimizer.saveEnabled(true)
          : next === "masquerade"
            ? await masquerade.save(true, MASQUERADE_SNI)
            : // Turning off means disabling whichever mode currently owns the
              // engine. Writing "off" to the section that is already off would
              // be a no-op that reported success.
              mode === "masquerade"
              ? await masquerade.save(false, MASQUERADE_SNI)
              : await videoOptimizer.saveEnabled(false);

      if (!ok) {
        toast.error(t("trafficEngine.mode.toast_error"));
        return;
      }
      toast.success(
        t(
          next === "video_optimizer"
            ? "trafficEngine.mode.toast_video_optimizer"
            : next === "masquerade"
              ? "trafficEngine.mode.toast_masquerade"
              : "trafficEngine.mode.toast_off",
        ),
      );
      // Both sections are re-read, because the backend just changed the OTHER
      // one too. Refreshing only the section written would leave the derived
      // mode reading from a stale flag for one poll.
      retry();
    } finally {
      setIsSwitching(false);
    }
  };

  const isSaving = isSwitching || videoOptimizer.isSaving || masquerade.isSaving;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // The cascade root declares `initial`/`animate` once. Every band below is a
  // `staggerItem` child and must NOT declare its own, or it detaches from the
  // parent's clock and renders at `hidden` forever.
  return (
    <motion.div
      // `@container/main` is declared HERE rather than inside `PAGE_ROOT`,
      // because the container name is this route's contract with every
      // `@xl/main:` / `@5xl/main:` variant below it. It should be legible at
      // the root of the route that owns it, not folded into an imported string.
      className={cn("@container/main", PAGE_ROOT)}
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t("trafficEngine.page.title")}</h1>
            <p className={PAGE_HEAD.DESC}>{t("trafficEngine.page.description")}</p>
          </div>

          {installed ? (
            <div className={PAGE_HEAD.ACTIONS}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="tonal-neutral"
                    disabled={videoOptimizer.isUninstalling}
                    className={PILL_ACTION}
                  >
                    {videoOptimizer.isUninstalling ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                    {t("trafficEngine.uninstall.button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("trafficEngine.uninstall.title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("trafficEngine.uninstall.description")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={videoOptimizer.isUninstalling}>
                      {t("trafficEngine.uninstall.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        videoOptimizer.uninstallBinary();
                      }}
                      disabled={videoOptimizer.isUninstalling}
                    >
                      {t("trafficEngine.uninstall.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>
      </motion.div>

      {/* A failed uninstall, or an install error surviving a successful one.
          The onboarding screen owns the not-installed failure; this is the one
          the installed page has to carry, and it stays until dismissed because
          the next 2s poll would otherwise blink it away. */}
      {installed && videoOptimizer.installPhase === "error" ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="stale"
            title={t("trafficEngine.binary_op_failed")}
            description={videoOptimizer.installMessage ?? videoOptimizer.error}
            onDismiss={videoOptimizer.dismissBinaryOpError}
            dismissLabel={t("actions.dismiss")}
          />
        </motion.div>
      ) : null}

      {readFailed ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="stale"
            title={t("trafficEngine.strip.unavailable_title")}
            description={t("trafficEngine.strip.unavailable_body")}
            action={
              <button
                type="button"
                onClick={retry}
                className={bannerActionVariants({ tone: "destructive" })}
              >
                <RefreshCcwIcon />
                {t("actions.retry")}
              </button>
            }
          />
        </motion.div>
      ) : isLoading ? (
        showSkeleton ? (
          <motion.div variants={staggerItem}>
            <div className={TILE.GRID}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
              ))}
            </div>
          </motion.div>
        ) : null
      ) : !installed ? (
        <motion.div variants={staggerItem}>
          <Onboarding
            isInstalling={videoOptimizer.isInstalling}
            installPhase={videoOptimizer.installPhase}
            installMessage={videoOptimizer.installMessage}
            onInstall={videoOptimizer.installBinary}
            onDismissError={videoOptimizer.dismissBinaryOpError}
          />
        </motion.div>
      ) : (
        <>
          {pollFailed ? (
            <motion.div variants={staggerItem}>
              <Banner
                role="stale"
                title={t("trafficEngine.strip.stale_title")}
                description={t("trafficEngine.strip.stale_body")}
                action={
                  <button
                    type="button"
                    onClick={retry}
                    className={bannerActionVariants({ tone: "destructive" })}
                  >
                    <RefreshCcwIcon />
                    {t("actions.retry")}
                  </button>
                }
              />
            </motion.div>
          ) : null}

          <motion.div variants={staggerItem}>
            <LiveStrip
              mode={mode}
              reading={reading}
              packetsPerSecond={packetsPerSecond}
              domainCount={hostlist.domains.length}
            />
          </motion.div>

          <motion.div variants={staggerItem}>
            <ModeCard
              mode={mode}
              status={status}
              isSaving={isSaving}
              onSelect={selectMode}
            />
          </motion.div>

          <motion.div variants={staggerItem}>
            <TargetsCard hostlist={hostlist} mode={mode} />
          </motion.div>

          <motion.div variants={staggerItem}>
            <VerifyCard binaryInstalled={installed} />
          </motion.div>
        </>
      )}

      {/* Rendered in EVERY state, including before the engine is installed. It
          reads on its own channel, so it stays usable when the engine read
          fails — which is exactly when a user is most likely to want it. */}
      <motion.div variants={staggerItem}>
        <ForceTcpCard />
      </motion.div>
    </motion.div>
  );
};

export default TrafficEngine;

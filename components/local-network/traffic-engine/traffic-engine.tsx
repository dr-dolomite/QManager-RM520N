"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { toast } from "sonner";
import { failureReason } from "./failure-reason";
import { RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useMotionReduced } from "@/components/motion-preference";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { useFullBypass } from "@/hooks/use-full-bypass";
import { useTtlSettings } from "@/hooks/use-ttl-settings";
import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";

import {
  EngineCard,
  type EngineChoice,
  type EngineMode,
  type EngineTransition,
} from "./engine-card";
import { EngineOnboarding } from "./engine-onboarding";
import { ForceTcpCard } from "./force-tcp-card";
import { FullBypassCard, VideoOptimizerCard, modeCardId } from "./mode-card";
import { CHART_SAMPLES } from "./packet-chart";
import {
  CARD_ACTION,
  CARD_BODY,
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CONDITION,
  CONDITION_TONE,
  CONTROL_COL,
  ENGINE_GRID,
  ENGINE_ROWS,
  HEADER_PILL,
  HERO_PAD,
  HERO_SHELL,
  HOTSPOT_GROUP,
  LIVE,
  PAGE_HEAD,
  PAGE_ROOT,
  PAIR,
  PILL_GLYPH,
  ROWS,
  SKELETON,
  STACK,
} from "./shapes";
import { VerifyCard, VerifyCardSkeleton } from "./verify-card";

/** Sent with every Full Bypass write; inert on tpws, kept for RM551E contract parity. */
const FULL_BYPASS_SNI = "speedtest.net";

/** The hooks' poll period, so a per-poll counter delta reads as new connections per second. */
const POLL_SECONDS = 2;

/** How long a `?mode=` deep link keeps its card highlighted. */
const HIGHLIGHT_MS = 1600;

/** How long a transition may wait for the poll to confirm it. */
const PENDING_TIMEOUT_MS = 8000;

type Pending = { kind: EngineTransition; target: EngineMode | null } | null;

const EMPTY_HISTORY: readonly (number | null)[] = Array(CHART_SAMPLES).fill(null);

/**
 * The engine's new-connection rate over the last minute, one sample per poll. Every fetch is a new
 * object, so its identity is the tick; a stop or a mode switch starts the history over.
 */
function usePacketHistory(sample: object | null, mode: EngineMode | null, packets: number) {
  const [state, setState] = useState<{
    sample: object | null;
    mode: EngineMode | null;
    last: number | null;
    history: readonly (number | null)[];
  }>({ sample: null, mode: null, last: null, history: EMPTY_HISTORY });

  if (mode !== state.mode) {
    setState({ sample, mode, last: mode ? packets : null, history: EMPTY_HISTORY });
  } else if (mode && sample && sample !== state.sample) {
    const rate =
      state.last === null ? null : Math.round(Math.max(0, packets - state.last) / POLL_SECONDS);
    setState({ sample, mode, last: packets, history: [...state.history.slice(1), rate] });
  }

  return state.history;
}

/** True only once `active` has held for `delayMs`, so a fast load never flashes a skeleton. */
function useDelayedFlag(active: boolean, delayMs = 160) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(id);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}

/** The loading placeholder: the Engine card, then the mode pair, at their loaded geometry. */
function PageSkeleton() {
  const header = (pad: string, badge: boolean) => (
    <CardHeader className={cn(pad, CARD_HEAD)}>
      <Skeleton className={SKELETON.TITLE} />
      <Skeleton className={SKELETON.DESC} />
      {badge ? (
        <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1", CARD_ACTION)}>
          <Skeleton className={SKELETON.BADGE} />
        </div>
      ) : null}
    </CardHeader>
  );
  return (
    <div className={STACK} aria-hidden="true">
      <Card className={HERO_SHELL}>
        {header(HERO_PAD, true)}
        <CardContent className={cn(HERO_PAD, ENGINE_GRID)}>
          <div className={CONTROL_COL}>
            <Skeleton className={SKELETON.LABEL} />
            <Skeleton className={SKELETON.CONTROL} />
            <div className={HOTSPOT_GROUP}>
              <Skeleton className={SKELETON.LABEL} />
              <Skeleton className={SKELETON.ONOFF} />
            </div>
            <div className={cn(ROWS, ENGINE_ROWS)}>
              <Skeleton className={SKELETON.ROW} />
              <Skeleton className={SKELETON.ROW} />
              <Skeleton className={SKELETON.ROW} />
            </div>
          </div>
          <div className={LIVE.ROOT}>
            <div className={LIVE.HEAD}>
              <Skeleton className={SKELETON.LEGEND} />
              <Skeleton className={SKELETON.RATE} />
            </div>
            <Skeleton className={SKELETON.CHART} />
          </div>
        </CardContent>
      </Card>
      <div className={PAIR}>
        {[0, 1].map((k) => (
          <Card key={k} className={CARD_SHELL}>
            {header(CARD_PAD, false)}
            <CardContent className={cn(CARD_PAD, CARD_BODY)}>
              <Skeleton className={SKELETON.STRIP} />
              <div className={ROWS}>
                <Skeleton className={SKELETON.ROW} />
                <Skeleton className={SKELETON.ROW} />
              </div>
              <div className="mt-auto flex min-h-16 items-center justify-between gap-4 pt-4">
                <Skeleton className={SKELETON.FOOT_STATUS} />
                <Skeleton className={SKELETON.FOOT_ACTION} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function TrafficEngine() {
  const { t } = useTranslation("local-network");
  const searchParams = useSearchParams();
  const reduceMotion = useMotionReduced();

  const vo = useVideoOptimizer();
  const fb = useFullBypass();
  // Owned here so the Engine card's view swaps never refetch it.
  const ttl = useTtlSettings();
  // Owned here so the Video Optimizer card's Acts on row and its hostnames view read one list.
  const hostlist = useCdnHostlist();

  // --- Engine truth. Live fields are engine-global (one tpws, one rule): either section answers.
  const source = vo.data ?? fb.data;
  const configMode: EngineMode | null = fb.data?.enabled
    ? "full_bypass"
    : vo.data?.enabled
      ? "video"
      : null;
  const status = source?.status ?? "stopped";
  const running = configMode !== null && status === "running";
  const installed = source?.binary_installed ?? false;
  const ruleOk = source?.kernel_module_loaded ?? false;
  const engineSaving = vo.isSaving || fb.isSaving;

  // --- In-flight engine change: set the instant the user acts, held until the poll confirms it.
  const [pending, setPending] = useState<Pending>(null);
  if (pending && !engineSaving && configMode === pending.target) setPending(null);
  // Safety net: a poll that never confirms must not strand the busy chip.
  useEffect(() => {
    if (pending === null) return;
    const id = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [pending]);

  const shownMode: EngineChoice = pending ? (pending.target ?? "off") : (configMode ?? "off");
  const history = usePacketHistory(
    source,
    running ? configMode : null,
    source?.packets_processed ?? 0,
  );

  const refreshEngine = useCallback(
    (silent: boolean) => {
      vo.refresh(silent);
      fb.refresh(silent);
    },
    [vo, fb],
  );

  // Retry after a failed read shows the loading state; nothing on screen is lost.
  const retryRead = useCallback(() => {
    refreshEngine(false);
    hostlist.refresh(true);
    ttl.refresh();
  }, [refreshEngine, hostlist, ttl]);

  // Header Refresh is silent; a running test survives it and the hostname draft keeps pending edits.
  const refreshAll = useCallback(() => {
    refreshEngine(true);
    hostlist.refresh(true);
    ttl.refresh();
  }, [refreshEngine, hostlist, ttl]);

  /** Every engine save: mark the transition, save, one toast, then re-read both sections silently. */
  const run = useCallback(
    async (next: Pending, save: () => Promise<MutationResult>, successKey: string) => {
      setPending(next);
      const result = await save();
      if (result.ok) {
        toast.success(t(successKey));
      } else {
        setPending(null);
        toast.error(t("traffic_engine.toast_mode_error"), {
          description: failureReason(t, result),
        });
      }
      // Both, even on failure: the backend mutex may have changed the other section.
      refreshEngine(true);
    },
    [t, refreshEngine],
  );

  const onModeChange = useCallback(
    (next: EngineChoice) => {
      if (next === shownMode || pending) return;
      if (next === "off") {
        const stop: Pending = { kind: "stop", target: null };
        if (configMode === "video") {
          void run(stop, () => vo.saveEnabled(false), "traffic_engine.toast_engine_off");
        } else if (configMode === "full_bypass") {
          void run(stop, () => fb.save(false, FULL_BYPASS_SNI), "traffic_engine.toast_engine_off");
        }
        return;
      }
      const kind: EngineTransition = configMode ? "switch" : "start";
      if (next === "video") {
        void run({ kind, target: "video" }, () => vo.saveEnabled(true), "traffic_engine.toast_video_enabled");
      } else {
        void run(
          { kind, target: "full_bypass" },
          () => fb.save(true, FULL_BYPASS_SNI),
          "traffic_engine.toast_full_bypass_enabled",
        );
      }
    },
    [shownMode, pending, configMode, run, vo, fb],
  );

  const install = useCallback(async () => {
    const result = await vo.installBinary();
    if (result.ok) toast.success(t("traffic_engine.toast_install_success"));
    else {
      toast.error(t("traffic_engine.toast_install_error"), {
        description: failureReason(t, result),
      });
    }
    refreshEngine(true);
    hostlist.refresh(true);
  }, [vo, t, refreshEngine, hostlist]);

  const uninstall = useCallback(async () => {
    const result = await vo.uninstallBinary();
    if (result.ok) toast.success(t("traffic_engine.advanced_toast_success"));
    else {
      toast.error(t("traffic_engine.advanced_toast_error"), {
        description: failureReason(t, result),
      });
    }
    refreshEngine(true);
  }, [vo, t, refreshEngine]);

  // --- Read states ---
  const isLoading = vo.isLoading || fb.isLoading;
  const showSkeleton = useDelayedFlag(isLoading);
  // Nothing was ever read, distinct from a poll that failed on top of data.
  const readFailed = !isLoading && source === null;
  const pollFailed = source !== null && !engineSaving && (vo.error !== null || fb.error !== null);
  const ready = !isLoading && !readFailed && installed;

  // --- `?mode=` deep link: scroll to that card and highlight it a moment. ---
  const deepLink = searchParams.get("mode");
  const linkTarget: EngineMode | null =
    deepLink === "full_bypass" ? "full_bypass" : deepLink === "video" ? "video" : null;
  const [highlight, setHighlight] = useState<EngineMode | null>(null);
  const linkHandled = useRef(false);
  useEffect(() => {
    if (!ready || !linkTarget || linkHandled.current) return;
    linkHandled.current = true;
    const show = setTimeout(() => {
      document.getElementById(modeCardId(linkTarget))?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
      setHighlight(linkTarget);
    }, 0);
    const hide = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [ready, linkTarget, reduceMotion]);

  const retryButton = (
    <button
      type="button"
      onClick={retryRead}
      className={bannerActionVariants({ tone: "destructive" })}
    >
      <RefreshCcwIcon aria-hidden="true" />
      {t("actions.retry", { ns: "common" })}
    </button>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = showSkeleton ? (
      <div className={STACK}>
        <PageSkeleton />
        <div className={PAIR}>
          <VerifyCardSkeleton />
          <ForceTcpCard />
        </div>
      </div>
    ) : null;
  } else if (readFailed) {
    const tone = CONDITION_TONE.destructive;
    body = (
      <div className={STACK}>
        <Card className={HERO_SHELL}>
          <CardContent className={CARD_PAD}>
            <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
              <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
                <TriangleAlertIcon className={CONDITION.GLYPH} />
              </span>
              <h2 className={CONDITION.TITLE}>{t("traffic_engine.error_load_title")}</h2>
              <p className={CONDITION.DESC}>{t("traffic_engine.error_load_failed")}</p>
              <div className={CONDITION.ACTIONS}>
                <Button
                  variant="ghost"
                  size="action"
                  onClick={retryRead}
                  className={tone.ACTION}
                >
                  <RefreshCcwIcon aria-hidden="true" />
                  {t("actions.retry", { ns: "common" })}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <ForceTcpCard />
      </div>
    );
  } else if (!installed) {
    body = (
      <div className={STACK}>
        <EngineOnboarding
          phase={vo.installPhase}
          installing={vo.isInstalling}
          onInstall={() => void install()}
          onRefresh={retryRead}
        />
        <ForceTcpCard />
      </div>
    );
  } else {
    const busy = pending !== null;
    body = (
      <div className={STACK}>
        {pollFailed ? (
          <Banner
            role="stale"
            title={t("traffic_engine.stale_title")}
            description={t("traffic_engine.stale_body")}
            action={retryButton}
          />
        ) : null}
        {/* A failed removal stays until dismissed. `stale` has no X, so the dismiss is the action. */}
        {vo.installPhase === "error" && !vo.isUninstalling ? (
          <Banner
            role="stale"
            title={t("traffic_engine.binary_op_failed")}
            description={t("traffic_engine.binary_op_failed_body")}
            action={
              <button
                type="button"
                onClick={vo.dismissBinaryOpError}
                className={bannerActionVariants({ tone: "destructive" })}
              >
                {t("actions.dismiss", { ns: "common" })}
              </button>
            }
          />
        ) : null}
        {running && !ruleOk && !busy ? (
          <Banner
            role="degraded"
            title={t("traffic_engine.rule_banner_title")}
            description={t("traffic_engine.rule_banner_desc")}
          />
        ) : null}
        <EngineCard
          shownMode={shownMode}
          activeMode={configMode}
          transition={pending?.kind ?? null}
          status={status}
          ruleOk={ruleOk}
          onModeChange={onModeChange}
          uptime={source?.uptime ?? ""}
          packets={source?.packets_processed ?? 0}
          history={history}
          ttl={ttl}
          isUninstalling={vo.isUninstalling}
          uninstallStep={vo.isUninstalling ? t("traffic_engine.pkg_status_removing") : null}
          onUninstall={() => void uninstall()}
        />
        <div className={PAIR}>
          <VideoOptimizerCard
            hostlist={hostlist}
            active={running && configMode === "video" && !busy}
            owner={configMode === "video"}
            otherOwns={configMode === "full_bypass"}
            busy={busy}
            highlighted={highlight === "video"}
          />
          <FullBypassCard
            active={running && configMode === "full_bypass" && !busy}
            owner={configMode === "full_bypass"}
            otherOwns={configMode === "video"}
            busy={busy}
            highlighted={highlight === "full_bypass"}
          />
        </div>
        <div className={PAIR}>
          <VerifyCard binaryInstalled={installed} />
          <ForceTcpCard />
        </div>
      </div>
    );
  }

  return (
    <motion.div className={PAGE_ROOT} variants={staggerContainer} initial="hidden" animate="visible">
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t("traffic_engine.page_title")}</h1>
            <p className={PAGE_HEAD.DESC}>{t("traffic_engine.page_description")}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={refreshAll}
              disabled={isLoading}
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "motion-safe:animate-spin")}
                aria-hidden="true"
              />
              {t("traffic_engine.refresh")}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>{body}</motion.div>
    </motion.div>
  );
}

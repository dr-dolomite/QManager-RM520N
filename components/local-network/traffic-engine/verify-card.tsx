"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  DownloadIcon,
  GaugeIcon,
  Loader2Icon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricBar, type MetricBarTone } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { VerifyResult } from "@/types/traffic-engine";

import {
  CARD_ACTION,
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CMP_ROW,
  FOOTNOTE,
  HEADLINE,
  RESTING,
  SKELETON,
} from "./shapes";

// The bypass benefit test: the same file with and without the bypass, against a reference
// sample, drawn as rows on one scale. Same verify POST, verify_status poll and 12-minute window.

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 3000;
const MAX_POLLS = 240;

/** A sample's share of the scale on the quality ramp; the bar length carries the same value. */
function rampTone(share: number): MetricBarTone {
  if (share >= 0.85) return "quality-5";
  if (share >= 0.65) return "quality-4";
  if (share >= 0.45) return "quality-3";
  if (share >= 0.25) return "quality-2";
  return "quality-1";
}

function ComparisonRow({
  label,
  speed,
  scaleMax,
  winner,
  index,
  verdict,
}: {
  label: string;
  speed: number;
  scaleMax: number;
  winner: boolean;
  index: number;
  verdict: React.ReactNode;
}) {
  const { t } = useTranslation("local-network");
  const share = scaleMax > 0 ? speed / scaleMax : 0;

  return (
    <motion.li
      className={cn(CMP_ROW.ROOT, winner ? CMP_ROW.WINNER : CMP_ROW.NEUTRAL)}
      variants={staggerRowItem}
    >
      <span className={cn(CMP_ROW.LABEL, !winner && CMP_ROW.LABEL_IDLE)}>{label}</span>
      <span className={CMP_ROW.LANE}>
        <span className={CMP_ROW.NUM}>
          {speed}
          <span className={CMP_ROW.UNIT}>{t("traffic_engine.verify_unit")}</span>
        </span>
        {/* Thresholds sit above the ceiling: the tone comes only from the ramp override. */}
        <MetricBar
          value={speed}
          max={scaleMax}
          warnAt={Number.POSITIVE_INFINITY}
          dangerAt={Number.POSITIVE_INFINITY}
          colorOverride={rampTone(share)}
          track="surface-container-high"
          index={index}
        />
      </span>
      <span className={CMP_ROW.RIGHT}>{verdict}</span>
    </motion.li>
  );
}

function VerifyHeader({ action }: { action?: React.ReactNode }) {
  const { t } = useTranslation("local-network");
  return (
    <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
      <CardTitle className={CARD_TITLE}>{t("traffic_engine.verify_title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("traffic_engine.verify_description")}
      </CardDescription>
      {action ? <CardAction className={CARD_ACTION}>{action}</CardAction> : null}
    </CardHeader>
  );
}

export interface VerifyCardProps {
  /** The only gate: the engine does not need to be running to be measured. */
  binaryInstalled: boolean;
}

export function VerifyCard({ binaryInstalled }: VerifyCardProps) {
  const { t } = useTranslation("local-network");

  const [result, setResult] = React.useState<VerifyResult | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const poll = React.useCallback(async () => {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!mountedRef.current) return false;
      try {
        const resp = await authFetch(`${CGI_ENDPOINT}?action=verify_status`);
        if (!resp.ok) continue;
        const json = await resp.json();
        if (!mountedRef.current) return false;
        if (json.status === "complete" || json.status === "error") {
          setResult(json);
          return json.status === "complete";
        }
      } catch {
        continue;
      }
    }
    setError(t("traffic_engine.verify_timeout"));
    return false;
  }, [t]);

  const runVerify = async () => {
    setError(null);
    setResult(null);
    setIsRunning(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.success === false) {
        setError(json.detail || json.error || t("traffic_engine.verify_error"));
        return;
      }
      await poll();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : t("traffic_engine.verify_error"));
      }
    } finally {
      if (mountedRef.current) setIsRunning(false);
    }
  };

  const complete =
    result !== null &&
    result.status === "complete" &&
    result.with_bypass !== undefined &&
    result.without_bypass !== undefined;
  const failed = result !== null && result.status === "error";

  const without = result?.without_bypass;
  const bypassed = result?.with_bypass;
  const reference = result?.reference ?? null;

  // The ceiling is the fastest sample, so the winning bar reaches 100%.
  const scaleMax = Math.max(
    without?.speed_mbps ?? 0,
    bypassed?.speed_mbps ?? 0,
    reference?.speed_mbps ?? 0,
  );
  // The winner answers "did the bypass help"; the reference never competes.
  const bypassWon = (bypassed?.speed_mbps ?? 0) > (without?.speed_mbps ?? 0);

  const verdictChip = (throttled: boolean) => (
    <Badge variant={throttled ? "warning" : "success"}>
      {throttled ? (
        <TriangleAlertIcon className="size-3" aria-hidden="true" />
      ) : (
        <CheckCircle2Icon className="size-3" aria-hidden="true" />
      )}
      {t(throttled ? "traffic_engine.verify_throttled" : "traffic_engine.verify_unthrottled")}
    </Badge>
  );

  return (
    <Card id="traffic-engine-verify" className={CARD_SHELL}>
      {/* One run action: inside the resting block until a result exists, then in the header. */}
      <VerifyHeader
        action={
          complete ? (
            <Button
              variant="tonal"
              size="sm"
              onClick={runVerify}
              disabled={!binaryInstalled || isRunning}
            >
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t("traffic_engine.verify_run_again")}
            </Button>
          ) : undefined
        }
      />

      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        {error !== null ? (
          <Banner role="degraded" title={t("traffic_engine.verify_error")} description={error} />
        ) : null}
        {failed ? (
          <Banner
            role="degraded"
            title={t("traffic_engine.verify_error")}
            description={result?.detail || result?.message}
          />
        ) : null}

        {complete && without && bypassed ? (
          <>
            <div className={HEADLINE.ROOT}>
              <span className={HEADLINE.BIG}>{result?.improvement}</span>
              <span className={HEADLINE.SUB}>{t("traffic_engine.verify_headline_sub")}</span>
            </div>
            <motion.ul className={CMP_ROW.STACK} variants={staggerRows} initial="hidden" animate="visible">
              <ComparisonRow
                label={t("traffic_engine.verify_without")}
                speed={without.speed_mbps}
                scaleMax={scaleMax}
                winner={!bypassWon}
                index={0}
                verdict={verdictChip(without.throttled)}
              />
              <ComparisonRow
                label={t("traffic_engine.verify_with")}
                speed={bypassed.speed_mbps}
                scaleMax={scaleMax}
                winner={bypassWon}
                index={1}
                verdict={verdictChip(bypassed.throttled)}
              />
              {reference ? (
                <ComparisonRow
                  label={t("traffic_engine.verify_line_speed")}
                  speed={reference.speed_mbps}
                  scaleMax={scaleMax}
                  winner={false}
                  index={2}
                  verdict={
                    <Tag variant="neutral">
                      {t(
                        reference.source === "speedtest"
                          ? "traffic_engine.verify_source_speedtest"
                          : "traffic_engine.verify_source_cloudflare",
                      )}
                    </Tag>
                  }
                />
              ) : null}
            </motion.ul>
            {reference ? <p className={FOOTNOTE}>{t("traffic_engine.verify_footnote")}</p> : null}
            {/* Unconditional: a result measures the technique, not the running engine. */}
            <p className={FOOTNOTE}>{t("traffic_engine.verify_scope")}</p>
          </>
        ) : (
          <div
            className={RESTING.ROOT}
            role={isRunning ? "status" : undefined}
            aria-live={isRunning ? "polite" : undefined}
          >
            <span className={cn(RESTING.DISC, isRunning && RESTING.DISC_ACTIVE)} aria-hidden="true">
              {isRunning ? (
                <Loader2Icon className={cn(RESTING.GLYPH, "motion-safe:animate-spin")} />
              ) : binaryInstalled ? (
                <GaugeIcon className={RESTING.GLYPH} />
              ) : (
                <DownloadIcon className={RESTING.GLYPH} />
              )}
            </span>
            <span className={RESTING.TITLE}>
              {t(
                isRunning
                  ? "traffic_engine.verify_running"
                  : binaryInstalled
                    ? "traffic_engine.verify_idle_heading"
                    : "traffic_engine.verify_needs_binary_heading",
              )}
            </span>
            {!binaryInstalled || isRunning ? (
              <p className={RESTING.BODY}>
                {t(isRunning ? "traffic_engine.verify_progress" : "traffic_engine.verify_needs_binary")}
              </p>
            ) : null}
            {binaryInstalled && !isRunning ? (
              <Button variant="tonal" onClick={runVerify} size="action" className={RESTING.ACTION}>
                <GaugeIcon className="size-4" aria-hidden="true" />
                {t("traffic_engine.verify_run")}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The loading mirror: the resting face, the shape a cold load resolves to. */
export function VerifyCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <Skeleton className={SKELETON.TITLE} />
        <Skeleton className={SKELETON.DESC_3} />
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        <Skeleton className={SKELETON.RESTING} />
      </CardContent>
    </Card>
  );
}

export default VerifyCard;

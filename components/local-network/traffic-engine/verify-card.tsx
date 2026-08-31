"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  Loader2Icon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MetricBar, type MetricBarTone } from "@/components/ui/metric-bar";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";

import {
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CMP_ROW,
  FOOTNOTE,
  HEADLINE,
  PILL_ACTION,
} from "./shapes";
import type { VerifyResult } from "@/types/traffic-engine";

// =============================================================================
// VerifyCard — "Test bypass", drawn as a comparison rather than a list
// =============================================================================
// This is Call B, and it merges `engine-check-row.tsx` (the run/poll machinery)
// with `result-alert.tsx` (the result). The backend contract is untouched: the
// same `action=verify` POST, the same `action=verify_status` poll, the same
// 12-minute window — each phase can take two 3-minute speedtest attempts on a
// throttled link, and a tighter window reported false timeouts.
//
// -----------------------------------------------------------------------------
// WHY THE RESULT IS A GRAPHIC NOW
// -----------------------------------------------------------------------------
// Finding 18, and it is the biggest unclaimed win on the surface. The whole
// feature exists to answer ONE question — "is the bypass actually helping?" —
// and the answer was three `justify-between` rows inside a stock `Alert`, so
// you had to compare three numerals by eye.
//
// The canon already specifies the shape for that question, and it already
// ships: `components/cellular/antenna-alignment/recorder-card.tsx` draws its
// position comparison as rows on ONE shared 0-100 scale, so "which won" is read
// by BAR LENGTH at a glance. Three bars in three separate boxes are three
// readings; three bars in a stack are a comparison.
//
// -----------------------------------------------------------------------------
// THE THIRD ROW IS A REFERENCE, NOT A CONTESTANT
// -----------------------------------------------------------------------------
// Line speed measures the class of traffic ISPs usually do NOT throttle (Ookla,
// falling back to Cloudflare), so a low fast.com beside a healthy reference
// means real CDN throttling while a slow reference means the line itself is
// slow (docs/reference/dpi.md > Verify). It shares the scale so it can be read
// against the other two, but it can never be the WINNER — the winner answers
// "did the bypass help", and the line speed is not competing in that.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 3000;
const MAX_POLLS = 240;

/**
 * A sample's share of the scale, mapped onto the five-stop quality ramp.
 *
 * Deliberately LOCAL rather than routed through
 * `components/cellular/signal-quality-display.ts`: that map converts a radio
 * measurement in dBm against fixed physical thresholds, and this is a
 * throughput SHARE of a scale whose maximum is whatever the fastest of the
 * three samples happened to be. Reusing it would import thresholds that mean
 * nothing here — and `/local-network/` does not reach into `components/cellular/`
 * for geometry or for logic.
 *
 * The ramp tone is only legal at all because the bar beside it carries the same
 * value in LENGTH: adjacent stops sit below the CVD separation floor by design,
 * so colour is never the only channel (DESIGN.md > The signal quality ramp).
 */
function rampTone(share: number): MetricBarTone {
  if (share >= 0.85) return "quality-5";
  if (share >= 0.65) return "quality-4";
  if (share >= 0.45) return "quality-3";
  if (share >= 0.25) return "quality-2";
  return "quality-1";
}

/** One comparison row. Length carries the answer; the chip carries the verdict. */
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
  const { t } = useTranslation("common");
  const share = scaleMax > 0 ? speed / scaleMax : 0;

  return (
    <motion.li
      className={cn(CMP_ROW.ROOT, winner ? CMP_ROW.WINNER : CMP_ROW.NEUTRAL)}
      variants={staggerRowItem}
    >
      <span className={cn(CMP_ROW.LABEL, !winner && CMP_ROW.LABEL_IDLE)}>{label}</span>
      <span className={CMP_ROW.LANE}>
        {/* The winning row inherits `on-primary-container` rather than ramp ink:
            `--quality-N` is measured for 4.5:1 against a CARD ground, not
            against `primary-container`. Length still carries the quality. */}
        <span className={CMP_ROW.NUM}>
          {speed}
          <span className={CMP_ROW.UNIT}>{t("trafficEngine.verify.unit")}</span>
        </span>
        <MetricBar
          value={speed}
          max={scaleMax}
          /* Both thresholds sit above the ceiling on purpose: the tone comes
             entirely from `colorOverride`, and leaving these live would let a
             fast sample flip to `destructive` for being large. */
          warnAt={Number.POSITIVE_INFINITY}
          dangerAt={Number.POSITIVE_INFINITY}
          colorOverride={rampTone(share)}
          size="md"
          /* ONE track on every row, including the winner's, and the alignment
             card's opposite choice does not survive measurement.

             That card switches its best row to `muted`, reasoning that
             `surface-container-high` "renders LIGHTER than its own ground" on
             `primary-container` and reads as a second pale segment past the end
             of the fill. Against the tokens:

               light   muted 0.967   surface-container-high 0.938   ground 0.890
               dark    muted 0.200   surface-container-high 0.235   ground 0.375

             In DARK both tracks are darker than the ground, so the collision it
             describes does not exist there. In LIGHT both are lighter — and
             `muted` is lighter still, so the swap moves 0.048 further from the
             ground rather than closer. `surface-container-high` is the nearer
             value in light and comfortably darker in dark, which makes it the
             better track in both themes and the same one every other row uses.
             Verified on screen in both themes before this was written. */
          track="surface-container-high"
          index={index}
        />
      </span>
      <span className={CMP_ROW.RIGHT}>{verdict}</span>
    </motion.li>
  );
}

export interface VerifyCardProps {
  /** The only gate: the engine does not need to be running to be measured. */
  binaryInstalled: boolean;
}

export function VerifyCard({ binaryInstalled }: VerifyCardProps) {
  const { t } = useTranslation("common");

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
    setError(t("trafficEngine.verify.timeout"));
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
        setError(json.detail || json.error || t("trafficEngine.verify.error"));
        return;
      }
      await poll();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : t("trafficEngine.verify.error"));
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

  // The scale's ceiling is the fastest of the three samples, so the winning bar
  // always reaches 100% and every other length is read against it.
  const scaleMax = Math.max(
    without?.speed_mbps ?? 0,
    bypassed?.speed_mbps ?? 0,
    reference?.speed_mbps ?? 0,
  );

  // The winner answers "did the bypass help". The reference never competes.
  const bypassWon = (bypassed?.speed_mbps ?? 0) > (without?.speed_mbps ?? 0);

  const verdictChip = (throttled: boolean) => (
    <Badge variant={throttled ? "warning" : "success"}>
      {throttled ? (
        <TriangleAlertIcon className={CHIP_GLYPH} aria-hidden="true" />
      ) : (
        <CheckCircle2Icon className={CHIP_GLYPH} aria-hidden="true" />
      )}
      {t(
        throttled
          ? "trafficEngine.verify.throttled"
          : "trafficEngine.verify.unthrottled",
      )}
    </Badge>
  );

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT)}>
        <div className={CARD_HEAD.TITLES}>
          <span className={CARD_TITLE}>{t("trafficEngine.verify.title")}</span>
          <span className={CARD_HEAD.DESC}>{t("trafficEngine.verify.description")}</span>
        </div>
        <div className={CARD_HEAD.ACTIONS}>
          <Button
            variant="tonal"
            onClick={runVerify}
            disabled={!binaryInstalled || isRunning}
            className={PILL_ACTION}
          >
            {isRunning ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCcwIcon className="size-4" />
            )}
            {t(isRunning ? "trafficEngine.verify.running" : "trafficEngine.verify.run")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {!binaryInstalled ? (
          <p className={FOOTNOTE}>{t("trafficEngine.verify.needs_binary")}</p>
        ) : null}

        {error !== null ? (
          <Banner
            role="degraded"
            title={t("trafficEngine.verify.error")}
            description={error}
          />
        ) : null}

        {failed ? (
          <Banner
            role="degraded"
            title={t("trafficEngine.verify.error")}
            description={result?.detail || result?.message}
          />
        ) : null}

        {complete && without && bypassed ? (
          <>
            <div className={HEADLINE.ROOT}>
              <span className={HEADLINE.BIG}>{result?.improvement}</span>
              <span className={HEADLINE.SUB}>
                {t("trafficEngine.verify.headline_sub")}
              </span>
            </div>

            <motion.ul
              className={CMP_ROW.STACK}
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              <ComparisonRow
                label={t("trafficEngine.verify.without")}
                speed={without.speed_mbps}
                scaleMax={scaleMax}
                winner={!bypassWon}
                index={0}
                verdict={verdictChip(without.throttled)}
              />
              <ComparisonRow
                label={t("trafficEngine.verify.with")}
                speed={bypassed.speed_mbps}
                scaleMax={scaleMax}
                winner={bypassWon}
                index={1}
                verdict={verdictChip(bypassed.throttled)}
              />
              {reference ? (
                <ComparisonRow
                  label={t("trafficEngine.verify.line_speed")}
                  speed={reference.speed_mbps}
                  scaleMax={scaleMax}
                  winner={false}
                  index={2}
                  verdict={
                    <Tag variant="neutral">
                      {t(
                        reference.source === "speedtest"
                          ? "trafficEngine.verify.source_speedtest"
                          : "trafficEngine.verify.source_cloudflare",
                      )}
                    </Tag>
                  }
                />
              ) : null}
            </motion.ul>

            {reference ? <p className={FOOTNOTE}>{t("trafficEngine.verify.footnote")}</p> : null}
          </>
        ) : !isRunning && error === null && !failed ? (
          <p className={FOOTNOTE}>{t("trafficEngine.verify.idle")}</p>
        ) : null}

        {isRunning ? <p className={FOOTNOTE}>{t("trafficEngine.verify.progress")}</p> : null}
      </CardContent>
    </Card>
  );
}

export default VerifyCard;

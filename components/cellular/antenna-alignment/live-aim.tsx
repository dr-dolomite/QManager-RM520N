"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { SwapLabel } from "@/components/ui/swap-label";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
} from "@/types/modem-status";
import type { SignalPerAntenna, SignalThresholds } from "@/types/modem-status";
import { getValueColorClass } from "@/components/dashboard/signal-card-utils";
import { QUALITY_GLYPH, qualityBadgeVariant, qualityMeterTone } from "../signal-quality-display";
import { SCORE_WEIGHTS, normalizeValue, scoreLive } from "./utils";

// =============================================================================
// Live Aim — the anchor instrument
// =============================================================================
// This card exists because the page's visual hierarchy was inverted. Aiming an
// antenna is a closed physical loop: the user is outdoors with a phone in one
// hand and hardware in the other, rotating and watching for change over minutes.
// The only figure that serves that loop is the live composite for the primary
// chain — and it used to be the SMALLEST type on the page (13px values under
// 10px labels, in a washed sub-box, inside a card about something else), while
// twelve numbers the user cannot act on mid-rotation got full card chrome.
//
// It is deliberately an INSTRUMENT, not a hero metric. PRODUCT.md bans the
// hero-metric template by name — "big number, small label, gradient accent",
// filed under generic AI/SaaS dashboard slop — and the distinction that keeps
// this legal is decomposability: the
// score never appears alone. It arrives with the two weighted legs that produced
// it, its session peak, its change since the last measurement, and the modem's
// own timestamp. A number you can take apart is an instrument; a number you can
// only admire is decoration.
//
// The composite is the SAME function the recorder ranks by (`scoreLive` wraps
// `scoreSnapshot`), so "what am I reading now" and "what did I record there" are
// the same unit and can be compared directly. Surfacing it is not an invention:
// the score was already computed and already decided which slot won — it was
// simply never shown, so the user saw a verdict and never the margin.
//
// NO VALUE TICK ON THIS CARD, deliberately, and this is the one place the
// product's tick gesture is declined. The tick dips a figure to 0.35 opacity for
// 700ms to mark "this just moved". Correct on a dashboard glanced at for a
// second; wrong here, where the figure changes every ~4s and the user is staring
// at it continuously — it would be dimmed roughly a fifth of the time they are
// reading it, outdoors, in sunlight. The change signal is the delta chip and the
// meter retarget instead: one authored moment rather than a per-poll flicker on
// the one number that matters.
// =============================================================================

export const AIM_SHELL =
  "h-full gap-5 rounded-hero border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]";

export const AIM_SHAPE = {
  /**
   * 52px, mono, tabular. A literal px size on a `tabular-nums` numeral is
   * correct by construction per DESIGN.md — a numeral is read at the distance
   * its container implies, so its size derives from the slot rather than from
   * the type ramp. 52px is the product's existing "live figure being watched"
   * step, shared with the Speed Test dialog's running phase.
   */
  SCORE: "text-[52px] font-semibold leading-none tabular-nums",
  SCORE_BOX: "h-[52px]",
  METER_TRACK: "relative h-2 w-full",
  LEG_ROW: "flex items-center gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  LEG_KEY: "w-24 shrink-0 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant",
  LEG_VALUE:
    "w-[5.25rem] shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
  EYEBROW: "text-xs font-semibold text-on-surface-variant",
} as const;

/** Height of the whole score block, so the skeleton can mirror it by import. */
export const AIM_SCORE_BLOCK_HEIGHT = 92;

// -----------------------------------------------------------------------------
// Session tracking: peak and delta
// -----------------------------------------------------------------------------

/**
 * Remembers the best score seen this session and the change since the previous
 * measurement.
 *
 * Peak-hold is the affordance the recorder cannot provide. The recorder compares
 * three DISCRETE positions and needs you to stop moving, tap Record, and hold
 * still — it cannot help you SWEEP. But you cannot watch a number and
 * simultaneously remember its best value while your body is rotating a mast, so
 * without a peak the sweep is unmeasurable.
 *
 * Both are session-scoped and deliberately NOT persisted: they are facts about
 * the current sweep, not measurements, and writing them to storage would let a
 * peak from yesterday's roof visit outrank what the antenna is doing now.
 *
 * Gated on the modem's timestamp for the same reason the sampler is — a repeated
 * fetch of an unchanged snapshot is not a new measurement, and letting it through
 * would report a delta of 0 as though the signal had genuinely held steady.
 */
function useSessionTracking(score: number | null, snapshotTs: number | null) {
  const [peak, setPeak] = React.useState<number | null>(null);
  const [delta, setDelta] = React.useState<number | null>(null);
  const previousRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (score === null || snapshotTs === null) return;
    if (lastTsRef.current === snapshotTs) return;
    lastTsRef.current = snapshotTs;

    const previous = previousRef.current;
    previousRef.current = score;

    setPeak((current) => (current === null || score > current ? score : current));
    setDelta(previous === null ? null : score - previous);
  }, [score, snapshotTs]);

  return { peak, delta };
}

// -----------------------------------------------------------------------------
// One weighted leg
// -----------------------------------------------------------------------------

function LegRow({
  label,
  weight,
  value,
  unit,
  thresholds,
  index,
}: {
  label: string;
  weight: number;
  value: number | null;
  unit: string;
  thresholds: SignalThresholds;
  index: number;
}) {
  const { t } = useTranslation("cellular");
  const quality = getSignalQuality(value, thresholds);

  return (
    <div className={AIM_SHAPE.LEG_ROW}>
      <span className={AIM_SHAPE.LEG_KEY}>
        {label}
        {/* The weight is part of the claim: a user who sees 60% next to RSRP can
            work out why a strong RSRP with a weak SINR still scores well, which
            is the difference between an instrument and an oracle. */}
        <span className="ml-1.5 tabular-nums opacity-70">
          {Math.round(weight * 100)}%
        </span>
      </span>

      {value === null ? (
        <span className="flex-1 truncate text-xs text-on-surface-variant">
          {t("antenna_alignment.aim.not_reported")}
        </span>
      ) : (
        <div className="flex-1" aria-hidden="true">
          <MetricBar
            value={signalToProgress(value, thresholds)}
            max={100}
            warnAt={101}
            dangerAt={101}
            colorOverride={qualityMeterTone(quality)}
            size="md"
            track="surface-container-high"
            index={index}
          />
        </div>
      )}

      <span className={cn(AIM_SHAPE.LEG_VALUE, getValueColorClass(quality))}>
        {value === null ? "—" : `${value} ${unit}`}
        {/* `success-on-surface` and `warning-on-surface` measure ~1.01:1 apart —
            same luminance, hue only — so the tint is not a channel a
            screen-reader or a colour-blind user can read. The word is. */}
        {value !== null && (
          <span className="sr-only"> {t(`antenna_alignment.quality.${quality}`)}</span>
        )}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

export function LiveAimCard({
  spa,
  snapshotTs,
  updatedAt,
}: {
  spa: SignalPerAntenna;
  /** The modem's own timestamp for this snapshot, in seconds. */
  snapshotTs: number | null;
  /** Already-formatted clock time of the snapshot, or null. */
  updatedAt: string | null;
}) {
  const { t } = useTranslation("cellular");

  const score = scoreLive(spa);
  const { peak, delta } = useSessionTracking(score.value, snapshotTs);

  const radio = score.radio;
  const rsrp = radio ? normalizeValue(spa[`${radio}_rsrp`][0], "rsrp") : null;
  const sinr = radio ? normalizeValue(spa[`${radio}_sinr`][0], "sinr") : null;

  // 3GPP calls NR's metric SNR, not SINR. Reuse the radio-info labels so the
  // two antenna pages cannot disagree about what a row is called.
  const sinrLabelKey = radio === "nr" ? "snr" : "sinr";

  const overallQuality = getSignalQuality(
    rsrp,
    RSRP_THRESHOLDS
  );

  const showDelta = delta !== null && Math.abs(delta) >= 1;

  return (
    <Card className={AIM_SHELL}>
      <CardHeader className="gap-1 px-0">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="min-w-0 truncate text-xl font-semibold">
              {t("antenna_alignment.aim.title")}
            </CardTitle>
            <CardDescription className="min-w-0 text-[13px]">
              {t("antenna_alignment.aim.description")}
            </CardDescription>
          </div>
          {radio && (
            <Badge
              variant={radio === "nr" ? "nr" : "lte"}
              className="shrink-0 px-2.5 py-1 text-xs font-semibold"
            >
              {t(`antenna_alignment.mode.${radio}`)}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 px-0">
        {/* --- Score, delta, peak ------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="flex flex-col gap-1">
              <span className={AIM_SHAPE.EYEBROW}>
                {t("antenna_alignment.aim.score_label")}
              </span>
              <span
                className={cn(AIM_SHAPE.SCORE, AIM_SHAPE.SCORE_BOX)}
                aria-label={
                  score.value === null
                    ? t("antenna_alignment.aim.no_reading")
                    : t("antenna_alignment.aim.score_sr", { score: score.value })
                }
              >
                {score.value === null ? "—" : score.value}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 pb-1">
              {/* A delta is NOT a status: signal dropping while you rotate is
                  expected information, not a fault, so it must not wear
                  `destructive`. It is a non-status label per DESIGN.md, and its
                  DIRECTION rides the glyph rather than a hue — which is also
                  what makes it survive deuteranopia and grayscale. Rendered only
                  when it moved at least a point; a chip that says "no change" is
                  noise on a surface being watched continuously. */}
              {showDelta && (
                <Badge variant="secondary" className="w-fit px-2.5 py-1">
                  <SwapLabel swapKey={`${delta}`} className="gap-1">
                    <MaterialSymbol
                      name={delta! > 0 ? "arrow_upward" : "arrow_downward"}
                      size={12}
                      filled
                    />
                    <span className="tabular-nums">
                      {delta! > 0 ? `+${delta}` : `${delta}`}
                    </span>
                    <span className="sr-only">
                      {delta! > 0
                        ? t("antenna_alignment.aim.delta_up")
                        : t("antenna_alignment.aim.delta_down")}
                    </span>
                  </SwapLabel>
                </Badge>
              )}

              {score.partial && score.value !== null && (
                <Badge variant="muted" className="w-fit px-2.5 py-1">
                  <MaterialSymbol name="warning" size={12} filled />
                  {t("antenna_alignment.aim.partial", {
                    leg: t(
                      `radio_info.bands.metric.${score.legs[0] === "sinr" ? sinrLabelKey : "rsrp"}`
                    ),
                  })}
                </Badge>
              )}
            </div>

            <div className="ml-auto flex flex-col items-end gap-0.5">
              {peak !== null && (
                <span className="text-xs text-on-surface-variant">
                  {t("antenna_alignment.aim.peak")}{" "}
                  <span className="font-semibold tabular-nums text-on-surface">
                    {peak}
                  </span>
                </span>
              )}
              {updatedAt && (
                <span className="text-xs text-on-surface-variant">
                  {t("antenna_alignment.aim.updated")}{" "}
                  <span className="tabular-nums">{updatedAt}</span>
                </span>
              )}
            </div>
          </div>

          {/* --- Composite meter with the session peak mark ----------------- */}
          <div className={AIM_SHAPE.METER_TRACK}>
            {/* A null composite is NOT zero percent, and it does not get a track.
                An empty track reads as "the score is zero" — a different and more
                alarming claim than "nothing was measured", and it is the exact
                misreading the shared sentinel boundary exists to prevent. The
                "—" above already says it was not measured, so only the height is
                reserved, keeping this block's geometry identical either way.
                Precedent: the null branch of the meter this card replaces. */}
            {score.value === null ? (
              <div aria-hidden="true" className="h-2" />
            ) : (
              <MetricBar
                value={score.value}
                max={100}
                warnAt={101}
                dangerAt={101}
                colorOverride={qualityMeterTone(overallQuality)}
                size="md"
                track="surface-container-high"
              />
            )}
            {/* The peak mark is positioned with `left`, and it is deliberately
                NOT transitioned. DESIGN.md's Transform-Only Rule keeps layout
                properties out of animations (the aggregation segment is the one
                sanctioned exception), and an instant jump is also the honest
                gesture: a new session high is a discrete event, and having the
                mark snap is what makes it legible as "that is the best you have
                managed" rather than as a second bar creeping along. */}
            {peak !== null && score.value !== null && peak > score.value && (
              <span
                aria-hidden="true"
                className="absolute top-[-2px] h-3 w-0.5 rounded-pill bg-on-surface-variant"
                style={{ left: `calc(${peak}% - 1px)` }}
              />
            )}
          </div>
        </div>

        {/* --- The two weighted legs --------------------------------------- */}
        <div className="flex flex-col gap-2">
          <LegRow
            label={t("radio_info.bands.metric.rsrp")}
            weight={SCORE_WEIGHTS.rsrp}
            value={rsrp}
            unit="dBm"
            thresholds={RSRP_THRESHOLDS}
            index={0}
          />
          <LegRow
            label={t(`radio_info.bands.metric.${sinrLabelKey}`)}
            weight={SCORE_WEIGHTS.sinr}
            value={sinr}
            unit="dB"
            thresholds={SINR_THRESHOLDS}
            index={1}
          />
        </div>

        {/* Quality verdict for the primary chain, as a filled chip with its
            mandatory glyph — the non-chromatic channel that survives a container
            fill washed out by direct sun. */}
        <div className="flex items-center gap-2">
          <Badge variant={qualityBadgeVariant(overallQuality)}>
            <SwapLabel
              swapKey={`${overallQuality}`}
              className="gap-1"
            >
              <MaterialSymbol name={QUALITY_GLYPH[overallQuality]} size={12} filled />
              {t(`antenna_alignment.quality.${overallQuality}`)}
            </SwapLabel>
          </Badge>
          <span className="min-w-0 truncate text-xs text-on-surface-variant">
            {t("antenna_alignment.aim.primary_chain")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveAimCard;

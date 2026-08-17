"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  worstSignalQuality,
} from "@/types/modem-status";
import type { SignalPerAntenna, SignalThresholds } from "@/types/modem-status";
import {
  QUALITY_GLYPH,
  qualityInkClass,
  qualityMeterTone,
} from "../signal-quality-display";
import { CONDENSED, CONSOLE, GLYPH } from "./shapes";
import { SCORE_WEIGHTS, normalizeValue, scoreLive } from "./utils";

// =============================================================================
// The aim console — the anchor instrument
// =============================================================================
// Aiming an antenna is a closed physical loop: the user is outdoors with a phone
// in one hand and hardware in the other, rotating and watching for change over
// minutes. The only figure that serves that loop is the live composite for the
// primary chain, so it is the one thing on this route that never leaves the
// screen — pinned in a sticky column on a wide surface, and condensed into a
// 64px pill readout on a phone once the card itself scrolls away.
//
// It is deliberately an INSTRUMENT, not a headline figure, and what earns a 52px
// numeral here is DECOMPOSABILITY: the score never appears alone. It arrives
// with the two weighted legs that produced it, the weights themselves, its
// session peak, its change since the last measurement, and the modem's own
// timestamp — and when a leg is missing, `partial` says so out loud rather than
// letting a one-leg score pass as a two-leg one. A number you can take apart is
// an instrument; a number you can only admire is decoration.
//
// The composite is the SAME function the recorder ranks by (`scoreLive` wraps
// `scoreSnapshot`), so "what am I reading now" and "what did I record there" are
// the same unit and can be compared directly.
//
// WIDTH: the console is designed for its SLOT — ~400-430px in the sticky left
// column at 1440, and full width on a phone. It is not a full-bleed row. The
// build this replaces was laid out as one, which is how the radio identity tag
// ended up ~1400px from the "Main / PRX" caption it labels, how the two leg bars
// became ~1130px decorative rules, and how the right third of the score block
// became dead band. Everything here is sized to the narrow slot and simply
// stretches; nothing is anchored to an opposite edge that may be a metre away.
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

/**
 * The whole reading, derived once.
 *
 * Both the console and the condensed bar render the same measurement, and they
 * must never disagree about it — a pinned readout that contradicts the card it
 * replaced is worse than no readout. Deriving both from one function is what
 * makes that structural rather than a review discipline.
 */
function useAimReading(spa: SignalPerAntenna, snapshotTs: number | null) {
  const score = scoreLive(spa);
  const { peak, delta } = useSessionTracking(score.value, snapshotTs);

  const radio = score.radio;
  const rsrp = radio ? normalizeValue(spa[`${radio}_rsrp`][0], "rsrp") : null;
  const sinr = radio ? normalizeValue(spa[`${radio}_sinr`][0], "sinr") : null;

  /**
   * The primary chain's verdict: the WORST of the legs that actually reported.
   *
   * This used to read RSRP alone, which left a hole once the meter took its fill
   * from the ramp. `scoreSnapshot` reweights around a missing leg, so a SINR-only
   * snapshot still produces a real composite — but an RSRP-only verdict called
   * that same snapshot `"none"`, and `qualityMeterTone("none")` is `null`, which
   * is the empty-track signal. A live score would have been drawn on an empty
   * track.
   *
   * `worstSignalQuality` skips `"none"` entries, so it returns a level whenever
   * ANY leg reported and `"none"` only when neither did — which is exactly when
   * `score.value` is null too. Tone, track and numeral can therefore never
   * disagree about whether there is a reading. It is also the better verdict on
   * its own terms, and matches `port-strip.tsx`: this chip sits directly above
   * both leg rows, and a summary that contradicts the rows beneath it is worse
   * than no summary.
   */
  const overallQuality = worstSignalQuality(
    getSignalQuality(rsrp, RSRP_THRESHOLDS),
    getSignalQuality(sinr, SINR_THRESHOLDS),
  );

  return {
    score,
    radio,
    rsrp,
    sinr,
    peak,
    delta,
    overallQuality,
    overallTone: qualityMeterTone(overallQuality),
    /** A chip that says "no change" is noise on a surface watched continuously. */
    showDelta: delta !== null && Math.abs(delta) >= 1,
    // 3GPP calls NR's metric SNR, not SINR. Reuse the radio-info labels so the
    // two antenna pages cannot disagree about what a row is called.
    sinrLabelKey: radio === "nr" ? ("snr" as const) : ("sinr" as const),
  };
}

// -----------------------------------------------------------------------------
// One weighted leg
// -----------------------------------------------------------------------------

/**
 * A metric row: key, weight, a 56px inline lane, and the reading.
 *
 * The lane is INLINE and fixed, not a flexed full-width bar. At the console's
 * pinned width a full-width bar was ~1130px of coloured rule for a figure the
 * user reads at its right-hand end — length that encodes nothing extra past the
 * first hundred pixels, and that pushed the key and the value to opposite sides
 * of the card. 56px is enough travel to compare two legs at a glance, which is
 * the only comparison this row is for; the composite meter above is the bar you
 * are meant to watch.
 */
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

  // One decision drives both the fill and the ink, so they cannot disagree about
  // whether there is a reading. `null` covers the sentinel-suppressed case AND
  // the out-of-physical-range case, which `value === null` alone would miss.
  const tone = qualityMeterTone(quality);
  const reading = tone === null ? null : value;

  return (
    <div className={CONSOLE.LEG_ROW}>
      <span className={CONSOLE.LEG_KEY}>
        {label}
        {/* The weight is part of the claim: a user who sees 60% next to RSRP can
            work out why a strong RSRP with a weak SINR still scores well, which
            is the difference between an instrument and an oracle. It is rendered
            at LABEL weight rather than value weight — at value weight a second
            tabular figure in the row reads as a second reading. */}
        <span className={CONSOLE.LEG_WEIGHT}>{Math.round(weight * 100)}%</span>
      </span>

      {/* `ml-auto` is what makes the lane and the value travel together as one
          right-hand group instead of the lane stretching across the row. */}
      <div className={cn(CONSOLE.LEG_LANE, "ml-auto")} aria-hidden="true">
        <MetricBar
          /* A missing leg gets the TRACK ALONE, never a zero-length fill: an
             idle chain drawn as an empty red bar reads as a signal problem the
             user should go and fix (DESIGN.md > Quality bars). */
          value={reading === null ? null : signalToProgress(reading, thresholds)}
          max={100}
          warnAt={101}
          dangerAt={101}
          colorOverride={tone}
          /* 4px — the quality-bar spec. Deliberately lighter than the 8px
             composite meter above, which is this card's subject rather than one
             of its legs. */
          size="sm"
          track="surface-container-high"
          index={index}
        />
      </div>

      <span className={cn(CONSOLE.LEG_VALUE, qualityInkClass(quality))}>
        {reading === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">
              {t("antenna_alignment.aim.not_reported")}
            </span>
          </>
        ) : (
          <>
            {reading} {unit}
            {/* Adjacent ramp stops sit deliberately below the 0.05 separation
                floor — bar length carries the distinction for sighted users — so
                the tint is not a channel a screen-reader or a colour-blind user
                can read. The word is. */}
            <span className="sr-only">
              {" "}
              {t(`antenna_alignment.quality.${quality}`)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The console
// -----------------------------------------------------------------------------

export function AimConsole({
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
  const {
    score,
    radio,
    rsrp,
    sinr,
    peak,
    delta,
    overallQuality,
    overallTone,
    showDelta,
    sinrLabelKey,
  } = useAimReading(spa, snapshotTs);

  return (
    <Card className={CONSOLE.SHELL}>
      {/* The identity tag sits on the TITLE's line, immediately after the words
          it qualifies — "Live Aim · 5G NR" is one phrase. Flung to the far right
          of a wide card it was a floating label with no referent. No icon here:
          icons belong to chips and actions, never to a CardHeader. */}
      <CardHeader className="gap-1 px-0">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className={CONSOLE.TITLE}>
            {t("antenna_alignment.aim.title")}
          </CardTitle>
          {radio && (
            <Tag variant={radio === "nr" ? "nr" : "lte"} className="shrink-0">
              {t(`antenna_alignment.mode.${radio}`)}
            </Tag>
          )}
        </div>
        <CardDescription className={CONSOLE.DESCRIPTION}>
          {t("antenna_alignment.aim.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 px-0">
        {/* --- Score, delta, peak ------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-end gap-4">
            <div className="flex shrink-0 flex-col gap-1">
              <span className={CONSOLE.EYEBROW}>
                {t("antenna_alignment.aim.score_label")}
              </span>
              <div className="flex items-baseline gap-1">
                {/* The one figure the aiming user steers by, so it takes the
                    ramp ink — and it is legal to tint precisely because the
                    composite meter sits directly beneath it. A ramp colour
                    with no bar beside it is a bug, not a shortcut.

                    The quality word rides the `aria-label` rather than an
                    `sr-only` span: an `aria-label` REPLACES an element's
                    contents for assistive tech, so a nested `sr-only` here
                    would never be announced at all. */}
                <span
                  className={cn(
                    CONSOLE.SCORE,
                    CONSOLE.SCORE_BOX,
                    qualityInkClass(overallQuality),
                  )}
                  aria-label={
                    score.value === null
                      ? t("antenna_alignment.aim.no_reading")
                      : `${t("antenna_alignment.aim.score_sr", {
                          score: score.value,
                        })} ${t(`antenna_alignment.quality.${overallQuality}`)}`
                  }
                >
                  {score.value === null ? "—" : score.value}
                </span>

                {/* The delta rides the numeral's own line at a minimal gap,
                    rather than living in a chip a full row away from the
                    figure it is a footnote to. It is NOT a status — signal
                    dropping while you rotate is expected information, not a
                    fault — so it stays a plain glyph-plus-figure pair and its
                    DIRECTION rides the glyph rather than a hue, which is also
                    what makes it survive deuteranopia and grayscale. */}
                {showDelta && (
                  <span
                    className="mb-1.5 flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums text-on-surface-variant"
                    aria-hidden="true"
                  >
                    <MaterialSymbol
                      name={delta! > 0 ? "arrow_upward" : "arrow_downward"}
                      size={GLYPH.CHIP}
                      filled
                    />
                    {delta! > 0 ? `+${delta}` : `${delta}`}
                  </span>
                )}
                {showDelta && (
                  <span className="sr-only">
                    {delta! > 0
                      ? t("antenna_alignment.aim.delta_up")
                      : t("antenna_alignment.aim.delta_down")}
                  </span>
                )}
              </div>
            </div>

            {score.partial && score.value !== null && (
              <div className="flex min-w-0 flex-1 flex-col items-start pb-1">
                <Badge variant="muted">
                  <MaterialSymbol name="warning" size={GLYPH.CHIP} filled />
                  {t("antenna_alignment.aim.partial", {
                    leg: t(
                      `radio_info.bands.metric.${
                        score.legs[0] === "sinr" ? sinrLabelKey : "rsrp"
                      }`,
                    ),
                  })}
                </Badge>
              </div>
            )}
          </div>

          {/* Peak and timestamp caption the METER, and sit immediately above it
              so "Peak 84" is adjacent to the tick that marks it. */}
          {(peak !== null || updatedAt) && (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-1",
                CONSOLE.CAPTION,
              )}
            >
              {peak !== null ? (
                <span>
                  {t("antenna_alignment.aim.peak")}{" "}
                  <span className="font-semibold tabular-nums text-on-surface">
                    {peak}
                  </span>
                </span>
              ) : (
                <span />
              )}
              {updatedAt && (
                <span>
                  {t("antenna_alignment.aim.updated")}{" "}
                  <span className="tabular-nums">{updatedAt}</span>
                </span>
              )}
            </div>
          )}

          {/* --- Composite meter with the session peak mark ----------------- */}
          <div className={CONSOLE.METER_LANE}>
            {/* A null composite is NOT zero percent — it is an EMPTY TRACK.
                MetricBar renders the track alone and omits the fill element
                entirely for `value={null}`, which is the one channel — length —
                the ramp is explicitly not allowed to carry on its own. */}
            <div className="min-w-0 flex-1" aria-hidden="true">
              <MetricBar
                value={score.value}
                max={100}
                warnAt={101}
                dangerAt={101}
                /* Only reachable when `score.value` is null too (see
                   `overallQuality`), where no fill is painted from it. */
                colorOverride={overallTone}
                /* 8px, not the 4px row-level quality bar: this meter is the
                   card's subject, read at arm's length outdoors, and it is the
                   bar the peak mark is registered against. */
                size="md"
                track="surface-container-high"
              />
            </div>
            {/* The peak mark is positioned with `left`, and it is deliberately
                NOT transitioned. DESIGN.md's Transform-Only Rule keeps layout
                properties out of animations, and an instant jump is also the
                honest gesture: a new session high is a discrete event, and
                having the mark snap is what makes it legible as "that is the
                best you have managed" rather than as a second bar creeping
                along. */}
            {peak !== null && score.value !== null && peak > score.value && (
              <span
                aria-hidden="true"
                className={CONSOLE.PEAK_TICK}
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

        {/* Which chain the whole card is about. It WRAPS — this line truncated
            to "Main / PRX is the chain the score is …" in the outgoing build,
            which cut the sentence exactly where its meaning starts. */}
        <p className={cn(CONSOLE.CAPTION, "text-pretty leading-relaxed")}>
          {t("antenna_alignment.aim.primary_chain")}
        </p>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// The condensed readout
// -----------------------------------------------------------------------------

/**
 * The 64px pill that pins at the top of a phone once the console scrolls away.
 *
 * It exists so the user never loses the number, NOT to restate the card: key,
 * score, verdict glyph, direction, meter. Nothing that needs reading twice. The
 * peak, the legs, the weights and the timestamp all stay in the console — a
 * pinned bar that reproduced them would be a second instrument disagreeing with
 * the first one poll later.
 *
 * The KEY LABEL is not decoration and not a restatement. Without it this pill
 * was anatomically a position row — same height, same pill, same numeral-plus-
 * meter — pinned directly above three position rows, so a floating instrument
 * read as a slot that had come loose. `CONDENSED.BAR`'s tonal step says "above";
 * the label says which instrument. It reuses the console's own `score_label`, so
 * the pinned bar and the card name the figure identically.
 *
 * The parent owns the sticky zero-height slot (`CONDENSED.ROOT`) and the
 * IntersectionObserver behind `shown`; this component owns the shade, the bar
 * and their shared crossfade.
 *
 * Opacity ONLY. No height animation (off the transform-and-opacity scale), no
 * spring (the Settled-Motion Rule), no blur or backdrop-filter (an alpha over a
 * scrolling page collapses in dark mode, and the tonal container step already
 * says "this floats above that").
 *
 * When hidden it is `pointer-events-none` and `aria-hidden`, so it is neither a
 * phantom tab stop nor a second screen-reader announcement of the score the user
 * is already on.
 */
export function CondensedAim({
  spa,
  snapshotTs,
  shown,
}: {
  spa: SignalPerAntenna;
  /** The modem's own timestamp for this snapshot, in seconds. */
  snapshotTs: number | null;
  /** True once the full console has scrolled out from under this bar. */
  shown: boolean;
}) {
  const { t } = useTranslation("cellular");
  const { score, delta, overallQuality, overallTone, showDelta } = useAimReading(
    spa,
    snapshotTs,
  );

  const ink = qualityInkClass(overallQuality);

  return (
    // The shade is the opaque ground under the pill and across the gutter, and
    // it carries the crossfade so ground and bar arrive as one object. Without
    // it the page scrolls through the transparent band above the pill, which
    // reads as a stacking bug rather than as a pinned element.
    <div
      className={cn(CONDENSED.SHADE, shown ? CONDENSED.SHOWN : CONDENSED.HIDDEN)}
      aria-hidden={!shown}
    >
      <div className={CONDENSED.BAR}>
        {/* Which instrument is floating. `shrink-0`, so at 390px the lane gives
            up width before the label does — a pinned readout whose label wrapped
            would be taller than the pill it lives in. */}
        <span className={CONDENSED.KEY}>
          {t("antenna_alignment.aim.score_label")}
        </span>

        <span
          className={cn(CONDENSED.SCORE, ink)}
          aria-label={
            score.value === null
              ? t("antenna_alignment.aim.no_reading")
              : `${t("antenna_alignment.aim.score_sr", {
                  score: score.value,
                })} ${t(`antenna_alignment.quality.${overallQuality}`)}`
          }
        >
          {score.value === null ? "—" : score.value}
        </span>

        {/* The glyph, not a chip: the ladder is the non-chromatic channel, and
            at this size a full verdict chip would crowd out the meter that gives
            the ramp ink its legal bar. */}
        <MaterialSymbol
          name={QUALITY_GLYPH[overallQuality]}
          size={GLYPH.INLINE}
          filled
          className={cn("shrink-0", ink)}
          aria-hidden="true"
        />

        {showDelta && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums text-on-surface-variant">
            <MaterialSymbol
              name={delta! > 0 ? "arrow_upward" : "arrow_downward"}
              size={GLYPH.CHIP}
              filled
              aria-hidden="true"
            />
            {delta! > 0 ? `+${delta}` : `${delta}`}
            <span className="sr-only">
              {delta! > 0
                ? t("antenna_alignment.aim.delta_up")
                : t("antenna_alignment.aim.delta_down")}
            </span>
          </span>
        )}

        <div className={CONDENSED.LANE} aria-hidden="true">
          <MetricBar
            value={score.value}
            max={100}
            warnAt={101}
            dangerAt={101}
            colorOverride={overallTone}
            size="sm"
            /* `muted`, not `surface-container-high`: the bar itself is now that
               step, and a track the same tone as its ground is an invisible
               track — the empty-track signal for a missing reading would have
               been silently lost with it. */
            track="muted"
          />
        </div>
      </div>
    </div>
  );
}

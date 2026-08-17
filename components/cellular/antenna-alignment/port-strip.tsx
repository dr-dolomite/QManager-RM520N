"use client";

import Link from "next/link";
import { motion } from "motion/react";
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
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import {
  ANTENNA_PORTS,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  isPortReporting,
  normalizeSignalValue,
  signalToProgress,
  worstSignalQuality,
} from "@/types/modem-status";
import type { SignalPerAntenna, SignalQuality } from "@/types/modem-status";

import {
  QUALITY_GLYPH,
  qualityBadgeVariant,
  qualityInkClass,
  qualityMeterTone,
} from "../signal-quality-display";
import {
  CARD_CONTENT,
  CARD_DESCRIPTION,
  CARD_HEADER,
  CARD_SHELL,
  CARD_TITLE,
  GLYPH,
  PORT,
} from "./shapes";
import { countReportingPorts } from "./utils";
import type { RadioMode } from "./utils";

// =============================================================================
// Receive Chains — the diagnostic footnote
// =============================================================================
// This is the page's diagnostic footnote, not its subject. The question it
// answers is narrow and worth keeping: "am I aiming with all the chains I think
// I have?" An idle MIMO chain means the composite above is being produced by
// fewer antennas than the hardware has, which changes what a good score means.
// That is one verdict per port plus the RSRP that drives the score — not a full
// per-metric read. The full per-metric read is what the TWIN page is for, and
// the cross-link at the bottom exists because the two pages genuinely hand off
// to each other.
//
// WHAT CHANGED, and why it was a defect rather than a taste call:
//
//   * It ran ONE COLUMN at phone width. Measured on the first screenshots ever
//     taken of this page: 743px tall, starting at y=1586 on a 390px phone. The
//     densest card on the page (~38 elements) — a footnote outweighing the live
//     instrument, at a scroll position reached last if ever. It is now 2-up on a
//     phone and 4-up on a wide surface (`PORT.GRID`), roughly 476px at 390px.
//
//   * The port name and its RX pill shared a line. At 2-up on a 390px phone a
//     block is ~155px wide and "Diversity" + "DRX" does not fit, so the name now
//     takes its own line above the RX pill and the verdict chip.
//
//   * `opacity-60` / `opacity-50` faded an idle chain's text, borders AND value
//     colour together, so its verdict chip lost contrast — the finding got
//     quieter exactly as it got more important. An idle chain is a finding, not
//     a whisper: it gets a stated `muted` chip with `do_not_disturb_on` at FULL
//     contrast. Blocks are never filtered, collapsed or hidden either: live
//     capture showed LTE chains dropping out 3, 7 and 10 times in a 35-minute
//     window, and WHICH port drops wanders between reads, so a disappearing
//     block would rewrite the grid under the user's hands.
//
// All geometry comes from `./shapes`. This file owns no numbers and no shells.
// =============================================================================

/**
 * One radio's RSRP for this port: a baseline key/value head with the quality bar
 * on its own full-width band beneath (`PORT.METRIC` / `METRIC_HEAD` / `LANE`).
 *
 * The bar is not decoration and it is not optional. The ramp is a LIGHTNESS
 * STAIRCASE rather than a hue wheel — under deuteranopia its hues collapse onto
 * one yellow axis, so adjacent stops sit deliberately below the separation floor
 * and BAR LENGTH is what carries the adjacent distinction. Ramp ink on a numeral
 * with no bar beside it is a bug, not a shortcut.
 *
 * Which is exactly why the bar is STACKED rather than inline. An inline
 * key-bar-value row makes the lane the only flexible track, so the lane is
 * always the first thing to collapse — and it did, to zero, in the whole band
 * between `@4xl` and `@6xl` where this card sits in a 7-of-12 column. Stacked,
 * the bar is `w-full` at every width, and all four ports' bars start and end at
 * the same x, so their lengths are directly comparable rather than merely
 * present.
 */
function PortMetric({
  radio,
  value,
  quality,
  index,
}: {
  radio: "lte" | "nr";
  value: number | null;
  quality: SignalQuality;
  /** Position among this port's metrics, for the meter arrival cascade. */
  index: number;
}) {
  const { t } = useTranslation("cellular");

  // One decision behind both channels, so the bar and the ink can never
  // disagree about whether there is a reading. `null` also covers an in-range
  // sentinel escapee that `value === null` alone would miss.
  const tone = qualityMeterTone(quality);
  const reading = tone === null ? null : value;

  return (
    <div className={PORT.METRIC}>
      <div className={PORT.METRIC_HEAD}>
        <span className={PORT.KEY}>{t(`antenna_alignment.mode.${radio}_short`)}</span>

        {reading === null ? (
          /* The absence is STATED, not punctuated. An em dash here was a
             sighted-only mark with the real words hidden in `sr-only`, and in a
             four-across strip it is the one row a scanning eye skips — which is
             the whole reason this metric is drawn at all rather than omitted.
             `shrink truncate` is a safety valve for locales whose phrase runs
             longer than the ~92px the value slot has at 2-up on a phone; it does
             not fire in English. */
          <span
            className={cn(PORT.VALUE, qualityInkClass(quality), "min-w-0 shrink truncate")}
          >
            {t("antenna_alignment.aim.not_reported")}
          </span>
        ) : (
          <span className={cn(PORT.VALUE, qualityInkClass(quality))}>
            {reading} dBm
            <span className="sr-only"> {t(`antenna_alignment.quality.${quality}`)}</span>
          </span>
        )}
      </div>

      {/* aria-hidden: the meter restates the number and the quality word above
          it, both of which are real text. Exposing it as a progressbar would
          announce the same fact twice, once as an unlabelled percentage. */}
      <div className={PORT.LANE} aria-hidden="true">
        <MetricBar
          /* No reading renders the track ALONE, never a zero-length fill: an
             idle chain drawn as an empty red bar reads as a signal problem the
             user should go and fix (DESIGN.md > Quality bars). */
          value={reading === null ? null : signalToProgress(reading, RSRP_THRESHOLDS)}
          max={100}
          /* Unreachable on purpose — `colorOverride` pins the ramp stop, so the
             built-in warn/danger steps never apply. */
          warnAt={101}
          dangerAt={101}
          colorOverride={tone}
          size="sm"
          /* The block is already `surface-container`, so the track takes the
             step above it or it vanishes into its own background. */
          track="surface-container-high"
          index={index}
        />
      </div>
    </div>
  );
}

function PortBlock({
  index,
  spa,
  mode,
}: {
  index: number;
  spa: SignalPerAntenna;
  mode: RadioMode;
}) {
  const { t } = useTranslation("cellular");
  const port = ANTENNA_PORTS[index];

  const lteReporting = isPortReporting(spa, index, "lte");
  const nrReporting = isPortReporting(spa, index, "nr");
  const reporting = lteReporting || nrReporting;

  /**
   * Which metrics this block draws — decided by the SURFACE's mode alone, never
   * by whether this particular port has a reading for it.
   *
   * This gating used to be `&& lteReporting` / `&& nrReporting`, and that was a
   * correctness bug rather than a tidy optimisation. MIMO 4 reports NR only, so
   * its LTE metric was omitted and its NR value slid up into the slot the other
   * three blocks were using for LTE. In the 4-up strip that put `-118 dBm` of 5G
   * on the same baseline as `-88 / -92 / -95 dBm` of 4G, with nothing in the row
   * saying so — a scanning eye reads four numbers of one kind. A four-across
   * comparison only means anything if every column answers the same question.
   *
   * The fix is DESIGN.md's own rule lifted one level up: a missing reading is an
   * EMPTY TRACK, never an omission. Below, an absent value flows through
   * `getSignalQuality(null) -> "none" -> qualityMeterTone() -> null`, which is
   * the empty-track contract — `MetricBar value={null}` with no fill and no
   * colour. Do not add a branch here and do not `??` a fallback tone in; that is
   * the exact bug that once painted an unread antenna green.
   *
   * `lte`/`nr` mode draws one metric per block, `endc` draws two. Either way
   * every block in the row draws the SAME set, which is the property that makes
   * the baselines line up.
   *
   * `mode` is the ONLY consumer of `detectRadioMode` in the whole route. It must
   * never re-enter scoring — it falls back to `"lte"` with no data at all, which
   * is why it can never be the "nothing is reporting" signal.
   * `countReportingPorts(spa) === 0` is that signal, and the root owns it.
   */
  const showLte = mode === "lte" || mode === "endc";
  const showNr = mode === "nr" || mode === "endc";

  /**
   * The verdict is the WORST metric across every radio this port actually
   * reports on — not just the preferred one.
   *
   * `worstSignalQuality` exists so a strong RSRP cannot mask a poor SINR, and
   * the same reasoning extends across legs: on an EN-DC port a healthy NR chain
   * must not mask a degraded LTE anchor, because this chip sits directly above
   * rows showing both readings. A summary that contradicts the rows beneath it
   * is worse than no summary.
   *
   * This deliberately DIFFERS from `scoreSnapshot`, which PREFERS NR. Different
   * job: a composite score has to commit to one scale to stay comparable across
   * positions; a health verdict should report the worst thing it can see. Do not
   * align the two. `worstSignalQuality` skips `"none"`, so a metric a reporting
   * radio happens to omit does not drag the verdict down.
   *
   * Every `normalizeSignalValue` call below passes its REAL metric. SINR
   * additionally suppresses −20; letting a SINR value fall through an `"rsrp"`
   * default silently makes an idle NR chain report as Active.
   */
  const reportingRadios: ("lte" | "nr")[] = [
    ...(lteReporting ? (["lte"] as const) : []),
    ...(nrReporting ? (["nr"] as const) : []),
  ];
  const verdict: SignalQuality = reporting
    ? worstSignalQuality(
        ...reportingRadios.flatMap((leg) => [
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_rsrp`][index], "rsrp"),
            RSRP_THRESHOLDS,
          ),
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_rsrq`][index], "rsrq"),
            RSRQ_THRESHOLDS,
          ),
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_sinr`][index], "sinr"),
            SINR_THRESHOLDS,
          ),
        ]),
      )
    : "none";

  return (
    <motion.div variants={staggerRowItem} className={PORT.ROOT}>
      {/* The name takes its own line: at 2-up on a 390px phone the block is
          ~155px wide, and "Diversity" plus its RX pill will not share one. */}
      <span className={PORT.NAME}>{port.name}</span>

      {/* Never `flex-wrap`. `PORT.HEIGHT` is a PIN, not a floor, and the pin's
          budget (132px inside the 14px padding) spends 20px on the name, 26px on
          this line and 60px on two stacked metrics. A wrapped chip would add
          28px and push the last metric out of a box that cannot grow. The chip
          truncates its label instead — which is safe here and nowhere else,
          because the glyph is the channel that actually carries the state. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={PORT.RX}>{port.rx}</span>

        {/* An idle chain gets a STATED verdict at full contrast — never an
            opacity wash. `do_not_disturb_on` is its own glyph, because two
            states in one slot may not share one: the tonal containers measure
            ~1.03:1 apart and the glyph is the only channel that survives
            grayscale and deuteranopia. */}
        <Badge
          variant={reporting ? qualityBadgeVariant(verdict) : "muted"}
          className="min-w-0"
        >
          <MaterialSymbol
            name={reporting ? QUALITY_GLYPH[verdict] : "do_not_disturb_on"}
            size={GLYPH.CHIP}
            filled
          />
          <span className="min-w-0 truncate">
            {reporting
              ? t(`antenna_alignment.quality.${verdict}`)
              : t("antenna_alignment.ports.not_reporting")}
          </span>
        </Badge>
      </div>

      {/* No `reporting` branch around this. A silent chain draws the same
          metrics as a live one, reading "Not reported" over an empty track —
          which is both the empty-track contract and the thing that keeps all
          four blocks on one grid. The old branch swapped in a one-line hint,
          which broke the alignment AND said a third time what the `muted` chip
          and the rows already say. */}
      <div className="flex flex-col gap-1.5">
        {showLte && (
          <PortMetric
            radio="lte"
            value={normalizeSignalValue(spa.lte_rsrp[index], "rsrp")}
            quality={getSignalQuality(
              normalizeSignalValue(spa.lte_rsrp[index], "rsrp"),
              RSRP_THRESHOLDS,
            )}
            index={0}
          />
        )}
        {showNr && (
          <PortMetric
            radio="nr"
            value={normalizeSignalValue(spa.nr_rsrp[index], "rsrp")}
            quality={getSignalQuality(
              normalizeSignalValue(spa.nr_rsrp[index], "rsrp"),
              RSRP_THRESHOLDS,
            )}
            /* The metric's position within the block, not the port index: the
               port index is already spent by `staggerRows` on the block itself,
               and re-spending it here would double the delay. */
            index={showLte ? 1 : 0}
          />
        )}
      </div>
    </motion.div>
  );
}

export function PortStripCard({
  spa,
  mode,
}: {
  spa: SignalPerAntenna;
  mode: RadioMode;
}) {
  const { t } = useTranslation("cellular");
  const live = countReportingPorts(spa);
  const allLive = live === ANTENNA_PORTS.length;

  return (
    <Card className={CARD_SHELL}>
      {/* No icon in a CardHeader. The count chip is the header's only glyph
          carrier, and it sits beside the title rather than inside it. */}
      <CardHeader className={CARD_HEADER}>
        <div className="flex items-start gap-3">
          <CardTitle className={cn(CARD_TITLE, "flex-1")}>
            {t("antenna_alignment.ports.title")}
          </CardTitle>
          <Badge variant={allLive ? "success" : "warning"} className="shrink-0">
            <MaterialSymbol
              name={allLive ? "check_circle" : "warning"}
              size={GLYPH.CHIP}
              filled
            />
            {t("antenna_alignment.ports.reporting", {
              live,
              total: ANTENNA_PORTS.length,
            })}
          </Badge>
        </div>
        {/* Full width, under both: at 390px the description shares the title's
            column only if it is allowed to wrap three times. */}
        <CardDescription className={CARD_DESCRIPTION}>
          {t("antenna_alignment.ports.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className={CARD_CONTENT}>
        <motion.div className={PORT.GRID} variants={staggerRows}>
          {ANTENNA_PORTS.map((_port, index) => (
            <PortBlock key={index} index={index} spa={spa} mode={mode} />
          ))}
        </motion.div>

        <p className="text-xs text-on-surface-variant">
          {t("antenna_alignment.ports.twin_hint")}{" "}
          <Link
            href="/cellular/antenna-statistics"
            className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("antenna_alignment.ports.twin_link")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default PortStripCard;

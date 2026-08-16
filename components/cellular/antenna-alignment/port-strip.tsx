"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { SignalPerAntenna } from "@/types/modem-status";

import {
  QUALITY_GLYPH,
  qualityBadgeVariant,
  qualityInkClass,
  qualityMeterTone,
} from "../signal-quality-display";
import { countReportingPorts } from "./utils";
import type { RadioMode } from "./utils";

// =============================================================================
// Receive Chains — the demoted per-port section
// =============================================================================
// This is the page's diagnostic footnote, not its subject. It used to be four
// full cards carrying 24 metric rows, which outweighed the live readout the
// aiming user actually steers by.
//
// The question it answers here is narrow and worth keeping: "am I aiming with
// all the chains I think I have?" An idle MIMO chain means the composite above is
// being produced by fewer antennas than the hardware has, which changes what a
// good score means. That is one verdict per port, plus the RSRP that drives the
// score — not a full per-metric read.
//
// The full per-metric read is what the TWIN page is for. `/cellular/antenna-
// statistics` is this page's transpose: technology-major (two cards, each holding
// four ports) where this is port-major, answering "which chain is broken" where
// this answers "which way do I point it". The cross-link at the bottom is there
// because the two pages genuinely hand off to each other, and a user hunting a
// dead chain should not have to rediscover that from the sidebar.
//
// The `opacity-60` / `opacity-50` washes this replaces faded text, borders and
// value colour together, so an idle chain's own verdict chip lost contrast — the
// finding got quieter exactly as it got more important. An idle chain is a
// finding, not a whisper: it now gets a stated `muted` verdict chip with its own
// glyph, at full contrast.
// =============================================================================

export const PORT_GRID =
  "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @4xl/main:grid-cols-4";

export const PORT_SHAPE = {
  ROOT: "flex flex-col gap-2.5 rounded-tile bg-surface-container px-4 py-3.5",
  HEAD: "flex items-center gap-2",
  NAME: "min-w-0 truncate text-sm font-semibold",
  RX: "inline-flex shrink-0 items-center rounded-pill bg-surface-container-high px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] text-on-surface-variant",
  /**
   * `items-center`, not `items-baseline`: the row now carries a quality bar
   * between the key and the value, and a 4px bar has no baseline to sit on. The
   * 20px `text-[13px]/5` value box still governs the row height, so the block's
   * pinned floor below is unchanged by the bar's arrival.
   */
  ROW: "flex items-center gap-2",
  KEY: "w-8 shrink-0 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant",
  VALUE: "w-[4.75rem] shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
} as const;

/** Floor height for a port block, mirrored by the skeleton. Sum of line boxes. */
export const PORT_BLOCK_MIN_HEIGHT = 108;

/**
 * One radio's RSRP for this port: key, quality bar, ramp-inked value.
 *
 * The bar is not decoration and it is not optional. The ramp is a LIGHTNESS
 * STAIRCASE rather than a hue wheel — under deuteranopia its hues collapse onto
 * one yellow axis, so adjacent stops sit deliberately below the 0.05 separation
 * floor and BAR LENGTH is what carries the adjacent distinction. A ramp colour
 * with no bar beside it is a bug, not a shortcut, which is what this row was
 * before: a tinted dBm figure with nothing non-chromatic next to it. The row
 * height is unchanged — a 4px bar fits inside the value's 20px line box.
 */
function PortRsrpRow({
  radio,
  value,
  quality,
  index,
}: {
  radio: "lte" | "nr";
  value: number | null;
  quality: ReturnType<typeof getSignalQuality>;
  /** Position among this port's rows, for the meter arrival cascade. */
  index: number;
}) {
  const { t } = useTranslation("cellular");

  // One decision behind both channels, so the bar and the ink can never
  // disagree about whether there is a reading. `null` also covers an in-range
  // sentinel escapee that `value === null` alone would miss.
  const tone = qualityMeterTone(quality);
  const reading = tone === null ? null : value;

  return (
    <div className={PORT_SHAPE.ROW}>
      <span className={PORT_SHAPE.KEY}>{t(`antenna_alignment.mode.${radio}_short`)}</span>

      {/* aria-hidden: the meter restates the number and the quality word to its
          right, both of which are real text. Exposing it as a progressbar would
          announce the same fact twice, once as an unlabelled percentage. */}
      <div className="min-w-0 flex-1" aria-hidden="true">
        <MetricBar
          /* No reading renders the track ALONE, never a zero-length fill: an
             idle chain drawn as an empty red bar reads as a signal problem the
             user should go and fix (DESIGN.md > Quality bars). `?? undefined`
             is only reachable in that same branch, where no fill is painted. */
          value={reading === null ? null : signalToProgress(reading, RSRP_THRESHOLDS)}
          max={100}
          /* Unreachable on purpose — `colorOverride` pins the ramp stop, so the
             built-in warn/danger steps never apply. */
          warnAt={101}
          dangerAt={101}
          colorOverride={tone}
          size="sm"
          /* The tile is already `surface-container`, so the track takes the step
             above it or it vanishes into its own background. */
          track="surface-container-high"
          index={index}
        />
      </div>

      <span className={cn(PORT_SHAPE.VALUE, qualityInkClass(quality))}>
        {reading === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">
              {t("antenna_alignment.aim.not_reported")}
            </span>
          </>
        ) : (
          <>
            {reading} dBm
            <span className="sr-only"> {t(`antenna_alignment.quality.${quality}`)}</span>
          </>
        )}
      </span>
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

  const showLte = (mode === "lte" || mode === "endc") && lteReporting;
  const showNr = (mode === "nr" || mode === "endc") && nrReporting;

  /**
   * The verdict is the WORST metric across every radio this port actually
   * reports on — not just the preferred one.
   *
   * `worstSignalQuality` exists so a strong RSRP cannot mask a poor SINR, and
   * the same reasoning extends across legs: on an EN-DC port, a healthy NR chain
   * must not mask a degraded LTE anchor, because this chip sits directly above
   * rows showing both readings. A summary that contradicts the rows beneath it is
   * worse than no summary.
   *
   * Note this deliberately differs from `scoreSnapshot`, which PREFERS NR. That
   * is a different job: a composite score has to commit to one scale to stay
   * comparable across positions, whereas a health verdict should report the worst
   * thing it can see. `worstSignalQuality` skips `"none"` entries, so a metric a
   * reporting radio happens to omit does not drag the verdict down.
   */
  const reportingRadios: ("lte" | "nr")[] = [
    ...(lteReporting ? (["lte"] as const) : []),
    ...(nrReporting ? (["nr"] as const) : []),
  ];
  const verdict = reporting
    ? worstSignalQuality(
        ...reportingRadios.flatMap((leg) => [
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_rsrp`][index], "rsrp"),
            RSRP_THRESHOLDS
          ),
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_rsrq`][index], "rsrq"),
            RSRQ_THRESHOLDS
          ),
          getSignalQuality(
            normalizeSignalValue(spa[`${leg}_sinr`][index], "sinr"),
            SINR_THRESHOLDS
          ),
        ])
      )
    : "none";

  return (
    <motion.div
      variants={staggerRowItem}
      style={{ minHeight: PORT_BLOCK_MIN_HEIGHT }}
      className={PORT_SHAPE.ROOT}
    >
      <div className={PORT_SHAPE.HEAD}>
        <span className={PORT_SHAPE.NAME}>{port.name}</span>
        <span className={PORT_SHAPE.RX}>{port.rx}</span>
      </div>

      <Badge
        variant={reporting ? qualityBadgeVariant(verdict) : "muted"}
        className="w-fit"
      >
        <MaterialSymbol
          name={reporting ? QUALITY_GLYPH[verdict] : "do_not_disturb_on"}
          size={12}
          filled
        />
        {reporting
          ? t(`antenna_alignment.quality.${verdict}`)
          : t("antenna_alignment.ports.not_reporting")}
      </Badge>

      {reporting ? (
        <div className="flex flex-col gap-1">
          {showLte && (
            <PortRsrpRow
              radio="lte"
              value={normalizeSignalValue(spa.lte_rsrp[index], "rsrp")}
              quality={getSignalQuality(
                normalizeSignalValue(spa.lte_rsrp[index], "rsrp"),
                RSRP_THRESHOLDS
              )}
              index={0}
            />
          )}
          {showNr && (
            <PortRsrpRow
              radio="nr"
              value={normalizeSignalValue(spa.nr_rsrp[index], "rsrp")}
              quality={getSignalQuality(
                normalizeSignalValue(spa.nr_rsrp[index], "rsrp"),
                RSRP_THRESHOLDS
              )}
              /* The row's position within the port block, not the port index:
                 the port index is already spent by `staggerRows` on the tile
                 itself, and re-spending it here would double the delay. */
              index={showLte ? 1 : 0}
            />
          )}
        </div>
      ) : (
        <span className="text-xs text-on-surface-variant">
          {t("antenna_alignment.ports.idle_hint")}
        </span>
      )}
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

  return (
    <Card className="h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]">
      <CardHeader className="gap-1 px-0">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="min-w-0 truncate text-xl font-semibold">
              {t("antenna_alignment.ports.title")}
            </CardTitle>
            <CardDescription className="min-w-0 text-[13px]">
              {t("antenna_alignment.ports.description")}
            </CardDescription>
          </div>
          <Badge
            variant={live === ANTENNA_PORTS.length ? "success" : "warning"}
            className="shrink-0"
          >
            <MaterialSymbol
              name={live === ANTENNA_PORTS.length ? "check_circle" : "warning"}
              size={12}
              filled
            />
            {t("antenna_alignment.ports.reporting", {
              live,
              total: ANTENNA_PORTS.length,
            })}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3.5 px-0">
        <motion.div className={PORT_GRID} variants={staggerRows}>
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

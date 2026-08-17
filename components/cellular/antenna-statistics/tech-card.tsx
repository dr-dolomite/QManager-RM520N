"use client";

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
import { Tag } from "@/components/ui/tag";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { SwapLabel } from "@/components/ui/swap-label";
import TickGroup from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import {
  QUALITY_GLYPH,
  qualityBadgeVariant,
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  ANTENNA_PORTS,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  hasAntennaData,
  isPortReporting,
  normalizeSignalValue,
  signalToProgress,
  worstSignalQuality,
  type SignalMetric,
  type SignalPerAntenna,
  type SignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";

// =============================================================================
// Shared geometry
//
// `states.tsx` imports these so the skeleton is a pure crossfade into the real
// card with no layout jump (DESIGN.md > The Skeleton-Mirror Rule). The port
// block's height is exported as a NUMBER rather than a class because it is the
// sum of four independent line boxes; deriving it once here and spending it as
// an inline style at both ends is what keeps the mirror real rather than an
// estimate. Same idiom as `active-bands-card.tsx`'s `BAND_ROW_HEIGHT`.
// =============================================================================

/**
 * `rounded-card` + 24px padding, not `rounded-hero` + 28px.
 *
 * The Radius-Follows-Size Rule reads the ROLE, not the route: 36px is "a
 * standard card in a grid of peers" and 40px is "the one card that anchors a
 * surface". These two are peers in a `grid-cols-2` — neither anchors anything,
 * and there is no third card for them to out-rank. The hero step was inherited
 * from `radio/active-bands-card.tsx`, which earns it honestly: that page is a
 * single-column stack of full-width anchor cards. Copying its shell across a
 * route boundary copied a size claim that does not hold here.
 */
export const CARD_SHELL =
  "h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]";

/** The two-up card grid, shared with the skeleton so they cannot diverge. */
export const CARD_GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";

/**
 * The card header's line boxes, for the skeleton.
 *
 * `CardTitle` ships `leading-none`, so `text-xl` is a 20px box, not the 24px a
 * naive `h-6` would guess; the description at 13px resolves to 20px; and the
 * identity chip measures 26px (1px border + py-1 + a 16px 12px-text line box +
 * py-1 + 1px). Restating these as round Tailwind steps is how a skeleton ends
 * up 4px taller than the card it is standing in for.
 */
export const HEADER_SHAPE = {
  TITLE: "h-5 w-40",
  DESCRIPTION: "h-5 w-52",
  GAP: "gap-1",
  CHIP: "h-[1.625rem] w-16",
} as const;

/**
 * One port block's pinned height in px.
 *
 * py-3.5 (28) + head row (22) + gap-3 (12) + three 20px metric rows with two
 * 8px gaps (76) = 138 natural. The head row is governed by the verdict Badge —
 * 1px border + py-0.5 + a 16px line box + py-0.5 + 1px — not by the 20px port
 * name beside it. Each metric row is governed by the value's `text-[13px]/5`
 * 20px box, not by the 16px key.
 *
 * Pinned at 140 as a `minHeight` floor, 2px above natural, so a block whose
 * verdict chip wraps still matches its neighbours and so the skeleton is a
 * genuine mirror rather than an estimate.
 */
export const PORT_BLOCK_HEIGHT = 140;

export const PORT_SHAPE = {
  STACK: "flex flex-col gap-2.5",
  ROOT: "flex flex-col gap-3 rounded-tile bg-surface-container px-4 py-3.5",
  HEAD: "flex items-center gap-2.5",
  METRICS: "flex flex-col gap-2",
  ROW: "flex items-center gap-3",
  /**
   * The uppercase RX designator beside the port name — modelled on
   * `active-bands-card.tsx`'s `ROLE_CHIP`. 12px, not 11px: the 11px step is
   * surface-scoped to the sidebar and the pre-auth eyebrow, and a chip label is
   * the Label step.
   */
  RX_CHIP:
    "inline-flex shrink-0 items-center rounded-pill bg-surface-container-high px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] text-on-surface-variant",
  /** Metric-row key. 12px, matching the shipped band-row key. */
  KEY: "w-10 shrink-0 text-xs font-semibold uppercase tracking-[0.09em] text-on-surface-variant",
  VALUE:
    "w-[5.25rem] shrink-0 text-right text-[13px]/5 font-semibold tabular-nums",
} as const;

// =============================================================================
// Tone maps
// =============================================================================
//
// There are none here any more. This file used to carry value-identical private
// copies of `QUALITY_GLYPH`, `verdictVariant` and `meterTone`; they now come
// from `components/cellular/signal-quality-display.ts`, which is the canonical
// home for all three. Quality → glyph / chip role / meter tone / numeral ink are
// SYSTEM decisions DESIGN.md legislates by name, and two per-antenna surfaces
// disagreeing about what "fair" looks like is exactly what the shared module
// exists to make impossible. Do not re-introduce a local map here.

// =============================================================================
// Metric row
// =============================================================================

function MetricRow({
  metric,
  prefix,
  unit,
  raw,
  thresholds,
  rowIndex,
}: {
  metric: SignalMetric;
  prefix: "lte" | "nr";
  unit: string;
  raw: number | null | undefined;
  thresholds: SignalThresholds;
  /** Position among the three metric rows — NOT the port index. */
  rowIndex: number;
}) {
  const { t } = useTranslation("cellular");
  const value = normalizeSignalValue(raw, metric);
  const quality = getSignalQuality(value, thresholds);

  // The meter tone and the numeral are driven off ONE decision, so they can
  // never disagree about whether there is a reading. `qualityMeterTone` returns
  // `null` for `"none"` — the sentinel-suppressed case AND the out-of-physical-
  // range case, which `value === null` alone would miss — and that null is what
  // selects the empty track below rather than a colour.
  const tone = qualityMeterTone(quality);
  const reading = tone === null ? null : value;

  // 3GPP calls the same measurement SNR on the NR side and SINR on the LTE
  // side, so the NR card must not label it SINR. Reuses the Radio Information
  // keys rather than minting new ones, so the two pages cannot disagree about
  // what a measurement is called.
  const labelKey = metric === "sinr" && prefix === "nr" ? "snr" : metric;

  return (
    <div className={PORT_SHAPE.ROW}>
      <dt className={PORT_SHAPE.KEY}>
        {t(`radio_info.bands.metric.${labelKey}`)}
      </dt>

      {/* Everything the key describes lives INSIDE the `dd`: `dl > div` must
          contain its `dt`s followed by its `dd`s and nothing between them, and
          a `dd` holding only an aria-hidden dash would announce the key with an
          empty value while "Not reported" arrived as loose text outside the
          pair. */}
      <dd className="m-0 flex flex-1 items-center gap-3">
        {/* aria-hidden: the meter is a redundant view of the number and quality
            word immediately to its right, both of which are real text. Exposing
            it as a progressbar would make a screen reader announce the same fact
            twice, once as an unlabelled percentage. */}
        <div className="flex-1" aria-hidden="true">
          <MetricBar
            /* A missing reading renders the TRACK ALONE — no fill element at
               all — never a zero-length one. A zero-width fill reads as "signal
               is zero", a different and more alarming claim than "the radio did
               not report this", and on this page the usual cause is an idle
               receive chain rather than a weak one (DESIGN.md > Quality bars). */
            value={reading === null ? null : signalToProgress(reading, thresholds)}
            max={100}
            /* Unreachable on purpose: `colorOverride` pins the tone from the
               quality bucket, so the built-in warn/danger steps never apply. */
            warnAt={101}
            dangerAt={101}
            /* `qualityMeterTone()`'s `null` passes straight through — there is
               deliberately no `??` fallback here. A null tone means no reading,
               `value` is null in the same breath, and MetricBar renders no fill
               element at all in that branch. */
            colorOverride={tone}
            /* 4px, the quality-bar spec. Length is the primary encoding here;
               the ramp hue is reinforcement, which is what makes adjacent stops
               safe below the colour separation floor. */
            size="sm"
            /* The row sits ON `surface-container`, so the track has to be the
               step above it or it disappears into the tile. */
            track="surface-container-high"
            /* The row's position, so the three meters in a block cascade
               against each other. Passing the PORT index here would spend the
               60ms card step on an in-card element and fire all three bars
               simultaneously. */
            index={rowIndex}
          />
        </div>

        <span className={cn(PORT_SHAPE.VALUE, qualityInkClass(quality))}>
          {reading === null ? (
            <>
              <span aria-hidden="true">—</span>
              {/* The dash is decoration; the finding is a word. */}
              <span className="sr-only">
                {t("antenna_statistics.port.not_reported")}
              </span>
            </>
          ) : (
            <>
              <TickingValue value={reading}>
                {reading} {unit}
              </TickingValue>
              {/* The ramp ink's only non-chromatic channel. Adjacent ramp stops
                  sit deliberately BELOW the 0.05 separation floor by design —
                  bar length carries the distinction for sighted users — so the
                  word is what a screen reader and a colour-blind reader get. */}
              <span className="sr-only">
                {" "}
                {t(`antenna_statistics.quality.${quality}`)}
              </span>
            </>
          )}
        </span>
      </dd>
    </div>
  );
}

// =============================================================================
// Port block
// =============================================================================

function PortBlock({
  signal,
  prefix,
  index,
}: {
  signal: SignalPerAntenna | undefined;
  prefix: "lte" | "nr";
  index: number;
}) {
  const { t } = useTranslation("cellular");
  const port = ANTENNA_PORTS[index];
  const reporting = isPortReporting(signal, index, prefix);

  const rsrp = signal?.[`${prefix}_rsrp`][index];
  const rsrq = signal?.[`${prefix}_rsrq`][index];
  const sinr = signal?.[`${prefix}_sinr`][index];

  // The port's verdict is the WORST of its three metrics, so a strong RSRP
  // cannot mask a poor SINR — the reason `worstSignalQuality` exists.
  const verdict: SignalQuality = reporting
    ? worstSignalQuality(
        getSignalQuality(normalizeSignalValue(rsrp, "rsrp"), RSRP_THRESHOLDS),
        getSignalQuality(normalizeSignalValue(rsrq, "rsrq"), RSRQ_THRESHOLDS),
        getSignalQuality(normalizeSignalValue(sinr, "sinr"), SINR_THRESHOLDS)
      )
    : "none";

  const verdictLabel = reporting
    ? t(`antenna_statistics.quality.${verdict}`)
    : t("antenna_statistics.port.not_reporting");

  return (
    // The metric rows stay mounted even when the port is idle. Live capture
    // shows chains dropping in and out roughly every 20s, and a block that
    // collapsed on each drop would make the whole card jump — so an idle port
    // is a STATED finding at a fixed height, never a hidden or dimmed one.
    <motion.div
      variants={staggerRowItem}
      className={PORT_SHAPE.ROOT}
      style={{ minHeight: PORT_BLOCK_HEIGHT }}
    >
      <div className={PORT_SHAPE.HEAD}>
        <span className="min-w-0 truncate text-sm font-semibold">
          {port.name}
        </span>
        <span className={PORT_SHAPE.RX_CHIP}>{port.rx}</span>
        <Badge variant={qualityBadgeVariant(verdict)} className="ml-auto shrink-0">
          <SwapLabel
            swapKey={`${qualityBadgeVariant(verdict)}:${verdictLabel}`}
            className="gap-1"
          >
            <MaterialSymbol name={QUALITY_GLYPH[verdict]} size={12} filled />
            {verdictLabel}
          </SwapLabel>
        </Badge>
      </div>

      {/* A description list, so a screen reader announces each measurement as
          a key/value pair rather than as six loose runs of text. */}
      <dl className={PORT_SHAPE.METRICS}>
        <MetricRow
          metric="rsrp"
          prefix={prefix}
          unit="dBm"
          raw={rsrp}
          thresholds={RSRP_THRESHOLDS}
          rowIndex={0}
        />
        <MetricRow
          metric="rsrq"
          prefix={prefix}
          unit="dB"
          raw={rsrq}
          thresholds={RSRQ_THRESHOLDS}
          rowIndex={1}
        />
        <MetricRow
          metric="sinr"
          prefix={prefix}
          unit="dB"
          raw={sinr}
          thresholds={SINR_THRESHOLDS}
          rowIndex={2}
        />
      </dl>
    </motion.div>
  );
}

// =============================================================================
// Technology card
// =============================================================================

export function TechCard({
  signal,
  prefix,
}: {
  signal: SignalPerAntenna | undefined;
  prefix: "lte" | "nr";
}) {
  const { t } = useTranslation("cellular");
  const active = hasAntennaData(signal, prefix);

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1 px-0">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="min-w-0 truncate text-xl font-semibold">
              {t(`antenna_statistics.card.${prefix}.title`)}
            </CardTitle>
            <CardDescription className="min-w-0 truncate text-[13px]">
              {t(`antenna_statistics.card.${prefix}.description`)}
            </CardDescription>
          </div>
          {/* Identity, never health: this chip says WHICH radio the card is
              about. Quality lives in the per-port verdict chips below. */}
          <Tag
            variant={prefix === "nr" ? "nr" : "lte"}
            className="shrink-0 px-2.5 py-1 text-xs font-semibold"
          >
            {t(`antenna_statistics.card.${prefix}.identity`)}
          </Tag>
        </div>
      </CardHeader>

      {/* `flex flex-1 flex-col`, not the primitive's bare `px-6` block.
          `Empty` already ships `flex-1 justify-center`, but that grow had
          nothing to grow inside: a block-level CardContent gave it no flex
          context, so on a card stretched to its taller sibling by
          `*:data-[slot=card]:h-full` the empty message sat pinned to the top
          with the rest of the card's height as dead air below it. The taller
          the live card, the larger the void. */}
      <CardContent className="flex flex-1 flex-col px-0">
        {!active ? (
          // `md:py-10` is not redundant: the primitive ships `md:p-12`, which
          // would otherwise silently win over `py-10` above 768px.
          <Empty className="rounded-tile border-0 bg-surface-container py-10 md:py-10">
            <EmptyHeader>
              {/* A full-round disc one container step above the block it sits
                  on, not the primitive's `bg-muted rounded-lg` square-ish
                  default. The Glyph-Disc Rule puts a state glyph in a filled
                  circle, and the legacy `rounded-lg` radius is off the role
                  scale (The Role-Radius Rule). Neutral tones because an absent
                  radio is a deliberately-inactive state, not a fault. */}
              <EmptyMedia
                variant="icon"
                className="size-11 rounded-pill bg-surface-container-high text-on-surface-variant"
              >
                <MaterialSymbol name="signal_cellular_off" size={24} />
              </EmptyMedia>
              <EmptyTitle>
                {t(`antenna_statistics.empty.${prefix}.title`)}
              </EmptyTitle>
              <EmptyDescription className="max-w-xs text-pretty">
                {t(`antenna_statistics.empty.${prefix}.description`)}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          // TickGroup is scoped to ONE card: it coordinates the dip order of
          // values sharing an axis and a container, and wrapping the whole page
          // would stagger LTE against NR as if they were one reading.
          <TickGroup>
            {/* Variants only — no `initial`/`animate` of its own, so the stack
                inherits the cascade and the port blocks arrive inside this
                card's 60ms slot rather than at t=0. Matches
                `cellular-information.tsx:176-183`, the reference for this route
                family.

                The obvious worry is that these cards first render at the
                skeleton-to-data handoff, so an inherited child might be
                expected to sit in `hidden` waiting for a push that never comes.
                It does not, and the reason is mount timing rather than any
                special case: this stack and its `staggerItem` card wrapper
                mount in the SAME commit, so motion's `manuallyAnimateOnMount`
                is false for both (it tests the parent's committed DOM node) and
                the stack defers to a parent push — which is live, because the
                wrapper is itself running a fresh `hidden -> visible` on that
                very commit. Because this node still declares `variants` it
                remains a variant node, so `staggerRows`' own 40ms
                `staggerChildren` drives the four blocks regardless of who
                triggered the transition.

                Several shipped card bodies DO restate the clock
                (`signal-status-card.tsx:234`, `active-bands-card.tsx:397`,
                `cellular-information-card.tsx:471`). That also works, but it
                detaches the row cascade from the card's slot so both cards'
                rows start together; inheriting chains each card's rows behind
                its own card, which is the choreography the canon describes. */}
            <motion.div className={PORT_SHAPE.STACK} variants={staggerRows}>
              {ANTENNA_PORTS.map((port, i) => (
                <PortBlock
                  key={port.rx}
                  signal={signal}
                  prefix={prefix}
                  index={i}
                />
              ))}
            </motion.div>
          </TickGroup>
        )}
      </CardContent>
    </Card>
  );
}

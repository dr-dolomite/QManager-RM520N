"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { MetricBar, type MetricBarTone } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getValueColorClass } from "@/components/dashboard/signal-card-utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SignalQuality } from "@/types/modem-status";
import type {
  EnrichedCarrier,
  RadioMetric,
  RadioSummary,
} from "@/lib/radio-info";

// =============================================================================
// Spectrum in use — the LIVE half of /cellular/ Radio Information
// =============================================================================
// Every carrier's metrics are on screen at once. Nothing here is one click
// deep, because comparing carriers IS the job: a technician does not open a
// band to learn how it is doing, they scan the column to find the leg that is
// dragging the aggregate down.
//
// This replaced a Radix Accordion (`type="single" collapsible`, PCC open by
// default). The accordion cost a click per carrier to answer the page's own
// question, and its height animation was the SECOND sanctioned exception to
// DESIGN.md's Transform-Only Rule. Deleting it retires that exception and
// returns the product to exactly one documented `width` exception — do not
// spend it again. The band-reference disclosure below is a plain conditional
// render for exactly this reason.
//
// The page is now split by CADENCE, not by symmetry: this card holds what
// moves every poll, `cellular-information-card.tsx` holds what moves on
// handover. That is why neither is height-locked to the other any more.
//
// Every derivation lives in `lib/radio-info.ts`. This file renders a decision;
// it does not make one. The only thing computed here is presentation: tone
// maps, glyph ladders and geometry.
// =============================================================================

// -----------------------------------------------------------------------------
// Geometry — single source for the loaded row AND its skeleton
// -----------------------------------------------------------------------------
// The Skeleton-Mirror Rule fails silently when the two shapes are written twice:
// the handoff shows as a jump rather than a fade, and nothing in the type system
// notices. Exported so a page-level skeleton can reuse the same numbers.
//
// The height is the taller of the row's two blocks plus its padding. Identity
// block: chip line (26) + gap (8) + meta line (16) = 50. Metric cell: label
// line (16) + gap (6) + meter lane (16) = 38. So 50 + py-4 either side = 82.
// `docs/reference/antenna-statistics.md` and
// `components/cellular/antenna-statistics/tech-card.tsx` both cite this export
// as the canonical idiom for a skeleton that cannot drift — the NAME is
// load-bearing beyond this file even though the number is not.
export const BAND_ROW_HEIGHT = 82;
export const BAND_SKELETON_ROWS = 3;

const CARD_SHELL =
  "@container/bands gap-4 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]";

/** Row shell. Deliberately NEUTRAL — see the tone note below. */
const ROW_SHELL = "rounded-tile bg-surface-container px-5 py-4";

/**
 * The row's two blocks. Identity is a FIXED column at width, so the metric grid
 * starts at the same x-offset on every row — that alignment is the entire
 * reason this layout beats the accordion, and it evaporates the moment a block
 * is allowed to size to its content.
 */
const ROW_LAYOUT =
  "flex flex-col gap-3.5 @3xl/bands:flex-row @3xl/bands:items-center @3xl/bands:gap-6";
const IDENTITY_BLOCK =
  "flex min-w-0 flex-col gap-2 @3xl/bands:w-[16.5rem] @3xl/bands:shrink-0";

/**
 * FIXED columns, never `auto-fit`. RSRP sits at the same offset on every row so
 * a weak leg is visible without reading a number, and an NR carrier's missing
 * RSSI leaves an EMPTY fourth cell rather than letting the other three spread
 * out and break the column.
 */
const METRIC_GRID =
  "grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 @4xl/bands:grid-cols-4";

/** The meter lane. Pinned so a bar, a caption and a "not reported" line all
 *  occupy the same band and the value baselines stay level across the row. */
const METER_LANE = "flex h-4 items-center";

// -----------------------------------------------------------------------------
// Tone
// -----------------------------------------------------------------------------
/**
 * Row fill is neutral; radio identity rides on the BAND CHIP.
 *
 * The comp tinted each row by ROLE (PCC blue, ANCHOR teal). The shipped
 * dashboard CA strip tints the very same carriers by TECHNOLOGY (NR blue, LTE
 * violet — `components/dashboard/carrier-aggregation.tsx`). Two screens one
 * click apart cannot disagree about what blue means, so role tinting is out:
 * `primary-container` already carries "this is the NR leg" and must not acquire
 * a second meaning.
 *
 * Technology tinting the whole row was the other option and it breaks a
 * different rule. The row carries a STATUS chip (success / warning /
 * destructive), and every status role is itself a container fill. Sitting one
 * container fill on top of another is exactly the collision the CA card calls
 * out when it explains why its role chip is not a Badge — the chip stops
 * reading as a chip. With every row now expanded, four full-bleed tinted rows
 * would also make the card shout before the user has picked anything to look
 * at.
 *
 * So: neutral `surface-container` row, technology carried by the band label
 * rendered as an identity Badge (`nr` / `lte` — the same blue/violet pair the
 * dashboard uses, and the same treatment Signal Status gives its band via
 * `asIdentity`), role carried by the role chip's WORDS, and quality carried by
 * the status chip that now has a plain surface to sit on. Three facts, three
 * channels, no channel doing two jobs.
 */
function bandIdentityVariant(c: EnrichedCarrier): BadgeVariant {
  if (c.released) return "muted";
  return c.technology === "NR" ? "nr" : "lte";
}

/**
 * The role chip inverts the row: an outlined-looking pill in the neutral ramp.
 * Not a Badge status variant — this labels WHICH carrier a row is, not how it
 * is doing (the Filled-Chip Rule governs status indicators; this is an
 * identifier).
 */
// `text-xs` (12px), not the comp's 11px. 11px is a SURFACE-SCOPED exception in
// this system — the sidebar and the pre-auth eyebrow own it — and DESIGN.md
// says in as many words not to use that step to smuggle arbitrary sizes onto
// ordinary text. A chip label is the Label step, which is 12px.
const ROLE_CHIP =
  "inline-flex shrink-0 items-center rounded-pill bg-surface-container-high px-2.5 py-1 text-xs font-bold tracking-[0.06em] text-on-surface-variant uppercase";

function qualityVariant(quality: SignalQuality): BadgeVariant {
  switch (quality) {
    case "excellent":
    case "good":
      return "success";
    case "fair":
      return "warning";
    case "poor":
      return "destructive";
    default:
      return "muted";
  }
}

/**
 * The wedge ladder, NOT the `signal_cellular_alt*` family the comp draws.
 *
 * Mirrors `getQualityGlyph()` in `components/dashboard/signal-status-card.tsx`,
 * where the same call was already argued out and settled: `alt_1_bar` is a
 * single 120x240-unit mark (~2x4px at size 16, indistinguishable from a failed
 * icon load) and there is no `alt_0_bar`, so the alt ladder's ink mass runs
 * large -> medium -> speck -> large -> large and quality reads non-monotone.
 *
 * The comp also used ONE glyph for both Excellent and Good. That is
 * unshippable: `success-container` and `warning-container` measure 1.03:1 apart
 * and are the same surface under deuteranopia, so the glyph is the only channel
 * separating a healthy carrier from a degraded one. Two states in one slot never
 * share a glyph.
 */
function qualityGlyph(quality: SignalQuality): MaterialSymbolName {
  switch (quality) {
    case "excellent":
      return "signal_cellular_4_bar";
    case "good":
      return "signal_cellular_3_bar";
    case "fair":
      return "signal_cellular_2_bar";
    case "poor":
      return "signal_cellular_1_bar";
    default:
      return "signal_cellular_off";
  }
}

/** Meter fill tone. Pinned from the metric's own quality rather than left to
 *  MetricBar's threshold arithmetic, because `percent` is already a normalised
 *  0-100 and its thresholds live in `types/modem-status`, not here. */
function meterTone(quality: SignalQuality): MetricBarTone {
  switch (quality) {
    case "fair":
      return "warning";
    case "poor":
      return "destructive";
    default:
      return "success";
  }
}

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface ActiveBandsCardProps {
  /** Already enriched and role-assigned by `lib/radio-info.ts`. Released
   *  carriers are INCLUDED and must render — see the release note below. */
  carriers: EnrichedCarrier[];
  summary: RadioSummary;
  isLoading: boolean;
}

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

function BandsSkeleton() {
  return (
    <Card className={CARD_SHELL}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="ml-auto h-[2.375rem] w-44 rounded-pill" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: BAND_SKELETON_ROWS }).map((_, i) => (
          <Skeleton
            key={i}
            className="rounded-tile"
            style={{ height: BAND_ROW_HEIGHT }}
          />
        ))}
      </div>
      <Skeleton className="h-14 w-full rounded-tile" />
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Metric cell
// -----------------------------------------------------------------------------

function MetricCell({
  metric,
  technology,
  index,
}: {
  metric: RadioMetric;
  technology: "LTE" | "NR";
  index: number;
}) {
  const { t } = useTranslation("cellular");

  // 3GPP calls the same measurement SNR on the NR side and SINR on the LTE
  // side. The contract hands us a labelKey rather than display text precisely
  // so the discriminator lives in one place.
  const labelKey =
    metric.id === "sinr" && technology === "NR" ? "snr" : metric.labelKey;

  const hasValue = metric.value !== null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-on-surface-variant">
          {t(`radio_info.bands.metric.${labelKey}`)}
        </span>
        <span
          className={cn(
            "truncate text-[13px] font-semibold tabular-nums",
            // The `*-on-surface` ink steps, never the solid role tokens. The
            // solid pair measures 4.29:1 (success) and 3.74:1 (warning) on
            // `surface-container` in light mode — both below AA — which is why
            // the darkened steps exist at 5.88/5.95.
            getValueColorClass(metric.quality),
          )}
        >
          {hasValue ? (
            <TickingValue value={metric.value}>
              {metric.value} {metric.unit}
            </TickingValue>
          ) : (
            <span aria-hidden="true">&mdash;</span>
          )}
        </span>
      </div>

      <div className={METER_LANE}>
        {metric.barless ? (
          // RSSI has no meaningful 0-100 scale, so it gets a caption where the
          // track would be rather than a bar that means nothing.
          <span className="truncate text-xs leading-4 text-on-surface-variant">
            {t("radio_info.bands.metric.rssi_caption")}
          </span>
        ) : metric.percent === null ? (
          // A null metric is NOT zero percent. A zero-width bar reads as
          // "signal is zero", which is a different and alarming claim about a
          // value the radio simply did not report — SCCs routinely report only
          // a subset.
          <span className="truncate text-xs leading-4 text-on-surface-variant">
            {t("radio_info.bands.metric.not_reported")}
          </span>
        ) : (
          <MetricBar
            value={metric.percent}
            max={100}
            // Unreachable by construction: `colorOverride` pins the tone, so
            // these two only exist to satisfy the required props.
            warnAt={101}
            dangerAt={101}
            colorOverride={meterTone(metric.quality)}
            size="md"
            track="surface-container-high"
            index={index}
          />
        )}
      </div>

      {/* The tint on the value above is the only channel carrying this metric's
          own quality, and `success-on-surface` / `warning-on-surface` measure
          ~1.01:1 apart — the same ink to anyone reading in greyscale. The word
          is the non-chromatic channel. Same treatment as
          `antenna-statistics/tech-card.tsx`. */}
      {!metric.barless && hasValue ? (
        <span className="sr-only">
          {t(`radio_info.bands.quality.${metric.quality}`)}
        </span>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Band reference
// -----------------------------------------------------------------------------

function ReferenceField({
  label,
  children,
  marker,
}: {
  label: string;
  children: React.ReactNode;
  marker?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-xs font-semibold text-on-surface-variant">
        {label}
      </dt>
      <dd className="m-0 flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold">
        {children}
        {marker}
      </dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export function ActiveBandsCard({
  carriers,
  summary,
  isLoading,
}: ActiveBandsCardProps) {
  const { t } = useTranslation("cellular");

  // ONE card-level disclosure, not one per row. Band name, duplex, bandwidth,
  // DL/UL frequency and SCS never change for a given band, so they are
  // reference material rather than readings — the thing a technician wants
  // once, for every carrier at the same time, not per row on the way to a
  // metric.
  const [showReference, setShowReference] = React.useState(false);

  if (isLoading) return <BandsSkeleton />;

  const roleLabel = (c: EnrichedCarrier) =>
    c.roleKey === "scc"
      ? t("radio_info.bands.role.scc", { index: c.sccIndex ?? 1 })
      : t(`radio_info.bands.role.${c.roleKey}`);

  // "NR n78" / "LTE B3". The contract stores NR bands capitalised ("N41");
  // 3GPP writes them lowercase, and so does every carrier-facing tool.
  const bandLabel = (c: EnrichedCarrier) =>
    c.technology === "NR"
      ? `NR ${c.band.replace(/^N/, "n")}`
      : `LTE ${c.band}`;

  const unknown = t("radio_info.bands.detail.unknown");
  const mhz = (value: number | null) =>
    value === null ? unknown : t("radio_info.bands.units.mhz", { value });

  return (
    <Card className={CARD_SHELL}>
      {/* Header. No icon in the title — icons belong in chips and action areas. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {/* `text-xl` (20px) — the Headline step, which DESIGN.md defines as
              "large card titles". The comp's 22px is not a step on the ramp. */}
          <h3 className="text-xl leading-tight font-semibold">
            {t("radio_info.bands.title")}
          </h3>
          <p className="text-[13px] text-on-surface-variant">
            {t("radio_info.bands.description", {
              count: summary.carrierCount,
            })}
          </p>
        </div>

        {carriers.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowReference((open) => !open)}
            aria-expanded={showReference}
            // `button.tsx` still defaults to the legacy rounded-md, so the pill
            // metrics are applied at the call site, as on the page header.
            className="ml-auto h-[2.375rem] shrink-0 gap-2 rounded-pill px-4 text-[13px] font-semibold"
          >
            <MaterialSymbol
              name={showReference ? "visibility_off" : "visibility"}
              size={18}
            />
            {showReference
              ? t("radio_info.bands.reference.hide")
              : t("radio_info.bands.reference.show")}
          </Button>
        ) : null}
      </div>

      {carriers.length === 0 ? (
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MaterialSymbol name="cell_tower" size={24} />
            </EmptyMedia>
            <EmptyTitle>{t("radio_info.bands.empty.title")}</EmptyTitle>
            <EmptyDescription>
              {t("radio_info.bands.empty.description")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        /* ONE TickGroup for the whole card body, and it stays one now that every
           metric is mounted rather than hidden behind a collapsed row.
           `TickGroup` clamps rank at MAX_RANK (7), so the cascade's lead is
           bounded at 7 x TICK_STAGGER_STEP = 1.4s no matter how many carriers
           report — 1.4s lead + a 1.4s dip = 2.8s against a ~3.7-4.0s poll,
           which is the same headroom `lib/motion.ts` already documents. It is
           the clamp, not the carrier count, that keeps this inside one cycle;
           check `MAX_RANK` before changing the step or the poll. Values that
           held this poll never enter the ranking at all. */
        <TickGroup>
          <TooltipProvider>
            <motion.div
              className="flex flex-col gap-2"
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              {carriers.map((c) => {
                const metricBase = c.released ? null : c.quality;
                const chipVariant = c.released
                  ? "muted"
                  : qualityVariant(c.quality);
                const chipText = c.released
                  ? t("radio_info.bands.released")
                  : t(`radio_info.bands.quality.${c.quality}`);

                // The meta line carries the two facts that identify WHICH cell
                // this is, on one mono line under the chips: PCI and the ARFCN
                // under its correct label. Bandwidth lives in the band
                // reference disclosure below with the rest of the carrier's
                // static spec — it never changes for a given band, so it reads
                // as reference material alongside band name and duplex, not as
                // an identity fact a technician reads per handover.
                const metaLine = [
                  c.pci === null
                    ? null
                    : `${t("radio_info.bands.detail.pci")} ${c.pci}`,
                  c.earfcn === null ? null : `${c.arfcnLabel} ${c.earfcn}`,
                ]
                  .filter(Boolean)
                  .join("    ");

                const sinr = c.metrics.find((m) => m.id === "sinr");
                const showLowSnr =
                  !c.released &&
                  sinr !== undefined &&
                  sinr.value !== null &&
                  sinr.quality === "poor";

                return (
                  /* Keyed on `carrier.key` (the carrierKey), NEVER an index
                     and NEVER PCI: on the live device both LTE carriers report
                     PCI 295, so a PCI-keyed list collapses two real carriers
                     into one row, and an index key loses identity across a
                     wipe-and-refill. */
                  <motion.div
                    key={c.key}
                    variants={staggerRowItem}
                    className={ROW_SHELL}
                    style={{ minHeight: BAND_ROW_HEIGHT }}
                  >
                    <div className={ROW_LAYOUT}>
                      <div className={IDENTITY_BLOCK}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={ROLE_CHIP}>{roleLabel(c)}</span>

                          <Badge
                            variant={bandIdentityVariant(c)}
                            className="shrink-0 px-2.5 py-1 text-sm font-semibold"
                          >
                            {bandLabel(c)}
                          </Badge>

                          <Badge variant={chipVariant}>
                            {/* Glyph INSIDE the swap: it is the only greyscale
                                channel between success and warning at 1.03:1,
                                so it has to travel with the word it qualifies.
                                Key encodes text AND variant, because both move
                                together. */}
                            <SwapLabel
                              swapKey={`${chipVariant}:${chipText}`}
                              className="gap-1.5"
                            >
                              <MaterialSymbol
                                name={
                                  metricBase === null
                                    ? "do_not_disturb_on"
                                    : qualityGlyph(metricBase)
                                }
                                size={15}
                                filled
                              />
                              {chipText}
                            </SwapLabel>
                          </Badge>
                        </div>

                        {metaLine ? (
                          <p className="truncate font-mono text-xs text-on-surface-variant">
                            {/* Keyed on the WHOLE line, not just the ARFCN. A
                                handover can move PCI or width while the ARFCN
                                holds, and keying the tick to one of the three
                                facts printed here would leave the other two
                                changing silently. */}
                            <TickingValue value={metaLine}>
                              {metaLine}
                            </TickingValue>
                          </p>
                        ) : null}
                      </div>

                      <div className={METRIC_GRID}>
                        {c.metrics.map((m, i) => (
                          <MetricCell
                            key={m.id}
                            metric={m}
                            technology={c.technology}
                            index={i}
                          />
                        ))}
                      </div>
                    </div>

                    {showLowSnr && sinr ? (
                      /* Threshold-triggered, and it states the READING only.
                         The comp went on to claim "the scheduler may drop it
                         under load" — QManager has no visibility into scheduler
                         behaviour and cannot verify that, so the causal half is
                         cut. */
                      <div className="mt-3.5 flex items-start gap-3 rounded-field bg-destructive-container px-4 py-3 text-on-destructive-container">
                        <MaterialSymbol
                          name="warning"
                          size={19}
                          filled
                          className="shrink-0"
                        />
                        <p className="text-xs leading-relaxed">
                          {t("radio_info.bands.low_snr", { value: sinr.value })}
                        </p>
                      </div>
                    ) : null}

                    {c.released && c.releasedForMs !== null ? (
                      <div className="mt-3.5 flex items-start gap-3 rounded-field bg-surface-container-high px-4 py-3 text-on-surface-variant">
                        <MaterialSymbol
                          name="info"
                          size={19}
                          className="shrink-0"
                        />
                        <p className="text-xs leading-relaxed">
                          {t("radio_info.bands.released_note", {
                            seconds: Math.round(c.releasedForMs / 1000),
                          })}
                        </p>
                      </div>
                    ) : null}

                    {/* Band reference. A plain conditional render, NOT a height
                        animation: the accordion this card replaced was the
                        product's second Transform-Only exception, and reopening
                        one for a disclosure that expands every row at once
                        would spend a canon win to animate five simultaneous
                        reflows. `bg-surface` is a real token — the comp's
                        `oklch(1 0 0 / 0.55)` is white-at-alpha over a tinted
                        container, which the Solid-Container Rule bans. */}
                    {showReference ? (
                      <dl className="mt-3.5 m-0 grid grid-cols-2 gap-x-6 gap-y-3 rounded-field bg-surface px-4 py-3.5 @3xl/bands:grid-cols-3 @4xl/bands:grid-cols-5">
                        <ReferenceField
                          label={t("radio_info.bands.detail.band_name")}
                        >
                          {c.bandName ?? unknown}
                        </ReferenceField>

                        <ReferenceField
                          label={t("radio_info.bands.detail.duplex")}
                        >
                          {c.duplex ?? unknown}
                        </ReferenceField>

                        <ReferenceField
                          label={t("radio_info.bands.detail.bandwidth")}
                        >
                          <span className="truncate font-mono tabular-nums">
                            {mhz(c.bandwidthMhz)}
                          </span>
                        </ReferenceField>

                        <ReferenceField
                          label={t("radio_info.bands.detail.dl_frequency")}
                        >
                          <span className="truncate font-mono tabular-nums">
                            {c.dlFrequencyMhz === null
                              ? unknown
                              : t("radio_info.bands.units.mhz", {
                                  value: c.dlFrequencyMhz.toFixed(2),
                                })}
                          </span>
                        </ReferenceField>

                        <ReferenceField
                          label={t("radio_info.bands.detail.ul_frequency")}
                        >
                          <span className="truncate font-mono tabular-nums">
                            {c.ulFrequencyMhz === null
                              ? unknown
                              : t("radio_info.bands.units.mhz", {
                                  value: c.ulFrequencyMhz.toFixed(2),
                                })}
                          </span>
                        </ReferenceField>

                        {c.technology === "NR" ? (
                          <ReferenceField
                            label={t("radio_info.bands.detail.scs")}
                            marker={
                              // Only the carrier matching the serving NR cell
                              // has a modem-reported SCS. Every other NR
                              // carrier's is derived from its band's duplex
                              // mode, and showing an inference as if it were
                              // reported would be the page lying quietly. The
                              // marker is focusable so the explanation is
                              // reachable by keyboard.
                              c.scsInferred ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex shrink-0 items-center gap-1 rounded-pill text-on-surface-variant outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                    >
                                      {/* `text-xs` — the Label step. The marker
                                          is subordinated by ink and case, not
                                          by shrinking off the ramp. */}
                                      <span className="text-xs font-semibold tracking-wide uppercase">
                                        {t(
                                          "radio_info.bands.detail.scs_derived",
                                        )}
                                      </span>
                                      <MaterialSymbol name="help" size={14} />
                                      <span className="sr-only">
                                        {t(
                                          "radio_info.bands.detail.scs_derived_hint",
                                        )}
                                      </span>
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-64">
                                    {t(
                                      "radio_info.bands.detail.scs_derived_hint",
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              ) : undefined
                            }
                          >
                            <span className="truncate font-mono tabular-nums">
                              {c.scsKhz === null
                                ? unknown
                                : t("radio_info.bands.units.khz", {
                                    value: c.scsKhz,
                                  })}
                            </span>
                          </ReferenceField>
                        ) : null}
                      </dl>
                    ) : null}
                  </motion.div>
                );
              })}
            </motion.div>
          </TooltipProvider>
        </TickGroup>
      )}

      {/* Cell-scanner footer. `chevron_right` rather than the comp's
          `arrow_forward`: this is in-app navigation, and the subset already
          carries the chevron the rest of the shell uses for it. */}
      <div className="flex flex-wrap items-center gap-3.5 rounded-tile bg-surface-container px-4 py-3.5">
        <MaterialSymbol name="radar" size={20} className="text-primary" />
        <p className="min-w-48 flex-1 text-[13px] leading-relaxed text-on-surface-variant">
          {t("radio_info.bands.scanner.body")}
        </p>
        <Link
          href="/cellular/cell-scanner"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-pill text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          {t("radio_info.bands.scanner.link")}
          <MaterialSymbol name="chevron_right" size={16} />
        </Link>
      </div>
    </Card>
  );
}

export default ActiveBandsCard;

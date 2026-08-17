"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { Tag, type TagVariant } from "@/components/ui/tag";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
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
// block is now just the chip line (26) — PCI moved into the metric grid, see
// `IdentityMetricCell` below. Metric cell governs instead: label line (16) +
// gap (6) + meter lane (16) = 38. So 38 + py-4 either side = 70.
// `docs/reference/antenna-statistics.md` and
// `components/cellular/antenna-statistics/tech-card.tsx` both cite this export
// as the canonical idiom for a skeleton that cannot drift — the NAME is
// load-bearing beyond this file even though the number is not.
export const BAND_ROW_HEIGHT = 70;
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

/**
 * The identity block now carries ONLY the role chip, the band tag and the
 * released marker. EARFCN and PCI both moved into `METRIC_GRID` — see
 * `IdentityMetricCell` below — so the row's two identifiers and its three
 * readings all sit in the one place on the row with FIXED columns, and the
 * pair that answers "which physical cell is this" reads as ONE scannable
 * column instead of splitting across the identity block and the metric grid.
 */

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
 * rendered as an identity Tag (`nr` / `lte` — the same blue/violet pair the
 * dashboard uses, and the same treatment Signal Status gives its band via
 * `asIdentity`), role carried by the role chip's WORDS, and quality carried by
 * the status chip that now has a plain surface to sit on. Three facts, three
 * channels, no channel doing two jobs.
 *
 * IDENTITY IS AN OUTLINE TAG, NOT A FILLED CHIP. "This row is the NR leg" is
 * not a verdict about the row's health, and the Two-Form Rule keeps the two
 * forms apart so the released chip beside this one still reads as the row's one
 * status object.
 *
 * A RELEASED carrier drops to `neutral`, and tone is the WEAKEST half of that
 * signal on purpose: `lte` and a neutral metadata tone are close enough that a
 * deuteranope separates them barely or not at all, so "dropped" must never rest
 * on hue. It does not here — the released row already renders a filled `muted`
 * status chip carrying the `do_not_disturb_on` glyph AND the translated word,
 * plus the elapsed-time note beneath. Glyph and word first, tone as
 * reinforcement (DESIGN.md > Signature surfaces > Carrier Aggregation strip).
 */
function bandIdentityVariant(c: EnrichedCarrier): TagVariant {
  if (c.released) return "neutral";
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

/**
 * The per-row aggregate QUALITY CHIP IS GONE — removed by direct user request.
 *
 * What used to sit beside the band badge ("Excellent" / "Good" / "Fair" /
 * "Poor") was `worstSignalQuality()` rendered as a status Badge. It is not
 * coming back without a fresh design pass, and `qualityVariant()` /
 * `qualityGlyph()` were deleted with it rather than left dangling.
 *
 * Two consequences were handled here rather than left to rot:
 *
 *   1. RELEASED still needs a word. `chipText` was the ONLY render site of
 *      `radio_info.bands.released`, and DESIGN.md makes carrier retention a
 *      named contract — "a released carrier stays visible and greyed rather
 *      than silently disappearing". A retained carrier with no label does not
 *      read as "recently dropped", it reads as an active carrier whose metrics
 *      went blank, which is a worse diagnosis on the page opened to diagnose
 *      exactly that. So the chip survives for released carriers ONLY. The rule
 *      is now "a chip appears when there is an exception to report", which is
 *      tighter than the one it replaces.
 *
 *   2. The aggregate still needs a NON-VISUAL channel. The chip's glyph ladder
 *      was the row's only greyscale-safe health signal — `success-on-surface`
 *      and `warning-on-surface` measure ~1.01:1 apart, i.e. the same ink to
 *      anyone reading in greyscale. `c.quality` now rides the row's accessible
 *      name instead, which costs zero pixels and keeps screen-reader parity.
 *      Per-metric bar LENGTH remains the sighted non-chromatic channel.
 */

/**
 * Meter fill tone and numeral ink both come from
 * `components/cellular/signal-quality-display.ts` — the canonical map — rather
 * than from a private switch here.
 *
 * The private one this replaces was a LIVE BUG, not just duplication. It had a
 * three-arm switch (`fair` -> warning, `poor` -> destructive, `default` ->
 * success), so `none` — "the radio reported nothing" — fell through the default
 * arm and painted an unread metric GREEN. `qualityMeterTone()` returns `null`
 * for `none` precisely so that cannot be expressed: there is no fill colour for
 * an absent reading, and the bar renders as an EMPTY TRACK instead
 * (DESIGN.md > Quality bars).
 *
 * Tone is still pinned from the metric's own quality rather than left to
 * MetricBar's threshold arithmetic, because `percent` is already a normalised
 * 0-100 and its thresholds live in `types/modem-status`, not here.
 */

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface ActiveBandsCardProps {
  /** Already enriched and role-assigned by `lib/radio-info.ts`. Released
   *  carriers are INCLUDED and must render — see the release note below. */
  carriers: EnrichedCarrier[];
  summary: RadioSummary;
  isLoading: boolean;
  /**
   * The poller has gone quiet. THIS CARD IS THE THING THAT FROZE, so this card
   * is where it says so.
   *
   * `cellular-information.tsx` freezes the carrier list while stale rather than
   * reconciling — any failed AT read empties `carrier_components` wholesale,
   * and announcing "released" for carriers that never moved would be a lie. The
   * freeze is correct. What was missing is that it was INVISIBLE: only a hard
   * `error` raised the page banner, so a stale-but-not-errored poll rendered
   * frozen numbers at full confidence with nothing on screen saying so. That is
   * the State-Honesty Rule inverted by omission, on the page whose own shell
   * comment calls this exact class of bug "a live bug, not just an omission".
   *
   * It is deliberately NOT a reinstatement of the page-header Live/Stale chip,
   * which was cut by direct request. A chip in the header marks the whole
   * route; this marks the one surface that actually stopped updating, costs no
   * new geometry, and spends a `radio_info.bands.stale` key that already ships
   * translated in all five locales with zero consumers.
   */
  isStale?: boolean;
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
  // `null` for `none`, which is the API refusing to name a colour for a reading
  // that does not exist. It drives BOTH channels below: no fill, and no ramp ink.
  const tone = qualityMeterTone(metric.quality);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-on-surface-variant">
          {t(`radio_info.bands.metric.${labelKey}`)}
        </span>
        <span
          className={cn(
            "truncate text-[13px] font-semibold tabular-nums",
            // The five-stop ramp's NUMERAL ink (`--quality-N`), not the
            // functional three. Legal here only because the bar directly
            // beneath carries the same reading as LENGTH: adjacent ramp stops
            // sit below the 0.05 CVD separation floor by design, so a ramp
            // colour with no bar beside it is a bug. The `sr-only` quality word
            // at the foot of this cell is the third channel.
            qualityInkClass(metric.quality),
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
        ) : (
          // A null metric is NOT zero percent, and `MetricBar` now says so in
          // the one channel that cannot be misread: `value={null}` renders the
          // TRACK ALONE, with no fill element at all. A zero-length fill would
          // read as "signal is zero", which is a different and alarming claim
          // about a value the radio simply did not report — SCCs routinely
          // report only a subset.
          //
          // This replaces a "Not reported" caption in the meter lane. The words
          // did not disappear: they moved to the `sr-only` line below, so the
          // lane now holds a bar on every metric row and the four bars in a
          // carrier's grid stay scannable as one column instead of one of them
          // turning into a sentence.
          <MetricBar
            value={metric.percent}
            max={100}
            // Unreachable by construction: `colorOverride` pins the tone, so
            // these two only exist to satisfy the required props.
            warnAt={101}
            dangerAt={101}
            // Null passes straight through, never a fallback COLOUR. When
            // `tone` is null there is no reading, `value` is null in the same
            // breath, and MetricBar renders no fill for this prop to tint.
            // A `?? "success"` here is exactly the bug this file used to ship.
            colorOverride={tone}
            size="md"
            track="surface-container-high"
            index={index}
          />
        )}
      </div>

      {/* Colour is not an accessible channel. The ramp's adjacent stops sit
          below the CVD separation floor on purpose (bar length carries the
          distinction), so every tinted figure states its verdict in words here.
          An absent reading says so too — otherwise an empty track and a
          full-length one differ only by pixels a screen reader cannot see.
          Same treatment as `antenna-statistics/tech-card.tsx`. */}
      {!metric.barless ? (
        <span className="sr-only">
          {tone === null
            ? t("radio_info.bands.metric.not_reported")
            : t(`radio_info.bands.quality.${metric.quality}`)}
        </span>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Identity/ARFCN cell
// -----------------------------------------------------------------------------

/** One label/value line, shared by both rows of `IdentityMetricCell` — the
 *  same top-line geometry `MetricCell` uses, so the column's baselines line
 *  up with its neighbours even though this cell has no meter lane of its
 *  own. Mono per the Machine-Voice Rule: both PCI and EARFCN are identifiers,
 *  not readings. A null value prints `Not reported` rather than vanishing —
 *  the same answer `MetricCell` gives, and the same reason
 *  `cellular-information-card.tsx` refuses a bare dash: an empty slot reads
 *  as a rendering failure, not as a fact the radio declined to report. */
function IdentityFieldLine({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-on-surface-variant">
        {label}
      </span>
      <span className="truncate font-mono text-[13px] font-semibold tabular-nums text-on-surface">
        {value === null ? (
          <span className="font-sans text-on-surface-variant">
            {t("radio_info.bands.metric.not_reported_short")}
          </span>
        ) : (
          <TickingValue value={value}>{value}</TickingValue>
        )}
      </span>
    </div>
  );
}

/**
 * EARFCN/ARFCN and PCI, stacked as ONE column in `METRIC_GRID` — the two
 * facts that identify WHICH cell a row is, read together instead of split
 * across the identity block and the metric grid. It leads the grid, ahead of
 * the three signal readings, because identity is what a technician confirms
 * before judging quality.
 *
 * Two `IdentityFieldLine`s plus the `gap-1.5` between them land at the same
 * total height as a `MetricCell` (label line + gap + meter lane), so this
 * column's baseline matches its neighbours without needing a meter lane of
 * its own — there is nothing here to plot on a 0-100 scale.
 */
function IdentityMetricCell({
  arfcnLabel,
  earfcn,
  pciLabel,
  pci,
}: {
  arfcnLabel: string;
  earfcn: number | null;
  pciLabel: string;
  pci: number | null;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <IdentityFieldLine label={arfcnLabel} value={earfcn} />
      <IdentityFieldLine label={pciLabel} value={pci} />
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
  isStale = false,
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
          {/* The description slot doubles as the freshness line. `SwapLabel`
              because the two states replace each other in place — the same
              treatment the row chips use — and `warning` ink because a paused
              reading is degraded, not failed: the numbers above it are real,
              they are just not current. */}
          <p
            className={cn(
              "text-[13px]",
              isStale ? "text-warning-on-surface" : "text-on-surface-variant",
            )}
          >
            <SwapLabel swapKey={isStale ? "stale" : "live"}>
              {isStale
                ? t("radio_info.bands.stale")
                : t("radio_info.bands.description", {
                    count: summary.carrierCount,
                  })}
            </SwapLabel>
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
                // The aggregate the chip used to print. It still exists on the
                // contract and is still worth reporting — it just reports
                // through the row's accessible name now, not a fourth chip.
                const qualityWord = t(`radio_info.bands.quality.${c.quality}`);
                const rowLabel = c.released
                  ? `${roleLabel(c)} ${bandLabel(c)}, ${t("radio_info.bands.released")}`
                  : `${roleLabel(c)} ${bandLabel(c)}, ${qualityWord}`;

                // The two facts that identify WHICH cell this is: PCI and the
                // ARFCN under its correct label. Bandwidth lives in the band
                // reference disclosure below with the rest of the carrier's
                // static spec — it never changes for a given band, so it reads
                // as reference material alongside band name and duplex, not as
                // an identity fact a technician reads per handover.
                //
                // `arfcnLabelKey` rather than a literal: the contract used to
                // hand down the display string "ARFCN"/"EARFCN" directly, which
                // put one hardcoded English word on the same line as a
                // translated `PCI` label. It is a key now and resolves here.
                const arfcnLabel = t(
                  `radio_info.bands.detail.${c.arfcnLabelKey}`,
                );

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
                    // Carries the aggregate the deleted chip used to print, and
                    // gives an otherwise undifferentiated stack of divs a
                    // boundary a screen reader can announce between carriers.
                    role="group"
                    aria-label={rowLabel}
                  >
                    <div className={ROW_LAYOUT}>
                      <div className={IDENTITY_BLOCK}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={ROLE_CHIP}>{roleLabel(c)}</span>

                          <Tag
                            variant={bandIdentityVariant(c)}
                            className="shrink-0 px-2.5 py-1 text-sm font-semibold"
                          >
                            {bandLabel(c)}
                          </Tag>

                          {/* Exception-only. An ACTIVE carrier now carries no
                              third chip at all — its health reads from the four
                              metric bars to its right. A RELEASED one keeps its
                              word, because "greyed but still listed" is a
                              contract the band tag's neutral tone cannot carry
                              on its own — and now less than ever, since an
                              outline tag's released state differs from a live
                              LTE one by border hue alone. The glyph and the
                              word are what actually carry it. */}
                          {c.released ? (
                            <Badge variant="muted">
                              <SwapLabel
                                swapKey="released"
                                className="gap-1.5"
                              >
                                <MaterialSymbol
                                  name="do_not_disturb_on"
                                  size={15}
                                  filled
                                />
                                {t("radio_info.bands.released")}
                              </SwapLabel>
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <div className={METRIC_GRID}>
                        {/* Identity leads the grid: EARFCN and PCI together,
                            ahead of the readings, because confirming WHICH
                            cell this is comes before judging how it is doing.
                            RSSI removed by direct request — it had no 0-100
                            scale to plot and read as an afterthought next to
                            three real bars. */}
                        <IdentityMetricCell
                          arfcnLabel={arfcnLabel}
                          earfcn={c.earfcn}
                          pciLabel={t("radio_info.bands.detail.pci")}
                          pci={c.pci}
                        />
                        {c.metrics
                          .filter((m) => m.id !== "rssi")
                          .map((m, i) => (
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

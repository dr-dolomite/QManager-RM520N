"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import * as AccordionPrimitive from "@radix-ui/react-accordion";

import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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
// Active cellular bands
// =============================================================================
// One collapsible row per carrier. Collapsed it answers "which bands am I on";
// expanded it answers "how is this one doing" — the two questions a technician
// actually asks, in that order.
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
export const BAND_ROW_HEIGHT = 60;
export const BAND_SKELETON_ROWS = 3;

const CARD_SHELL =
  "@container/bands gap-4 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]";

/** Collapsed-row shell. Deliberately NEUTRAL — see the tone note below. */
const ROW_SHELL = "overflow-hidden rounded-tile bg-surface-container";

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
 * different rule. The collapsed row carries a STATUS chip (success / warning /
 * destructive), and every status role is itself a container fill. Sitting one
 * container fill on top of another is exactly the collision the CA card calls
 * out when it explains why its role chip is not a Badge — the chip stops
 * reading as a chip. Four full-bleed tinted rows would also make the card shout
 * before the user has picked anything to look at.
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
      <div className="flex items-start gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="ml-auto h-8 w-40 rounded-pill" />
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
// Metric row
// -----------------------------------------------------------------------------

function MetricRow({
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
    <div className="flex items-center gap-3.5">
      <span className="w-14 shrink-0 text-xs font-semibold text-on-surface-variant">
        {t(`radio_info.bands.metric.${labelKey}`)}
      </span>

      {metric.barless ? (
        // RSSI has no meaningful 0-100 scale, so it gets a caption where the
        // track would be rather than a bar that means nothing.
        <span className="flex-1 truncate text-xs text-on-surface-variant">
          {t("radio_info.bands.metric.rssi_caption")}
        </span>
      ) : metric.percent === null ? (
        // A null metric is NOT zero percent. A zero-width bar reads as "signal
        // is zero", which is a different and alarming claim about a value the
        // radio simply did not report — SCCs routinely report only a subset.
        <span className="flex-1 truncate text-xs text-on-surface-variant">
          {t("radio_info.bands.metric.not_reported")}
        </span>
      ) : (
        <div className="flex-1">
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
        </div>
      )}

      <span
        className={cn(
          "w-[86px] shrink-0 text-right font-mono text-[13px] font-semibold",
          // The `*-on-surface` ink steps, never the solid role tokens. The solid
          // pair measures 4.29:1 (success) and 3.74:1 (warning) on
          // `surface-container` in light mode — both below AA — which is why the
          // darkened steps exist at 5.88/5.95. The comp is internally
          // inconsistent here, tinting one value with the container ink and the
          // next with the solid role; do not follow it.
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
  );
}

// -----------------------------------------------------------------------------
// Detail pill
// -----------------------------------------------------------------------------

function DetailPill({
  label,
  children,
  mono = true,
  marker,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  /** Optional trailing affordance — the derived-SCS marker. */
  marker?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-pill bg-surface px-4 py-2">
      <dt className="text-xs font-semibold text-on-surface-variant">{label}</dt>
      <dd
        className={cn(
          "m-0 flex items-center gap-1.5 text-xs font-semibold",
          mono && "font-mono tabular-nums",
        )}
      >
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

  const mhz = (value: number | null) =>
    value === null
      ? t("radio_info.bands.detail.unknown")
      : t("radio_info.bands.units.mhz", { value });

  return (
    <Card className={CARD_SHELL}>
      {/* Header. No icon in the title — icons belong in chips and action areas. */}
      <div className="flex items-start gap-4">
        <div className="flex flex-col gap-1">
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
        /* ONE TickGroup for the whole card body: the group ranks only the
           values that actually moved this poll, so a cascade never opens with a
           dead beat for a figure that held. Values inside a collapsed row are
           unmounted and simply absent from the set. */
        <TickGroup>
          <TooltipProvider>
            <motion.div
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              {/* Radix, not the comp's `<div onClick>`. The comp gives its rows
                  no role, no tabIndex, no aria-expanded and no focus ring, so
                  keyboard users cannot reach a single band and a screen reader
                  announces the whole card as flat text. `type="single"
                  collapsible` also matches the comp's own `state={open:0}`.

                  `defaultValue` is the first carrier — the PCC, which is the row
                  a technician opens first. Keyed on `carrier.key`, so a wipe and
                  refill of `carrier_components[]` cannot silently move the open
                  row onto a different band. */}
              <Accordion
                type="single"
                collapsible
                defaultValue={carriers[0]?.key}
                className="flex flex-col gap-2"
              >
                {carriers.map((c) => {
                  const metricBase = c.released ? null : c.quality;
                  const chipVariant = c.released
                    ? "muted"
                    : qualityVariant(c.quality);
                  const chipText = c.released
                    ? t("radio_info.bands.released")
                    : t(`radio_info.bands.quality.${c.quality}`);

                  const arfcnText = [
                    c.duplex,
                    c.earfcn === null
                      ? null
                      : `${c.arfcnLabel} ${c.earfcn}`,
                  ]
                    .filter(Boolean)
                    .join(", ");

                  const sinr = c.metrics.find((m) => m.id === "sinr");
                  const showLowSnr =
                    !c.released &&
                    sinr !== undefined &&
                    sinr.value !== null &&
                    sinr.quality === "poor";

                  return (
                    /* Keyed on `carrier.key` (the carrierKey), NEVER an index
                       and NEVER PCI: on the live device both LTE carriers report
                       PCI 295, and an index key loses the open row's identity
                       across a wipe-and-refill. */
                    <AccordionItem
                      key={c.key}
                      value={c.key}
                      asChild
                      // Retires the primitive's `border-b` hairline: rows carry
                      // container fills now, and a divider between two filled
                      // tiles reads as a seam.
                      className={cn("border-0", ROW_SHELL)}
                    >
                      <motion.div variants={staggerRowItem}>
                        <AccordionPrimitive.Header className="flex">
                          {/* AccordionPrimitive.Trigger rather than the shipped
                              `AccordionTrigger`: that wrapper bakes in a lucide
                              ChevronDownIcon, and the Icon-Boundary Rule now puts
                              /cellular/ on Material Symbols. Its legacy
                              `rounded-md` would also have to be overridden. Every
                              Radix affordance (aria-expanded, focus management,
                              keyboard handling) is preserved. */}
                          <AccordionPrimitive.Trigger
                            className={cn(
                              "group flex flex-1 items-center gap-3 rounded-tile px-5 py-4 text-left outline-none",
                              "transition-[background-color,box-shadow] duration-(--duration-standard) ease-standard",
                              "hover:cursor-pointer hover:bg-surface-container-high",
                              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                            )}
                            style={{ minHeight: BAND_ROW_HEIGHT }}
                          >
                            <span className={ROLE_CHIP}>{roleLabel(c)}</span>

                            <Badge
                              variant={bandIdentityVariant(c)}
                              className="shrink-0 px-2.5 py-1 text-sm font-semibold"
                            >
                              {bandLabel(c)}
                            </Badge>

                            {arfcnText ? (
                              <span className="hidden font-mono text-[13px] text-on-surface-variant @md/bands:inline">
                                <TickingValue value={c.earfcn}>
                                  {arfcnText}
                                </TickingValue>
                              </span>
                            ) : null}

                            <span className="ml-auto flex shrink-0 items-center gap-2.5">
                              <Badge variant={chipVariant}>
                                {/* Glyph INSIDE the swap: it is the only
                                    greyscale channel between success and warning
                                    at 1.03:1, so it has to travel with the word
                                    it qualifies. Key encodes text AND variant,
                                    because both move together. */}
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

                              <MaterialSymbol
                                name="expand_more"
                                size={22}
                                className={cn(
                                  "text-on-surface-variant transition-transform",
                                  "duration-(--duration-standard) ease-standard",
                                  "motion-reduce:transition-none",
                                  "group-data-[state=open]:rotate-180",
                                )}
                              />
                            </span>
                          </AccordionPrimitive.Trigger>
                        </AccordionPrimitive.Header>

                        {/* Expand gesture. There is NO expand/collapse recipe in
                            the motion canon, so this is authored: Radix's
                            `--radix-accordion-content-height` driving
                            tw-animate-css's accordion keyframes, retargeted off
                            their 200ms/ease-out default onto the system's
                            `emphasized` pair (400ms + cubic-bezier(.05,.7,.1,1)),
                            which is the comp's own `qm-expand` curve.

                            ⚠ SECOND EXCEPTION TO THE TRANSFORM-ONLY RULE. The CA
                            chain's `width` was the only documented one. Height is
                            the exception here for the same reason: a scaleY
                            expand squashes every child's type and radius on the
                            way open, and a clip-path expand leaves the collapsed
                            row reserving its expanded height in layout. `height`
                            is the only mechanism that both reveals and reflows.
                            It is a one-shot user-initiated gesture on at most one
                            row at a time, not a per-poll animation.

                            A raw CSS `animation:` class is safe HERE and nowhere
                            else on this card: Radix mounts and unmounts the
                            content, so the keyframe runs on mount rather than
                            replaying on every 2s repoll. That is the documented
                            bug class the row/fill entrances avoid by using motion
                            variants and `MetricBar`'s open-ended `.ca-meter`-style
                            construction instead. */}
                        <AccordionPrimitive.Content
                          className={cn(
                            "overflow-hidden",
                            "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
                            "duration-(--duration-emphasized) ease-emphasized",
                            "motion-reduce:animate-none",
                          )}
                        >
                          <div className="flex flex-col gap-3.5 px-5 pt-0.5 pb-5">
                            {/* Metric block. `bg-surface` is a real token — the
                                comp's `oklch(1 0 0 / 0.55)` is white-at-alpha
                                over a tinted container, which the
                                Solid-Container Rule bans: it is a stable
                                mid-grey in light mode and a near-white blowout
                                in dark, and its contrast ratio is not even
                                computable. Same for the comp's
                                `oklch(0.20 0.05 262 / 0.12)` bar track, which is
                                `surface-container-high` here. */}
                            <div className="flex flex-col gap-2.5 rounded-tile bg-surface p-4">
                              {c.metrics.map((m, i) => (
                                <MetricRow
                                  key={m.id}
                                  metric={m}
                                  technology={c.technology}
                                  index={i}
                                />
                              ))}
                            </div>

                            {showLowSnr && sinr ? (
                              /* Threshold-triggered, and it states the READING
                                 only. The comp went on to claim "the scheduler
                                 may drop it under load" — QManager has no
                                 visibility into scheduler behaviour and cannot
                                 verify that, so the causal half is cut. */
                              <div className="flex items-start gap-3 rounded-field bg-destructive-container px-4 py-3 text-on-destructive-container">
                                <MaterialSymbol
                                  name="warning"
                                  size={19}
                                  filled
                                  className="shrink-0"
                                />
                                <p className="text-xs leading-relaxed">
                                  {t("radio_info.bands.low_snr", {
                                    value: sinr.value,
                                  })}
                                </p>
                              </div>
                            ) : null}

                            {c.released && c.releasedForMs !== null ? (
                              <div className="flex items-start gap-3 rounded-field bg-surface-container-high px-4 py-3 text-on-surface-variant">
                                <MaterialSymbol
                                  name="info"
                                  size={19}
                                  className="shrink-0"
                                />
                                <p className="text-xs leading-relaxed">
                                  {t("radio_info.bands.released_note", {
                                    seconds: Math.round(
                                      c.releasedForMs / 1000,
                                    ),
                                  })}
                                </p>
                              </div>
                            ) : null}

                            <dl className="m-0 grid grid-cols-1 gap-1.5 @md/bands:grid-cols-2">
                              <DetailPill
                                label={t(
                                  "radio_info.bands.detail.band_name",
                                )}
                                mono={false}
                              >
                                {c.bandName ??
                                  t("radio_info.bands.detail.unknown")}
                              </DetailPill>

                              {/* `bandwidthMhz: null` is an unrecognised enum,
                                  not a zero-width carrier. "0 MHz" would be a
                                  claim the modem never made. */}
                              <DetailPill
                                label={t(
                                  "radio_info.bands.detail.bandwidth",
                                )}
                              >
                                {mhz(c.bandwidthMhz)}
                              </DetailPill>

                              <DetailPill
                                label={t(
                                  "radio_info.bands.detail.dl_frequency",
                                )}
                              >
                                {c.dlFrequencyMhz === null
                                  ? t("radio_info.bands.detail.unknown")
                                  : t("radio_info.bands.units.mhz", {
                                      value: c.dlFrequencyMhz.toFixed(2),
                                    })}
                              </DetailPill>

                              <DetailPill
                                label={t(
                                  "radio_info.bands.detail.ul_frequency",
                                )}
                              >
                                {c.ulFrequencyMhz === null
                                  ? t("radio_info.bands.detail.unknown")
                                  : t("radio_info.bands.units.mhz", {
                                      value: c.ulFrequencyMhz.toFixed(2),
                                    })}
                              </DetailPill>

                              <DetailPill
                                label={t("radio_info.bands.detail.pci")}
                              >
                                {c.pci === null
                                  ? t("radio_info.bands.detail.unknown")
                                  : c.pci}
                              </DetailPill>

                              {c.technology === "NR" ? (
                                <DetailPill
                                  label={t("radio_info.bands.detail.scs")}
                                  marker={
                                    // Only the carrier matching the serving NR
                                    // cell has a modem-reported SCS. Every other
                                    // NR carrier's is derived from its band's
                                    // duplex mode, and showing an inference as if
                                    // it were reported would be the page lying
                                    // quietly. The marker is focusable so the
                                    // explanation is reachable by keyboard.
                                    c.scsInferred ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-1 rounded-pill text-on-surface-variant outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                          >
                                            {/* `text-xs` — the Label step. The
                                                marker is subordinated by ink
                                                and case, not by shrinking off
                                                the ramp. */}
                                            <span className="text-xs font-semibold tracking-wide uppercase">
                                              {t(
                                                "radio_info.bands.detail.scs_derived",
                                              )}
                                            </span>
                                            <MaterialSymbol
                                              name="help"
                                              size={14}
                                            />
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
                                  {c.scsKhz === null
                                    ? t("radio_info.bands.detail.unknown")
                                    : t("radio_info.bands.units.khz", {
                                        value: c.scsKhz,
                                      })}
                                </DetailPill>
                              ) : null}
                            </dl>
                          </div>
                        </AccordionPrimitive.Content>
                      </motion.div>
                    </AccordionItem>
                  );
                })}
              </Accordion>
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

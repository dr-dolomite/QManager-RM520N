"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickGroup } from "@/components/ui/tick-group";
import { cn } from "@/lib/utils";

import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";
import { TickingValue } from "@/components/ui/ticking-value";
import { getValueColorClass } from "./signal-card-utils";
import { staggerRows, staggerRowItem } from "@/lib/motion";

/** Which radio leg this card describes. Drives the identity tone only: blue is
 *  the 5G NR leg, violet the 4G LTE leg. Neither ever acts as a control. */
export type RadioFamily = "nr" | "lte";

/**
 * The quality chip's FILL carries radio identity; its GLYPH carries quality.
 *
 * The chip is toned by RAT — blue for NR, violet for LTE — so the two cards are
 * told apart at a glance from across a room, which is the split the paired
 * layout is for. Quality then has to live somewhere else entirely, and it lives
 * in the bar count: five distinct glyphs, monotonically decreasing, legible in
 * greyscale and under deuteranopia. That is a stronger channel than the fill
 * ever was — `success-container` and `warning-container` measure 1.03:1 apart,
 * so the old quality-toned chip was already leaning on its icon to be read.
 *
 * Consequence worth stating: this chip is NOT a status chip. The five status
 * roles in `badge.tsx` remain the only correct choice for an actual status
 * indicator; `nr`/`lte` are identity roles and never mean "healthy".
 */
/*
 * The `signal_cellular_{1..4}_bar` wedge family, NOT the `signal_cellular_alt*`
 * bar family the mock draws. The mock only ever rendered Excellent and Good, so
 * it never exposed what the alt family does at the bottom: `alt_1_bar` is a
 * single 120×240-unit mark (~2×4px at size 16, indistinguishable from a failed
 * icon load), and there is no `alt_0_bar` at all — Poor and None have to fall
 * back to full-size wedges, which makes ink mass go large → medium → speck →
 * large → large. Quality would read as non-monotone, and since the chip fill
 * was reassigned to radio identity, the bar count is the ONLY channel left
 * carrying it. The wedge family keeps one constant silhouette and grows the
 * solid fill, so every rung shares a footprint and scans as a meter.
 */
function getQualityGlyph(quality: string): MaterialSymbolName {
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

/** Returns the state dot's fill plus the `signal_card` key for its label. */
function getStateDisplay(state: string) {
  switch (state) {
    case "connected":
      return { dot: "bg-success", key: "connected" };
    case "disconnected":
      return { dot: "bg-destructive", key: "disconnected" };
    case "searching":
      return { dot: "bg-warning", key: "searching" };
    case "limited":
      return { dot: "bg-warning", key: "limited_service" };
    case "inactive":
      return { dot: "bg-on-surface-variant", key: "inactive" };
    default:
      return { dot: "bg-on-surface-variant", key: "unknown" };
  }
}

export interface SignalStatusRow {
  label: string;
  value: string;
  /** Raw numeric value — enables quality-based color coding */
  rawValue?: number | null;
  /** Threshold set to use for color coding (RSRP, RSRQ, or SINR) */
  thresholds?: SignalThresholds;
  /** Render the value as an identity-toned pill rather than plain ink. Used for
   *  the band, which is an identifier rather than a measurement. */
  asIdentity?: boolean;
}

interface SignalStatusCardProps {
  title: string;
  state: string;
  rsrp: number | null;
  rows: SignalStatusRow[];
  isLoading: boolean;
  family: RadioFamily;
}

export function SignalStatusCard({
  title,
  state,
  rsrp,
  rows,
  isLoading,
  family,
}: SignalStatusCardProps) {
  const { t } = useTranslation("dashboard");
  const stateDisplay = getStateDisplay(state);
  const isInactive = state === "inactive";
  const quality = isInactive ? "none" : getSignalQuality(rsrp, RSRP_THRESHOLDS);
  const identityVariant = family === "nr" ? "nr" : "lte";

  const identityTone =
    family === "nr"
      ? "bg-primary-container text-on-primary-container"
      : "bg-lte-container text-on-lte-container";

  if (isLoading) {
    return (
      <Card className="gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]">
        {/* Every height here is the loaded element's LINE BOX, not its font
            size — a skeleton sized to the glyph reflows the moment real text
            lands. Title: `text-lg` is 18px on a 28px line box. */}
        <Skeleton className="h-7 w-40" />
        <div className="flex items-center justify-between gap-3">
          {/* 38px: `text-sm` 20px + `gap-0.5` 2px + `text-xs` 16px. */}
          <div className="grid gap-0.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* 30px: 1px border + `py-1.5` 6px + a 16px content box + 6 + 1. The
              content box is 16px because `text-xs` carries a 1rem line-height —
              it was 16px before the glyph swap too, so neither the old lucide
              `size-3` nor the new 16px Material glyph ever drove this height.
              Hence the literal value: no Tailwind step lands on 30px. */}
          <Skeleton className="h-[30px] w-24 rounded-pill" />
        </div>
        {/* Mirrors the loaded geometry exactly — same row count, same pill
            radius — so nothing reflows when data lands. Rows stay 40px:
            `text-[13px]/5` pins the line box to 20px and `py-2.5` adds 10px on
            each side, which is why the arbitrary font-size carries an explicit
            leading rather than inheriting one. */}
        <div className="grid gap-1.5">
          {Array.from({ length: rows.length || 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-pill" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]">
      <h3 className="text-lg font-semibold">{title}</h3>

      <div className="flex items-center justify-between gap-3">
        {/* `min-w-0` + `truncate`: these two cards sit side by side, and neither
            the heading nor the state label can wrap without one card's header
            growing to two lines while its sibling stays at one — the paired
            baseline breaks and the pair stops reading as a pair. Italian is the
            case that trips it ("Potenza del segnale" over "Nessun segnale"). */}
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-semibold">
            {t("signal_card.strength_heading")}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-on-surface-variant">
            <span
              className={cn(
                "size-2 shrink-0 rounded-pill transition-colors duration-(--duration-standard) ease-standard",
                stateDisplay.dot,
              )}
              aria-hidden
            />
            <span className="truncate">
              {t(`signal_card.${stateDisplay.key}`)}
            </span>
          </span>
        </div>

        {/* Identity fill, quality glyph. The bar count is what survives
            greyscale, deuteranopia, and a fill washed out by direct sun — and
            now it is the ONLY channel carrying quality, since the fill is
            pinned to the radio. `size={16}` is explicit because MaterialSymbol
            sets fontSize inline and Badge's `[&>svg]:size-3` cannot reach it. */}
        <Badge
          variant={identityVariant}
          // No transition here: `badge.tsx` now writes the two-clock longhand
          // (fill and ink on `standard`, focus ring on `quick`) for every
          // Badge. A `transition-colors` utility layered on top would re-declare
          // transition-property and silently drop the ring's separate clock.
          className="shrink-0 px-3 py-1.5 font-semibold"
        >
          {/* The container half was running solo: the fill morphs over
              `standard` on a RAT handover and the glyph changes with quality,
              but the contents themselves snapped — the exact inverse of the bug
              `badge.tsx` already fixed on the fill. `SwapLabel` supplies the
              `quick` label leg, keyed on BOTH axes because either can move
              independently (a handover changes the fill, a fade changes the
              bars). `size={16}` is doubly required here: MaterialSymbol carries
              its size as an inline fontSize, and the swap wrapper puts the glyph
              one level deeper than Badge's `[&>svg]:size-3` can reach. */}
          <SwapLabel swapKey={`${identityVariant}-${quality}`} className="gap-1">
            <MaterialSymbol name={getQualityGlyph(quality)} size={16} filled />
            {t(`signal_card.quality_${quality}`)}
          </SwapLabel>
        </Badge>
      </div>

      {/* The rows are a single-column grid (`grid` with no `grid-cols-*`), so
          document order IS top-to-bottom reading order and `TickGroup` needs no
          axis or index prop — it ranks the values that moved this poll by their
          live DOM position. Mounted outside the `motion.dl` for readability
          rather than out of necessity: `TickGroup` renders no DOM and publishes
          only its own React context, and motion/react resolves a child's
          variant parent through `useContext(MotionContext)` rather than by
          direct-child adjacency, so an intervening plain provider is
          transparent to `staggerRows` → `staggerRowItem` either way.
          The band row takes the identity-pill branch below and mounts no tick at
          all; because ranking sorts live nodes rather than map indices, it is
          simply absent from the set and the cascade opens on the first real
          measurement instead of on a silent slot. */}
      <TickGroup>
        <motion.dl
          className="grid gap-1.5"
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          {rows.map((row) => {
            // Only measurement rows carry a tint. Band/ARFCN/PCI/SCS are
            // identifiers with no good-or-bad reading, so they must not get a
            // quality word announced after them.
            const isTinted = row.rawValue != null && row.thresholds != null;
            const rowQuality = isTinted
              ? getSignalQuality(row.rawValue!, row.thresholds!)
              : "none";
            const valueColor = getValueColorClass(rowQuality);

            return (
              <motion.div
                key={row.label}
                variants={staggerRowItem}
                className="flex items-center justify-between gap-3 rounded-pill bg-surface-container px-4 py-2.5"
              >
                {/* 13px/600 per the mock. The `/5` pins line-height to 20px so
                    the row stays exactly 40px tall and the skeleton's `h-10`
                    keeps matching — an arbitrary font-size would otherwise
                    inherit whatever leading the card sits in. */}
                <dt className="text-[13px]/5 font-semibold text-on-surface-variant">
                  {row.label}
                </dt>
                {/* An identity pill wrapping a placeholder dash reads as a broken
                    chip rather than as absent data, so a missing band falls back
                    to plain ink. */}
                {row.asIdentity && row.value !== "-" ? (
                  // The band is an identifier, not a measurement: it changes on a
                  // handover, not on a poll. So it takes the container morph
                  // (`standard`) and NOT the live tick — dipping a value that
                  // holds steady for minutes would invent an event.
                  <dd
                    className={cn(
                      "m-0 shrink-0 rounded-pill px-2.5 py-1 font-mono text-xs font-semibold transition-colors duration-(--duration-standard) ease-standard",
                      identityTone,
                    )}
                  >
                    {row.value}
                  </dd>
                ) : (
                  // Measurements, and the reason this card needed the tick at
                  // all: RSRP/RSRQ/SINR redraw every ~2s. Without the dip the
                  // digits change with no acknowledgement at all, which is why
                  // the card read as static despite the new tonal surfaces. Ink
                  // colour is the `quick` clock; only containers get `standard`.
                  <dd
                    className={cn(
                      "m-0 font-mono text-[13px]/5 font-semibold transition-colors duration-(--duration-quick) ease-quick",
                      valueColor,
                    )}
                  >
                    {/* Keyed on the rendered string rather than `rawValue`: the
                        quality thresholds mean a raw RSRP can drift by a tenth
                        of a dB every poll and format to the same text, and a dip
                        on an unchanged reading is the tick announcing nothing.
                        `tabular-nums` is baked into TickingValue. */}
                    <TickingValue value={row.value}>{row.value}</TickingValue>
                    {/* The tint is the only thing separating a "good" SINR from a
                        "fair" one, and `success-on-surface` vs
                        `warning-on-surface` measure ~1.01:1 apart — same
                        luminance, hue only, and they converge under
                        deuteranopia. The word restores the meaning in greyscale
                        and to a screen reader. */}
                    {isTinted && (
                      <span className="sr-only">
                        {" "}
                        {t(`signal_card.quality_${rowQuality}`)}
                      </span>
                    )}
                  </dd>
                )}
              </motion.div>
            );
          })}
        </motion.dl>
      </TickGroup>
    </Card>
  );
}

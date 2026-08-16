"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Tag, type TagVariant } from "@/components/ui/tag";
import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  QUALITY_GLYPH,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickGroup } from "@/components/ui/tick-group";
import { cn } from "@/lib/utils";

import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
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
 * The glyph ladder is the canonical `QUALITY_GLYPH`, imported rather than
 * restated. It was a private copy here, and the copy had already gone wrong:
 * its `default:` arm sent the new `bad` stop to `signal_cellular_off`, putting
 * "the antenna is pointing at a wall" and "nothing was measured" behind one
 * glyph — on the one chip where the glyph is the ONLY channel carrying quality,
 * because the fill is pinned to radio identity.
 *
 * The rationale for the family choice lives with the map now. In short: the
 * `signal_cellular_{0..4}_bar` wedges, never `signal_cellular_alt*` — `alt` has
 * no 0-bar member and its 1-bar mark is a ~2×4px speck, so ink mass would run
 * large → medium → speck → large and quality would read as non-monotone.
 */

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
  /** Plain-ink identifier that isn't pill-worthy (EARFCN, PCI, SCS): keeps
   *  font-mono without the asIdentity pill treatment band gets. */
  isIdentifier?: boolean;
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
  // Identity renders as an OUTLINE TAG on both of this card's identity slots —
  // the header chip and the band pill. It was two filled `*-container` blocks,
  // which the Data-Ink Rule forbids for identity: identity is ink, outline and
  // disc only, never a large tinted block. See DESIGN.md > The three layers.
  const identityVariant: TagVariant = family === "nr" ? "nr" : "lte";

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
        <Tag
          variant={identityVariant}
          // No transition here: `tag.tsx` writes the two-clock longhand (ink
          // and BORDER on `standard`, focus ring on `quick`). A
          // `transition-colors` utility layered on top would re-declare
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
            <MaterialSymbol name={QUALITY_GLYPH[quality]} size={16} filled />
            {t(`signal_card.quality_${quality}`)}
          </SwapLabel>
        </Tag>
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
            // Untinted rows pass NO class at all. `getValueColorClass` used to
            // return `""` for everything it didn't recognise, so an identifier
            // row happened to inherit the card's ink; on the ramp, `none` is a
            // real token (`on-surface-variant`, "we have no reading") and
            // handing it to a PCI would grey out a perfectly good identifier.
            const valueColor = isTinted
              ? getValueColorClass(rowQuality)
              : undefined;
            // The bar half of the ramp. Derived from the SAME `rowQuality` the
            // ink is, so length and hue can never disagree, and only ever for a
            // tinted row — an ARFCN has no position on a quality scale, so it
            // gets no gauge and no ink.
            const rowTone = isTinted ? qualityMeterTone(rowQuality) : null;
            const rowPercent =
              rowTone === null
                ? null
                : signalToProgress(row.rawValue!, row.thresholds!);

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
                  // `asChild` so the tag IS the <dd> rather than wrapping one —
                  // a <span> inside a <dd> would be a redundant box, and the
                  // definition-list semantics have to survive the form swap.
                  // The transition lives in `tag.tsx`'s longhand now.
                  <Tag asChild variant={identityVariant}>
                    <dd className="m-0 shrink-0 px-2.5 py-1 font-mono text-xs font-semibold">
                      {row.value}
                    </dd>
                  </Tag>
                ) : (
                  // Measurements, and the reason this card needed the tick at
                  // all: RSRP/RSRQ/SINR redraw every ~2s. Without the dip the
                  // digits change with no acknowledgement at all, which is why
                  // the card read as static despite the new tonal surfaces. Ink
                  // colour is the `quick` clock; only containers get `standard`.
                  <dd
                    className={cn(
                      "m-0 flex items-center gap-2.5 text-[13px]/5 font-semibold transition-colors duration-(--duration-quick) ease-quick",
                      row.isIdentifier && "font-mono",
                      valueColor,
                    )}
                  >
                    {/* THE GAUGE IS WHAT MAKES THE INK LEGAL. Adjacent ramp
                        stops sit BELOW the 0.05 CVD separation floor by design,
                        on the explicit understanding that bar LENGTH carries the
                        fine distinctions — so a tinted figure without a bar is
                        a bug, not a shortcut (DESIGN.md > Quality bars).

                        It is a 56px lane INSIDE the `dd`, not a row of its own.
                        Two reasons, both load-bearing: the row is pinned at 40px
                        and the skeleton mirrors it with `h-10`, so a second line
                        would silently break that mirror; and `dl > div > dt/dd`
                        is the valid definition-list shape, so the `dd` has to
                        stay a direct child of the wrapper rather than getting
                        nested inside a new flex box. A 4px bar in a 20px line
                        box changes no height. */}
                    {isTinted && (
                      <div className="w-14 shrink-0" aria-hidden="true">
                        <MetricBar
                          value={rowPercent}
                          max={100}
                          // Unreachable — `colorOverride` pins the tone. Present
                          // only because the props are required.
                          warnAt={101}
                          dangerAt={101}
                          // Null passes straight through; never a fallback
                          // colour. No reading means no fill element at all.
                          colorOverride={rowTone}
                          // 4px, the quality-bar spec.
                          size="sm"
                          // `-high`, not `surface-container`: the row pill is
                          // already `bg-surface-container`, so a same-step track
                          // would be invisible against it.
                          track="surface-container-high"
                        />
                      </div>
                    )}
                    {/* Fixed width and right-aligned ONLY on tinted rows, so the
                        gauges line up in a column instead of jittering with the
                        width of each figure. Identifiers keep their natural
                        width — an ARFCN is longer than "8 dB" and must not be
                        clipped to match it. */}
                    <span
                      className={cn(isTinted && "w-[4.75rem] text-right")}
                    >
                      {/* Keyed on the rendered string rather than `rawValue`: the
                          quality thresholds mean a raw RSRP can drift by a tenth
                          of a dB every poll and format to the same text, and a dip
                          on an unchanged reading is the tick announcing nothing.
                          `tabular-nums` is baked into TickingValue. */}
                      <TickingValue value={row.value}>{row.value}</TickingValue>
                    </span>
                    {/* The third channel. The bar and the ink both fail in
                        greyscale-plus-low-vision together, and neither reaches a
                        screen reader at all. Never drop it from a tinted row. */}
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

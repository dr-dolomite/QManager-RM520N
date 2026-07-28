"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  SignalIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SignalZeroIcon,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

function getSignalIcon(quality: string) {
  switch (quality) {
    case "excellent":
      return SignalIcon;
    case "good":
      return SignalHighIcon;
    case "fair":
      return SignalMediumIcon;
    case "poor":
      return SignalLowIcon;
    default:
      return SignalZeroIcon;
  }
}

/**
 * Quality chips carry the functional four, not the radio family's hue.
 *
 * The source mock tinted this chip with the RAT identity colour, which would
 * make an "Excellent" chip and a "Good" chip differ by radio rather than by
 * quality — the chip's own fill contradicting its own label. Quality is a
 * status, so it reads on the status palette; the band pill below keeps the
 * identity hue, where identity belongs.
 */
function getQualityBadgeVariant(quality: string): BadgeVariant {
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
  const QualityIcon = getSignalIcon(quality);

  const identityTone =
    family === "nr"
      ? "bg-primary-container text-on-primary-container"
      : "bg-lte-container text-on-lte-container";

  if (isLoading) {
    return (
      <Card className="gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]">
        <Skeleton className="h-6 w-40" />
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-24 rounded-pill" />
        </div>
        {/* Mirrors the loaded geometry exactly — same row count, same pill
            radius — so nothing reflows when data lands. */}
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
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold">
            {t("signal_card.strength_heading")}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <span
              className={cn(
                "size-2 shrink-0 rounded-pill transition-colors duration-(--duration-standard) ease-standard",
                stateDisplay.dot,
              )}
              aria-hidden
            />
            {t(`signal_card.${stateDisplay.key}`)}
          </span>
        </div>

        {/* The glyph changes with the colour: it is what survives greyscale,
            deuteranopia, and a fill washed out by direct sun. */}
        <Badge
          variant={getQualityBadgeVariant(quality)}
          // No transition here: `badge.tsx` now writes the two-clock longhand
          // (fill and ink on `standard`, focus ring on `quick`) for every
          // Badge. A `transition-colors` utility layered on top would re-declare
          // transition-property and silently drop the ring's separate clock.
          className="shrink-0 px-3 py-1.5"
        >
          <QualityIcon aria-hidden />
          {t(`signal_card.quality_${quality}`)}
        </Badge>
      </div>

      <motion.dl
        className="grid gap-1.5"
        variants={staggerRows}
        initial="hidden"
        animate="visible"
      >
        {rows.map((row) => {
          const rowQuality =
            row.rawValue != null && row.thresholds
              ? getSignalQuality(row.rawValue, row.thresholds)
              : "none";
          const valueColor = getValueColorClass(rowQuality);

          return (
            <motion.div
              key={row.label}
              variants={staggerRowItem}
              className="flex items-center justify-between gap-3 rounded-pill bg-surface-container px-4 py-2.5"
            >
              <dt className="text-sm font-medium text-on-surface-variant">
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
                    "m-0 font-mono text-sm font-semibold transition-colors duration-(--duration-quick) ease-quick",
                    valueColor,
                  )}
                >
                  {/* Keyed on the rendered string rather than `rawValue`: the
                      quality thresholds mean a raw RSRP can drift by a tenth
                      of a dB every poll and format to the same text, and a dip
                      on an unchanged reading is the tick announcing nothing.
                      `tabular-nums` is baked into TickingValue. */}
                  <TickingValue value={row.value}>{row.value}</TickingValue>
                </dd>
              )}
            </motion.div>
          );
        })}
      </motion.dl>
    </Card>
  );
}

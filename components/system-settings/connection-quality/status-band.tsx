"use client";

import type * as React from "react";
import {
  CircleDashedIcon,
  CircleSlashIcon,
  GaugeIcon,
  GlobeIcon,
  MilestoneIcon,
  PackageCheckIcon,
  PackageXIcon,
  RefreshCwIcon,
  RouteIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { PingProfileTargets } from "@/hooks/use-ping-profile";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  ConnectivityState,
  ConnectivityStatus,
  QualityThresholdsSettings,
} from "@/types/modem-status";

import {
  BAND,
  CAPTION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  HOSTNAME_LEGS,
  PRESET_LIMIT,
  RING,
  RING_WRAP,
  SKELETON,
  SLOT_ORDER,
  TARGET_LINE,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "./shapes";

const K = "connection_quality.band";

/**
 * Each tile's face is keyed off ONE state union rather than off three
 * independent ternaries, so the value, the caption and the disc cannot answer
 * the same question differently. Every state carries its own glyph.
 */
interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
}

/** Bound to the poller's own verdict union, so a sixth state fails the build. */
const INTERNET_FACE = {
  connected: { tone: "success", glyph: GlobeIcon },
  degraded: { tone: "warning", glyph: TriangleAlertIcon },
  disconnected: { tone: "destructive", glyph: WifiOffIcon },
  // `primary` says the watchdog is working the problem — never that it is well.
  recovery: { tone: "primary", glyph: RefreshCwIcon },
  unknown: { tone: "neutral", glyph: CircleDashedIcon },
} satisfies Record<ConnectivityState, Face>;

/**
 * A measurement against its SAVED cut. Binary by design: a tile has no room for
 * a quality bar, and the five-stop ramp may not travel without one.
 */
type MeasureState = "unknown" | "within" | "over";

const LATENCY_FACE = {
  unknown: { tone: "neutral", glyph: CircleDashedIcon },
  within: { tone: "neutral", glyph: GaugeIcon },
  over: { tone: "warning", glyph: TriangleAlertIcon },
} satisfies Record<MeasureState, Face>;

const LOSS_FACE = {
  unknown: { tone: "neutral", glyph: CircleDashedIcon },
  within: { tone: "neutral", glyph: PackageCheckIcon },
  over: { tone: "warning", glyph: PackageXIcon },
} satisfies Record<MeasureState, Face>;

type LegState = "hostname" | "fallback" | "none";

/** A fallback leg answering is the visible signature of a broken resolver. */
const LEG_FACE = {
  hostname: { tone: "primary", glyph: RouteIcon },
  fallback: { tone: "warning", glyph: MilestoneIcon },
  none: { tone: "neutral", glyph: CircleSlashIcon },
} satisfies Record<LegState, Face>;

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  eyebrow: string;
  caption: React.ReactNode;
  /** The Internet tile's ambient ring — armed only while the probe reports. */
  live?: boolean;
  /** The non-chromatic half of a toned disc, for assistive technology. */
  srNote?: string;
  children: React.ReactNode;
}

function Tile({
  glyph: Glyph,
  tone,
  eyebrow,
  caption,
  live = false,
  srNote,
  children,
}: TileProps): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={RING_WRAP}>
        {live ? <span aria-hidden className={RING} /> : null}
        <span
          className={cn(
            TILE.DISC,
            DISC_TRANSITION,
            DISC_TONE[tone],
            "relative",
          )}
        >
          <Glyph className={TILE.GLYPH} aria-hidden="true" />
        </span>
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{children}</span>
        {srNote ? <span className="sr-only">{srNote}</span> : null}
        <span className={CAPTION}>{caption}</span>
      </div>
    </motion.div>
  );
}

function TileSkeleton(): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <Skeleton className={SKELETON.TILE.DISC} />
      <div className={TILE.TEXT}>
        <Skeleton className={cn(SKELETON.TILE.EYEBROW, "w-24")} />
        <Skeleton className={cn(SKELETON.TILE.VALUE, "w-28")} />
        <Skeleton className={cn(SKELETON.TILE.CAPTION, "w-36")} />
      </div>
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// Derivation
// -----------------------------------------------------------------------------

/**
 * A reading against a saved cut. `null` on either side is UNKNOWN, never
 * healthy — an unloaded threshold cannot make a disc warn, and a null
 * measurement means the window is too short to express one.
 */
function measure(
  value: number | null,
  limit: number | undefined,
  flagsAtLimit: boolean,
): MeasureState {
  if (value === null) return "unknown";
  if (limit === undefined) return "within";
  const over = flagsAtLimit ? value >= limit : value > limit;
  return over ? "over" : "within";
}

/**
 * Which leg answered. `ping_target` falls back to the first configured slot
 * when nothing has answered yet, so a match alone is not proof — the daemon's
 * own reachability verdict has to agree.
 */
function legState(
  conn: ConnectivityStatus | undefined,
  targets: PingProfileTargets | undefined,
): { state: LegState; index: number } {
  if (!conn || !targets || conn.internet_available !== true) {
    return { state: "none", index: -1 };
  }
  if (conn.last_family === "none") return { state: "none", index: -1 };

  const index = SLOT_ORDER.findIndex(
    (slot) => targets[slot] !== "" && targets[slot] === conn.ping_target,
  );
  if (index < 0) return { state: "none", index: -1 };
  return { state: index < HOSTNAME_LEGS ? "hostname" : "fallback", index };
}

// -----------------------------------------------------------------------------
// Band
// -----------------------------------------------------------------------------

export interface StatusBandProps {
  /** The SAVED probe slots. `undefined` until the profile GET lands. */
  targets: PingProfileTargets | undefined;
  /** The SAVED presets. `undefined` until the thresholds GET lands. */
  thresholds: QualityThresholdsSettings | undefined;
}

export function StatusBand({
  targets,
  thresholds,
}: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { data, isLoading } = useModemStatus();

  const conn = data?.connectivity;
  const state: ConnectivityState = conn?.status ?? "unknown";

  // --- Internet ------------------------------------------------------------
  const internetFace = INTERNET_FACE[state];
  const internetCaption =
    state === "unknown"
      ? t(`${K}.internet.caption_unknown`)
      : t(`${K}.internet.caption_cadence`, {
          seconds: conn?.history_interval_sec ?? 0,
        });

  // --- Round trip ----------------------------------------------------------
  const latency = conn?.latency_ms ?? null;
  const latencyLimit = thresholds
    ? PRESET_LIMIT.latency[thresholds.latency.preset].limit
    : undefined;
  // events.sh flags latency ABOVE the cut and loss AT it; both mirrored here.
  const latencyState = measure(latency, latencyLimit, false);

  const avg = conn?.avg_latency_ms ?? null;
  const min = conn?.min_latency_ms ?? null;
  const max = conn?.max_latency_ms ?? null;
  const latencyCaption =
    avg === null || min === null || max === null
      ? t(`${K}.latency.caption_none`)
      : t(`${K}.latency.caption`, {
          avg: Math.round(avg),
          min: Math.round(min),
          max: Math.round(max),
        });

  // --- Packet loss ---------------------------------------------------------
  // NEVER `??` a 0 in: a null here means the window is under the poller's
  // ten-sample floor, which is "not measured", not "measured, and perfect".
  const loss = conn?.packet_loss_pct ?? null;
  const lossLimit = thresholds
    ? PRESET_LIMIT.loss[thresholds.loss.preset].limit
    : undefined;
  const lossState = measure(loss, lossLimit, true);
  const lossCaption =
    loss === null
      ? t(`${K}.loss.caption_none`)
      : t(`${K}.loss.caption`, { samples: conn?.latency_history.length ?? 0 });

  // --- Answering leg -------------------------------------------------------
  const leg = legState(conn, targets);
  const legFace = LEG_FACE[leg.state];
  const legNote =
    leg.state === "hostname"
      ? t(`${K}.leg.caption_hostname`)
      : leg.state === "fallback"
        ? t(`${K}.leg.caption_fallback`)
        : t(`${K}.leg.caption_none`);
  // A poller predating the ICMP port sends no family at all. Absence is not a
  // value, so the tag is simply not rendered rather than reported as "None".
  const familyKey =
    conn?.last_family === "ipv4"
      ? `${K}.leg.family_ipv4`
      : conn?.last_family === "ipv6"
        ? `${K}.leg.family_ipv6`
        : conn?.last_family === "none"
          ? `${K}.leg.family_none`
          : null;

  return (
    <div>
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.head`)}</span>
      </div>

      <motion.div className={TILE.GRID} variants={staggerRows}>
        {isLoading ? (
          <>
            <TileSkeleton />
            <TileSkeleton />
            <TileSkeleton />
            <TileSkeleton />
          </>
        ) : (
          // Only the two MEASUREMENTS tick. The verdict word and the probe
          // target hold steady for minutes, so dipping them invents an event.
          <TickGroup>
            <Tile
              glyph={internetFace.glyph}
              tone={internetFace.tone}
              eyebrow={t(`${K}.internet.eyebrow`)}
              caption={internetCaption}
              live={state !== "unknown"}
            >
              <span className={VALUE_TEXT}>{t(`${K}.internet.${state}`)}</span>
            </Tile>

            <Tile
              glyph={LATENCY_FACE[latencyState].glyph}
              tone={LATENCY_FACE[latencyState].tone}
              eyebrow={t(`${K}.latency.eyebrow`)}
              caption={latencyCaption}
            >
              <TickingValue value={latency} className={VALUE_TEXT}>
                {latency === null
                  ? VALUE_NONE
                  : t(`${K}.latency.value`, { ms: Math.round(latency) })}
              </TickingValue>
            </Tile>

            <Tile
              glyph={LOSS_FACE[lossState].glyph}
              tone={LOSS_FACE[lossState].tone}
              eyebrow={t(`${K}.loss.eyebrow`)}
              caption={lossCaption}
            >
              <TickingValue value={loss} className={VALUE_TEXT}>
                {loss === null
                  ? VALUE_NONE
                  : t(`${K}.loss.value`, { pct: loss })}
              </TickingValue>
            </Tile>

            <Tile
              glyph={legFace.glyph}
              tone={legFace.tone}
              eyebrow={t(`${K}.leg.eyebrow`)}
              srNote={legNote}
              caption={
                leg.state === "none" ? (
                  legNote
                ) : (
                  <span className={TARGET_LINE.ROW}>
                    <span className={TARGET_LINE.HOST}>
                      {conn?.ping_target}
                    </span>
                    {familyKey ? (
                      <Tag variant="neutral" className={TARGET_LINE.CHIP}>
                        <span className={TARGET_LINE.CHIP_TEXT}>
                          {t(familyKey)}
                        </span>
                      </Tag>
                    ) : null}
                  </span>
                )
              }
            >
              <span className={VALUE_TEXT}>
                {leg.state === "none"
                  ? t(`${K}.leg.none`)
                  : t(`${K}.leg.value`, { n: leg.index + 1 })}
              </span>
            </Tile>
          </TickGroup>
        )}
      </motion.div>
    </div>
  );
}

export default StatusBand;

"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  RadioTowerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  BellOffIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ALERT_CHANNEL_ORDER, type AlertChannel } from "@/types/alerts";
import {
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  SKELETON,
  TILE,
  TILE_CAPTION,
  TILE_VALUE,
  TILE_VALUE_TONE,
  type DiscTone,
  type TileValueTone,
} from "./shapes";
import { COVERAGE_VALUE_TONE, type AlertsCoverage } from "./derive";
import { channelNameKey } from "./coverage-labels";

// The band reports SAVED truth while the matrix below shows the draft. That
// split is the whole defence against a derived control drifting from the click.

/** What the activity log knows about the most recent delivery attempt. */
export interface LastAlertSummary {
  /** Milliseconds since epoch. */
  atMs: number;
  /** Already-localized trigger label. */
  trigger: string;
  channel: AlertChannel;
  status: "sent" | "failed";
}

export interface AlertsStatusBandProps {
  /** Derived from CONFIRMED server state, never from the form draft. */
  coverage: AlertsCoverage;
  /** `undefined` while activity is still loading; `null` once known to be empty. */
  lastAlert?: LastAlertSummary | null;
  /** The activity read failed: the tile reports "Unknown", never a skeleton. */
  unreadable?: boolean;
}

export function AlertsStatusBand({
  coverage,
  lastAlert,
  unreadable,
}: AlertsStatusBandProps) {
  const { t } = useTranslation("common");

  const ArmedGlyph = coverage.silent
    ? ShieldOffIcon
    : coverage.tone === "good"
      ? ShieldCheckIcon
      : ShieldAlertIcon;

  const incomplete = ALERT_CHANNEL_ORDER.filter(
    (c) => coverage.channels[c].status === "incomplete",
  );

  const armedCaption = coverage.silent
    ? t("alerts.band.armedSilent")
    : coverage.uncovered.length > 0
      ? t("alerts.band.armedGap")
      : incomplete.length > 0
        ? t("alerts.band.armedIncomplete", {
            channels: incomplete.map((c) => t(channelNameKey(c))).join(", "),
          })
        : t("alerts.band.armedAll");

  // Both states in this slot must not be negations, or a healthy tile wears a
  // crossed-out glyph on green.
  const OutageGlyph = coverage.outageGap ? BellOffIcon : RadioTowerIcon;
  const outageValue =
    coverage.outageChannels.length > 0
      ? coverage.outageChannels.map((c) => t(channelNameKey(c))).join(", ")
      : t("alerts.band.outageNone");

  return (
    <div className={TILE.GRID}>
      <Tile
        tone={coverage.tone}
        glyph={<ArmedGlyph className={TILE.GLYPH} />}
        eyebrow={t("alerts.band.armedEyebrow")}
        value={t("alerts.band.armedValue", {
          covered: coverage.coveredCount,
          total: coverage.eventCount,
        })}
        valueTone={COVERAGE_VALUE_TONE[coverage.tone]}
        caption={armedCaption}
      />
      <Tile
        tone={coverage.outageGap ? "bad" : "good"}
        glyph={<OutageGlyph className={TILE.GLYPH} />}
        eyebrow={t("alerts.band.outageEyebrow")}
        value={outageValue}
        valueTone={coverage.outageGap ? "bad" : "neutral"}
        caption={
          coverage.outageGap
            ? t("alerts.band.outageGap")
            : t("alerts.band.outageCovered")
        }
      />
      <LastAlertTile lastAlert={lastAlert} unreadable={unreadable} />
    </div>
  );
}

function LastAlertTile({
  lastAlert,
  unreadable,
}: {
  lastAlert?: LastAlertSummary | null;
  unreadable?: boolean;
}) {
  const { t } = useTranslation("common");
  const relative = relativeLabel(lastAlert?.atMs);

  // Unknown is its own answer. The Activity card beside this one already says
  // the read failed, and a tile that pulses forever contradicts it.
  if (unreadable) {
    return (
      <Tile
        tone="neutral"
        glyph={<ClockIcon className={TILE.GLYPH} />}
        eyebrow={t("alerts.band.lastEyebrow")}
        value={t("alerts.band.lastUnknown")}
        valueTone="neutral"
        caption={t("alerts.band.lastUnknownCaption")}
      />
    );
  }

  if (lastAlert === undefined) {
    return (
      <div
        className={TILE.ROOT}
        role="status"
        aria-busy="true"
        aria-label={t("alerts.band.lastLoading")}
      >
        <span className={cn(TILE.DISC, DISC_TONE.neutral)} aria-hidden>
          <ClockIcon className={TILE.GLYPH} />
        </span>
        <div className={TILE.TEXT}>
          <span className={EYEBROW}>{t("alerts.band.lastEyebrow")}</span>
          <Skeleton className={cn(SKELETON.LINE, "h-[1.375rem] w-24")} />
          <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-36")} />
        </div>
      </div>
    );
  }

  return (
    <Tile
      tone="neutral"
      glyph={<ClockIcon className={TILE.GLYPH} />}
      eyebrow={t("alerts.band.lastEyebrow")}
      value={t(relative.key, { n: relative.n })}
      valueTone="neutral"
      caption={
        lastAlert
          ? t(
              lastAlert.status === "failed"
                ? "alerts.band.lastFailedCaption"
                : "alerts.band.lastSentCaption",
              {
                trigger: lastAlert.trigger,
                channel: t(channelNameKey(lastAlert.channel)),
              },
            )
          : t("alerts.band.lastNeverCaption")
      }
    />
  );
}

function Tile({
  tone,
  glyph,
  eyebrow,
  value,
  valueTone,
  caption,
}: {
  tone: DiscTone;
  glyph: ReactNode;
  eyebrow: string;
  value: string;
  valueTone: TileValueTone;
  caption: string;
}) {
  return (
    <div className={TILE.ROOT}>
      <span
        className={cn(TILE.DISC, DISC_TONE[tone], DISC_TRANSITION)}
        aria-hidden
      >
        {glyph}
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={cn(TILE_VALUE, TILE_VALUE_TONE[valueTone])}>
          {value}
        </span>
        <span className={TILE_CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

const MINUTE = 60_000;

/** Returns a key + `n`, never `count`: i18next reads `count` as a plural selector. */
function relativeLabel(atMs?: number): { key: string; n: number } {
  if (atMs === undefined || !Number.isFinite(atMs) || atMs <= 0)
    return { key: "alerts.band.lastNever", n: 0 };
  const delta = Math.max(0, Date.now() - atMs);
  if (delta < MINUTE) return { key: "alerts.band.justNow", n: 0 };
  if (delta < 60 * MINUTE)
    return { key: "alerts.band.minutesAgo", n: Math.floor(delta / MINUTE) };
  if (delta < 48 * 60 * MINUTE)
    return { key: "alerts.band.hoursAgo", n: Math.floor(delta / (60 * MINUTE)) };
  return {
    key: "alerts.band.daysAgo",
    n: Math.floor(delta / (24 * 60 * MINUTE)),
  };
}

/** Three tiles at the pinned 104px height, so the band never reflows on load. */
export function AlertsStatusBandSkeleton() {
  return (
    <div className={TILE.GRID} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={TILE.ROOT}>
          <Skeleton className={TILE.DISC} />
          <div className={TILE.TEXT}>
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-20")} />
            <Skeleton className={cn(SKELETON.LINE, "h-[1.375rem] w-24")} />
            <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-36")} />
          </div>
        </div>
      ))}
    </div>
  );
}

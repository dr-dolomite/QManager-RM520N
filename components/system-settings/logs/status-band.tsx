"use client";

import * as React from "react";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  CloudOffIcon,
  FileClockIcon,
  FileTextIcon,
  FileWarningIcon,
  PauseIcon,
  RadioTowerIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { FeedState, UseSystemLogsReturn } from "@/hooks/use-system-logs";

import { isNearRotation, relativeAge } from "./derive";
import {
  BAND,
  CAPTION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FEED_DISC_WRAP,
  FEED_RING,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "./shapes";

const K = "logs.band";

/**
 * Each tile's face is keyed off ONE state union rather than off three
 * independent ternaries, so the value, the caption and the disc cannot answer
 * the same question differently. Every state carries its own glyph.
 */
interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
}

type SeverityState = "unread" | "errors" | "warnings" | "clean";

const SEVERITY_FACE = {
  unread: { tone: "neutral", glyph: CircleDashedIcon },
  errors: { tone: "destructive", glyph: CircleXIcon },
  warnings: { tone: "warning", glyph: TriangleAlertIcon },
  clean: { tone: "success", glyph: CircleCheckIcon },
} satisfies Record<SeverityState, Face>;

/** Bound to the hook's own union, so a fourth feed state fails the build. */
const FEED_FACE = {
  live: { tone: "primary", glyph: RadioTowerIcon },
  paused: { tone: "neutral", glyph: PauseIcon },
  stopped: { tone: "neutral", glyph: CloudOffIcon },
} satisfies Record<FeedState, Face>;

type FileState = "unread" | "filling" | "resting";

const FILE_FACE = {
  unread: { tone: "neutral", glyph: FileClockIcon },
  filling: { tone: "warning", glyph: FileWarningIcon },
  resting: { tone: "neutral", glyph: FileTextIcon },
} satisfies Record<FileState, Face>;

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  eyebrow: string;
  value: string;
  caption: string;
  /** The Feed tile's ambient ring — armed only while the poll is running. */
  live?: boolean;
}

function Tile({
  glyph: Glyph,
  tone,
  eyebrow,
  value,
  caption,
  live = false,
}: TileProps): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={FEED_DISC_WRAP}>
        {live ? <span aria-hidden className={FEED_RING} /> : null}
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
        <span className={VALUE}>
          <span className={VALUE_TEXT}>{value}</span>
        </span>
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
// Band
// -----------------------------------------------------------------------------

export interface StatusBandProps {
  logs: UseSystemLogsReturn;
}

export function StatusBand({ logs }: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { entries, stats, isLoading, feedState, lastReadAtSec } = logs;

  // A one-second tick, for the Feed caption's age only. It is a reading that
  // changes while the user watches, not an animation.
  const [nowSec, setNowSec] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const read = lastReadAtSec !== null;

  // --- Severity ------------------------------------------------------------
  const errorCount = entries.filter((e) => e.level === "ERROR").length;
  const warnCount = entries.filter((e) => e.level === "WARN").length;

  const severityState: SeverityState = !read
    ? "unread"
    : errorCount > 0
      ? "errors"
      : warnCount > 0
        ? "warnings"
        : "clean";

  const severityValue =
    severityState === "unread"
      ? VALUE_NONE
      : severityState === "errors"
        ? t(`${K}.severity.errors`, { count: errorCount })
        : severityState === "warnings"
          ? t(`${K}.severity.warnings`, { count: warnCount })
          : t(`${K}.severity.clean`);

  const severityCaption =
    severityState === "unread"
      ? t(`${K}.severity.caption_unread`)
      : severityState === "errors"
        ? t(`${K}.severity.caption_errors`, {
            count: warnCount,
            lines: entries.length,
          })
        : severityState === "warnings"
          ? t(`${K}.severity.caption_warnings`, { count: entries.length })
          : t(`${K}.severity.caption_clean`, { count: entries.length });

  // --- Feed ----------------------------------------------------------------
  const feedFace = FEED_FACE[feedState];
  const age = relativeAge(read ? nowSec - lastReadAtSec : 0);
  const ageText = t(`logs.time.${age.unit}`, { value: age.count });

  const feedValue = t(`${K}.feed.${feedState}`);
  const feedCaption = !read
    ? t(`${K}.feed.caption_unread`)
    : feedState === "live"
      ? t(`${K}.feed.caption_live`, { age: ageText })
      : feedState === "paused"
        ? t(`${K}.feed.caption_paused`, { age: ageText })
        : t(`${K}.feed.caption_stopped`, { age: ageText });

  // --- Log file ------------------------------------------------------------
  const fileState: FileState = !stats
    ? "unread"
    : isNearRotation(stats.current_size_kb)
      ? "filling"
      : "resting";

  const fileValue = stats
    ? t(`${K}.file.size`, { size: stats.current_size_kb })
    : VALUE_NONE;

  const fileCaption = stats
    ? t(`${K}.file.caption`, {
        count: stats.current_lines,
        rotated: stats.rotated_files,
      })
    : t(`${K}.file.caption_unread`);

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
          </>
        ) : (
          <>
            <Tile
              glyph={SEVERITY_FACE[severityState].glyph}
              tone={SEVERITY_FACE[severityState].tone}
              eyebrow={t(`${K}.severity.eyebrow`)}
              value={severityValue}
              caption={severityCaption}
            />

            <Tile
              glyph={feedFace.glyph}
              tone={feedFace.tone}
              eyebrow={t(`${K}.feed.eyebrow`)}
              value={feedValue}
              caption={feedCaption}
              live={feedState === "live"}
            />

            <Tile
              glyph={FILE_FACE[fileState].glyph}
              tone={FILE_FACE[fileState].tone}
              eyebrow={t(`${K}.file.eyebrow`)}
              value={fileValue}
              caption={fileCaption}
            />
          </>
        )}
      </motion.div>
    </div>
  );
}

export default StatusBand;

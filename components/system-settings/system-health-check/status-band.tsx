"use client";

import * as React from "react";
import { CloudOffIcon, HistoryIcon, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem, staggerRowItem, staggerRows } from "@/lib/motion";
import type { HealthCheckJob } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import { formatBytes, isTerminal } from "./derive";
import {
  BAND,
  BUNDLE_FACE,
  CAPTION,
  CATEGORY_ORDER,
  CHECKS_FACE,
  CLOCK_TICK_MS,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  RESULT_FACE,
  SKELETON,
  SPIN,
  TILE,
  TOTAL_TESTS,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type BundleState,
  type DiscTone,
  type ResultState,
} from "./shapes";

const K = "band";

/** Unix-seconds now, on its own clock — a render-time read is impure. */
function useNowSec(): number {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      CLOCK_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);
  return now;
}

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  spin?: boolean;
  eyebrow: string;
  value: string;
  caption: string;
}

function Tile({
  glyph: Glyph,
  tone,
  spin = false,
  eyebrow,
  value,
  caption,
}: TileProps): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph
          className={cn(TILE.GLYPH, spin && SPIN)}
          aria-hidden="true"
        />
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
  job: HealthCheckJob | null;
  isLoading: boolean;
  /** Non-null when the status GET failed. With no job it means unreachable. */
  error: string | null;
}

export function StatusBand({
  job,
  isLoading,
  error,
}: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");

  const nowSec = useNowSec();

  /** Wall-clock age, in the pack's own words, off ONE clock reading. */
  const since = (epochSec: number): string => {
    const diff = Math.max(0, nowSec - epochSec);
    if (diff < 5) return t("time.just_now");
    if (diff < 60) return t("time.seconds", { count: diff });
    if (diff < 3600) return t("time.minutes", { count: Math.floor(diff / 60) });
    if (diff < 86400) return t("time.hours", { count: Math.floor(diff / 3600) });
    return t("time.days", { count: Math.floor(diff / 86400) });
  };

  const unreachable = Boolean(error) && !job;
  const stale = Boolean(error) && Boolean(job);
  const running = job?.status === "running";

  const fail = job?.summary.fail ?? 0;
  const warn = job?.summary.warn ?? 0;
  const skip = job?.summary.skip ?? 0;
  const passed = job?.summary.pass ?? 0;
  const total =
    job && job.summary.total > 0 ? job.summary.total : TOTAL_TESTS;
  const done = job ? job.tests.filter((test) => isTerminal(test.status)).length : 0;

  // --- Result --------------------------------------------------------------
  const resultState: ResultState = unreachable
    ? "unreachable"
    : !job
      ? "none"
      : running
        ? "running"
        : job.status === "error"
          ? "errored"
          : fail > 0
            ? "failed"
            : warn > 0
              ? "warned"
              : "passed";

  const resultValue =
    resultState === "running"
      ? t(`${K}.result.running`, { done, total })
      : resultState === "failed"
        ? t(`${K}.result.failed`, { count: fail })
        : resultState === "warned"
          ? t(`${K}.result.warned`, { count: warn })
          : t(`${K}.result.${resultState}`);

  const finishedWhen = since(job?.finished_at ?? job?.started_at ?? 0);
  const resultCaption =
    resultState === "unreachable" || resultState === "none"
      ? t(`${K}.result.caption_${resultState}`)
      : resultState === "running"
        ? t(`${K}.result.caption_running`, { when: since(job?.started_at ?? 0) })
        : resultState === "errored"
          ? t(`${K}.result.caption_errored`)
          : warn > 0
            ? t(`${K}.result.caption_warnings`, {
                count: warn,
                when: finishedWhen,
              })
            : t(`${K}.result.caption_finished`, { when: finishedWhen });

  const resultFace = RESULT_FACE[resultState];

  // --- Checks --------------------------------------------------------------
  const subsystems = t(`${K}.checks.caption`, { count: CATEGORY_ORDER.length });
  const checksCaption = !job
    ? t(`${K}.checks.caption_none`)
    : skip > 0
      ? t(`${K}.checks.caption_skipped`, { count: skip, subsystems })
      : subsystems;

  // --- Bundle --------------------------------------------------------------
  const bundleReady = Boolean(
    job && job.status === "complete" && job.tarball_path,
  );
  const bundleState: BundleState = bundleReady
    ? "ready"
    : running
      ? "building"
      : "absent";

  const bundleSize = formatBytes(job?.tarball_size);
  const bundleValue = bundleReady
    ? (bundleSize ?? t(`${K}.bundle.value_ready`))
    : running
      ? t(`${K}.bundle.value_building`)
      : VALUE_NONE;

  const bundleCaption = bundleReady
    ? t(`${K}.bundle.caption_ready`)
    : running
      ? t(`${K}.bundle.caption_building`)
      : job
        ? t(`${K}.bundle.caption_unavailable`)
        : t(`${K}.bundle.caption_absent`);

  const bundleFace = BUNDLE_FACE[bundleState];

  return (
    <motion.section variants={staggerItem}>
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.head`)}</span>
        {unreachable && (
          <Badge variant="muted">
            <CloudOffIcon className={BAND.GLYPH} aria-hidden="true" />
            {t(`${K}.unreachable`)}
          </Badge>
        )}
        {stale && (
          <Badge variant="warning">
            <HistoryIcon className={BAND.GLYPH} aria-hidden="true" />
            {t(`${K}.stale`)}
          </Badge>
        )}
      </div>

      {/* `aria-busy` is what makes the live region usable: the poller rewrites
          these tiles every 500ms, so AT defers until the run settles. */}
      <motion.div
        className={TILE.GRID}
        variants={staggerRows}
        aria-live="polite"
        aria-busy={running || isLoading}
      >
        {isLoading ? (
          <>
            <TileSkeleton />
            <TileSkeleton />
            <TileSkeleton />
          </>
        ) : (
          <>
            <Tile
              glyph={resultFace.glyph}
              tone={resultFace.tone}
              spin={resultFace.spin}
              eyebrow={t(`${K}.result.eyebrow`)}
              value={resultValue}
              caption={resultCaption}
            />
            <Tile
              glyph={CHECKS_FACE.glyph}
              tone={CHECKS_FACE.tone}
              eyebrow={t(`${K}.checks.eyebrow`)}
              value={
                job ? t(`${K}.checks.value`, { passed, total }) : VALUE_NONE
              }
              caption={checksCaption}
            />
            <Tile
              glyph={bundleFace.glyph}
              tone={bundleFace.tone}
              spin={bundleFace.spin}
              eyebrow={t(`${K}.bundle.eyebrow`)}
              value={bundleValue}
              caption={bundleCaption}
            />
          </>
        )}
      </motion.div>
    </motion.section>
  );
}

export default StatusBand;

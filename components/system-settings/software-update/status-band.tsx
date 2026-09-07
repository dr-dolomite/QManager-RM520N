"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  CloudOffIcon,
  Loader2Icon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem, staggerRowItem, staggerRows } from "@/lib/motion";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { cn } from "@/lib/utils";

import {
  activeStepIndex,
  channelKey,
  formatRelativeTime,
  installedState,
  latestState,
  type FailureDetail,
  type UpdateView,
} from "./derive";
import {
  AUTO_FACE,
  BAND,
  CAPTION,
  CLOCK_TICK_MS,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  INSTALLED_FACE,
  LATEST_FACE,
  SKELETON,
  SPIN,
  TILE,
  VALUE,
  VALUE_MONO,
  VALUE_NONE,
  VALUE_TEXT,
  type AutoState,
  type DiscTone,
} from "./shapes";

const K = "software_update";

/** Wall-clock now on its own clock — a render-time read is impure. */
function useNowMs(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
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
  /** A version tag is an identifier, so it wears the machine face. */
  mono?: boolean;
  /** What a reader hears in place of a figure that has no reading. */
  valueLabel?: string;
  caption: string;
}

function Tile({
  glyph: Glyph,
  tone,
  spin = false,
  eyebrow,
  value,
  mono = false,
  valueLabel,
  caption,
}: TileProps): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={cn(TILE.GLYPH, spin && SPIN)} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>
          <span
            className={cn(VALUE_TEXT, mono && VALUE_MONO)}
            aria-label={valueLabel}
          >
            {value}
          </span>
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
  view: UpdateView;
  /** Which operation failed. "Offline" is only honest about a failed check. */
  failure: FailureDetail | null;
  info: UpdateInfo | null;
  packageSize: string | null;
  lastChecked: string | null;
}

export function StatusBand({
  view,
  failure,
  info,
  packageSize,
  lastChecked,
}: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const nowMs = useNowMs();

  const failed = view === "check_failed" || view === "unreachable";
  const runFailed =
    failed && (failure?.kind === "download" || failure?.kind === "install");
  const running = view === "installing" || view === "rebooting";

  // --- Installed -----------------------------------------------------------
  const installed = installedState(info);
  const installedFace = INSTALLED_FACE[installed];
  const installedCaption =
    installed === "interrupted"
      ? t(`${K}.band.installed.caption_interrupted`)
      : t(`${K}.band.installed.caption_${channelKey(info)}`);

  // --- Latest release ------------------------------------------------------
  const latest = latestState(view, lastChecked, failure);
  const latestFace = LATEST_FACE[latest];
  const ago = formatRelativeTime(lastChecked, nowMs, t);
  const step = activeStepIndex(view);

  const captionFor = (state: typeof latest): string => {
    switch (state) {
      case "downloading":
        return packageSize
          ? t(`${K}.band.latest.caption_downloading`, { size: packageSize })
          : t(`${K}.band.latest.caption_downloading_plain`);
      case "verifying":
        return t(`${K}.band.latest.caption_verifying`);
      case "verified":
        return t(`${K}.band.latest.caption_verified`);
      case "installing":
        return t(`${K}.band.latest.caption_installing`, {
          step: (step ?? 0) + 1,
        });
      case "check_failed":
        return t(`${K}.band.latest.caption_failed`);
      case "download_failed":
        return t(`${K}.band.latest.caption_failed_download`);
      case "install_failed":
        return t(`${K}.band.latest.caption_failed_install`);
      default:
        // An unparseable timestamp reads as never checked, never as "null".
        return state === "never_checked" || ago === null
          ? t(`${K}.band.latest.caption_never`)
          : t(`${K}.band.latest.caption_checked`, { ago });
    }
  };

  const latestCaption = captionFor(latest);

  // --- Automatic updates ---------------------------------------------------
  const autoState: AutoState =
    info?.auto_update_enabled === true ? "on" : "off";
  const autoFace = AUTO_FACE[autoState];

  return (
    <motion.section variants={staggerItem}>
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.band.head`)}</span>
        {/* "Offline" is a claim about GitHub, so only a failed check may make
            it; a failed download or install reached the network fine. */}
        {failed &&
          (runFailed ? (
            <Badge variant="destructive">
              <AlertCircleIcon className={BAND.GLYPH} aria-hidden="true" />
              {t(`${K}.band.chip_failed`)}
            </Badge>
          ) : (
            <Badge variant="muted">
              <CloudOffIcon className={BAND.GLYPH} aria-hidden="true" />
              {t(`${K}.band.chip_offline`)}
            </Badge>
          ))}
        {running && (
          <Badge variant="info">
            <Loader2Icon
              className={cn(BAND.GLYPH, SPIN)}
              aria-hidden="true"
            />
            {t(`${K}.band.chip_in_progress`)}
          </Badge>
        )}
      </div>

      <motion.div
        className={TILE.GRID}
        variants={staggerRows}
        aria-live="polite"
        aria-busy={running || view === "loading"}
      >
        {view === "loading" ? (
          <>
            <TileSkeleton />
            <TileSkeleton />
            <TileSkeleton />
          </>
        ) : (
          <>
            <Tile
              glyph={installedFace.glyph}
              tone={installedFace.tone}
              spin={installedFace.spin}
              eyebrow={t(`${K}.band.installed.eyebrow`)}
              value={info?.current_version ?? VALUE_NONE}
              mono
              caption={installedCaption}
            />
            <Tile
              glyph={latestFace.glyph}
              tone={latestFace.tone}
              spin={latestFace.spin}
              eyebrow={t(`${K}.band.latest.eyebrow`)}
              value={info?.latest_version ?? VALUE_NONE}
              mono
              valueLabel={
                info?.latest_version
                  ? undefined
                  : t(`${K}.band.latest.value_none_label`)
              }
              caption={latestCaption}
            />
            <Tile
              glyph={autoFace.glyph}
              tone={autoFace.tone}
              spin={autoFace.spin}
              eyebrow={t(`${K}.band.auto.eyebrow`)}
              value={t(`${K}.band.auto.value_${autoState}`)}
              caption={t(`${K}.band.auto.caption_${autoState}`)}
            />
          </>
        )}
      </motion.div>
    </motion.section>
  );
}

export default StatusBand;

"use client";

import type * as React from "react";
import {
  CalendarClockIcon,
  CalendarOffIcon,
  CalendarXIcon,
  ClockAlertIcon,
  ClockFadingIcon,
  ClockIcon,
  CloudOffIcon,
  HistoryIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScheduleConfig, SystemSettings } from "@/types/system-settings";
import type { SimRegistryEntry } from "@/types/sim-registry";
import { DAY_KEYS } from "./scheduled-operations-card";
import { formatOffset } from "./derive";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  BAND,
  CAPTION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "./shapes";

const K = "band";

// -----------------------------------------------------------------------------
// Derivation
// -----------------------------------------------------------------------------

/**
 * The next armed weekday at or after today, as an index into `DAY_KEYS`.
 * Returns null when no day is selected — a schedule with no day never fires.
 */
function nextRebootDay(days: number[], time: string): number | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const now = new Date();
  const [hh = "0", mm = "0"] = time.split(":");
  const todayIsStillAhead =
    now.getHours() < Number(hh) ||
    (now.getHours() === Number(hh) && now.getMinutes() < Number(mm));
  const from = todayIsStillAhead ? now.getDay() : (now.getDay() + 1) % 7;
  return sorted.find((d) => d >= from) ?? sorted[0] ?? null;
}

/**
 * Each tile's face is keyed off ONE state union rather than off three
 * independent ternaries — the defect this replaces let the value line, the
 * caption and the disc tone answer the same question differently.
 *
 * Every state in a face carries its own glyph. `success-container` and
 * `warning-container` measure 1.03:1 apart, and the disc fills are no easier
 * under deuteranopia, so the glyph is the only separator a tile has.
 */
interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
}

type ClockState =
  | "unreachable"
  | "unread"
  | "unreported"
  | "drifted"
  | "applied";

const CLOCK_FACE: Record<ClockState, Face> = {
  unreachable: { tone: "destructive", glyph: CloudOffIcon },
  unread: { tone: "neutral", glyph: ClockAlertIcon },
  // The backend answered but omitted the live-clock fields, so there is no
  // ground truth to grade. Unknown is neutral — never `success`.
  unreported: { tone: "neutral", glyph: ClockFadingIcon },
  drifted: { tone: "warning", glyph: TriangleAlertIcon },
  applied: { tone: "success", glyph: ClockIcon },
};

type RebootState = "unreachable" | "unread" | "off" | "no_day" | "armed";

const REBOOT_FACE: Record<RebootState, Face> = {
  unreachable: { tone: "destructive", glyph: CloudOffIcon },
  unread: { tone: "neutral", glyph: CalendarXIcon },
  off: { tone: "neutral", glyph: CalendarOffIcon },
  // Enabled with no day is a schedule that can never fire — misconfigured, not
  // "configured and running", which is what `primary` claims.
  no_day: { tone: "warning", glyph: TriangleAlertIcon },
  armed: { tone: "primary", glyph: CalendarClockIcon },
};

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  eyebrow: string;
  value: string;
  caption: string;
  mono?: boolean;
}

function Tile({
  glyph: Glyph,
  tone,
  eyebrow,
  value,
  caption,
  mono = false,
}: TileProps): React.JSX.Element {
  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(TILE.ROOT, TILE.BODY)}
    >
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>
          <span className={cn(VALUE_TEXT, mono && "font-mono")}>{value}</span>
        </span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </motion.div>
  );
}

function TileSkeleton(): React.JSX.Element {
  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(TILE.ROOT, TILE.BODY)}
    >
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
  settings: SystemSettings | null;
  scheduledReboot: ScheduleConfig | null;
  sims: SimRegistryEntry[];
  isLoading: boolean;
  /** The registry has its own GET, and it is slower than settings on first
      paint — without this the SIM tile shows a confident 0 before it lands. */
  simsLoading: boolean;
  /** Non-null when the settings GET failed outright. */
  error: string | null;
}

export function StatusBand({
  settings,
  scheduledReboot,
  sims,
  isLoading,
  simsLoading,
  error,
}: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  // Two different failures, two different words. `!settings` rather than
  // `settings === null` so the family's three surfaces agree on the test.
  const unreachable = Boolean(error) && !settings;
  const stale = Boolean(error) && Boolean(settings);

  // --- Clock ---------------------------------------------------------------
  // `timezone_applied` is TRI-STATE: older backends omit it, and absent means
  // assume applied. Test `=== false`, never falsy.
  const zoneDrifted = settings?.timezone_applied === false;
  const offset = formatOffset(settings?.effective_offset);
  const abbr = settings?.effective_zone_abbr?.trim();
  // Both live-clock fields are optional. Without either there is no reading to
  // grade, so the tile must say so instead of inheriting a healthy verdict.
  // `formatOffset` returns `undefined`, never `null` — an `!== null` test here
  // was always true, which painted a green ClockIcon over an EMPTY figure and
  // made the `unreported` face unreachable.
  const clockReported = Boolean(abbr) || Boolean(offset);
  const zone = settings?.zonename ?? "";

  const clockState: ClockState = unreachable
    ? "unreachable"
    : !settings
      ? "unread"
      : zoneDrifted
        ? "drifted"
        : clockReported
          ? "applied"
          : "unreported";

  const clockValue = clockReported
    ? [abbr, offset].filter(Boolean).join(" ")
    : VALUE_NONE;

  const clockCaption =
    clockState === "unreachable" || clockState === "unread"
      ? t(`${K}.clock.caption_unread`)
      : clockState === "drifted"
        ? t(`${K}.clock.caption_drifted`, { zone })
        : clockState === "unreported"
          ? t(`${K}.clock.caption_unreported`, { zone })
          : t(`${K}.clock.caption_applied`, { zone });

  // --- Reboot --------------------------------------------------------------
  // Only 0..6 index `DAY_KEYS`; the UI never writes anything else, but a
  // hand-edited config file can, and an out-of-range index renders a raw key.
  const rebootDays = (scheduledReboot?.days ?? []).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  const rebootEnabled = scheduledReboot?.enabled === true;
  const rebootDayIndex = rebootEnabled
    ? nextRebootDay(rebootDays, scheduledReboot?.time ?? "00:00")
    : null;

  const rebootState: RebootState = unreachable
    ? "unreachable"
    : !scheduledReboot
      ? "unread"
      : !rebootEnabled
        ? "off"
        : rebootDayIndex === null
          ? "no_day"
          : "armed";

  const rebootValue =
    rebootState === "armed" && rebootDayIndex !== null
      ? `${t(`reboot.days.${DAY_KEYS[rebootDayIndex]}`)} ${scheduledReboot?.time ?? ""}`
      : rebootState === "off"
        ? t(`${K}.reboot.off`)
        : rebootState === "no_day"
          ? t(`${K}.reboot.never`)
          : VALUE_NONE;

  const rebootCaption =
    rebootState === "unreachable" || rebootState === "unread"
      ? t(`${K}.reboot.caption_unread`)
      : rebootState === "off"
        ? t(`${K}.reboot.caption_off`)
        : rebootState === "no_day"
          ? t(`${K}.reboot.caption_no_day`)
          : t(`${K}.reboot.caption_repeats`, {
              days: rebootDays
                .map((d) => t(`reboot.days.${DAY_KEYS[d]}`))
                .join(t(`${K}.reboot.day_separator`)),
            });

  const mutedCount = sims.filter((sim) => sim.dismissed).length;

  return (
    <div>
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
              glyph={CLOCK_FACE[clockState].glyph}
              tone={CLOCK_FACE[clockState].tone}
              eyebrow={t(`${K}.clock.eyebrow`)}
              value={clockValue}
              mono={clockReported}
              caption={clockCaption}
            />

            <Tile
              glyph={REBOOT_FACE[rebootState].glyph}
              tone={REBOOT_FACE[rebootState].tone}
              eyebrow={t(`${K}.reboot.eyebrow`)}
              value={rebootValue}
              caption={rebootCaption}
            />

            {simsLoading ? (
              <TileSkeleton />
            ) : (
              <Tile
                glyph={SmartphoneIcon}
                tone={sims.length > 0 ? "primary" : "neutral"}
                eyebrow={t(`${K}.sims.eyebrow`)}
                value={String(sims.length)}
                caption={
                  sims.length === 0
                    ? t(`${K}.sims.caption_none`)
                    : mutedCount === 0
                      ? t(`${K}.sims.caption_all_alerting`)
                      : t(`${K}.sims.caption_muted`, { count: mutedCount })
                }
              />
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

export default StatusBand;

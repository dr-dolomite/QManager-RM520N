"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  HistoryIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  ZapIcon,
  ZapOffIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import { computeUnresolved } from "@/lib/event-presentation";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { useEventsCopy } from "./network-events/copy";
import { EventLogCard } from "./network-events/event-log-card";
import {
  StatusBand,
  StatusBandSkeleton,
  type StatusTileProps,
} from "./network-events/status-band";
import {
  FILTER_PILL_ACTIVE,
  FILTER_PILL_REST,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  RING_CAP,
} from "./network-events/shapes";

/** The CGI serves the newest 50 of the device's ring; the cap is in `shapes`. */
const SERVED_EVENTS = 50;
const DAY_SEC = 86400;
/** The clock that ages rows and the freshness gate. One reading per render. */
const CLOCK_TICK_MS = 30_000;

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

/** Locale-aware relative time. Thresholds mirror the dashboard's exactly, and
 *  the keys are the shipped `dashboard` ones, already translated in all packs. */
function useTimeAgo() {
  const { t } = useTranslation("dashboard");
  return React.useCallback(
    (timestamp: number, nowSec: number): string => {
      const diff = Math.max(0, nowSec - timestamp);
      if (diff < 60) return t("activities.time.just_now");
      if (diff < 3600)
        return t("activities.time.minutes", { count: Math.floor(diff / 60) });
      if (diff < DAY_SEC)
        return t("activities.time.hours", { count: Math.floor(diff / 3600) });
      return t("activities.time.days", { count: Math.floor(diff / DAY_SEC) });
    },
    [t],
  );
}

const NetworkEventsComponent = () => {
  const { t } = useTranslation("dashboard");
  const c = useEventsCopy();
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const nowSec = useNowSec();
  const timeAgo = useTimeAgo();

  const { events, isLoading, isRefreshing, error, refresh } =
    useRecentActivities({ maxEvents: SERVED_EVENTS, enabled: autoRefresh });

  // Computed over the FULL newest-first array; the set keys into it by index.
  const unresolved = React.useMemo(() => computeUnresolved(events), [events]);

  const tiles = React.useMemo<StatusTileProps[]>(() => {
    const ongoing = unresolved.size;
    let oldestUnresolvedIndex = -1;
    for (const i of unresolved) {
      if (i > oldestUnresolvedIndex) oldestUnresolvedIndex = i;
    }
    const oldestUnresolved =
      oldestUnresolvedIndex >= 0 ? events[oldestUnresolvedIndex] : undefined;

    const recent = events.filter((e) => nowSec - e.timestamp <= DAY_SEC);
    const recentLoud = recent.filter(
      (e) => e.severity === "warning" || e.severity === "error",
    ).length;

    const oldestHeld = events[events.length - 1];

    return [
      {
        icon: ongoing > 0 ? TriangleAlertIcon : CheckCircle2Icon,
        eyebrow: c("networkEvents.band.ongoing.eyebrow"),
        value: String(ongoing),
        caption: oldestUnresolved
          ? c("networkEvents.band.ongoing.caption_oldest", {
              label: t(`activities.events.${oldestUnresolved.type}`, {
                defaultValue: oldestUnresolved.type,
              }),
              age: timeAgo(oldestUnresolved.timestamp, nowSec),
            })
          : c("networkEvents.band.ongoing.caption_clear"),
        alert: ongoing > 0,
      },
      {
        icon: HistoryIcon,
        eyebrow: c("networkEvents.band.last24.eyebrow"),
        value: String(recent.length),
        caption: c("networkEvents.band.last24.caption", { loud: recentLoud }),
      },
      {
        icon: ArchiveIcon,
        eyebrow: c("networkEvents.band.retained.eyebrow"),
        value: String(events.length),
        caption: oldestHeld
          ? c("networkEvents.band.retained.caption", {
              age: timeAgo(oldestHeld.timestamp, nowSec),
              cap: RING_CAP,
            })
          : c("networkEvents.band.retained.caption_empty", { cap: RING_CAP }),
      },
    ];
  }, [events, unresolved, nowSec, c, t, timeAgo]);

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={c("networkEvents.page.title")}
          description={c("networkEvents.page.description")}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={autoRefresh}
                onClick={() => setAutoRefresh((on) => !on)}
                className={cn(
                  PILL_ACTION,
                  autoRefresh ? FILTER_PILL_ACTIVE : FILTER_PILL_REST,
                )}
              >
                {autoRefresh ? (
                  <ZapIcon className={PILL_GLYPH} />
                ) : (
                  <ZapOffIcon className={PILL_GLYPH} />
                )}
                {autoRefresh
                  ? c("networkEvents.actions.auto_refresh_on")
                  : c("networkEvents.actions.auto_refresh_off")}
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={refresh}
                disabled={isRefreshing}
                className={cn(PILL_ACTION, FILTER_PILL_REST)}
              >
                <RefreshCwIcon
                  className={cn(PILL_GLYPH, isRefreshing && "animate-spin")}
                />
                {c("networkEvents.actions.refresh")}
              </Button>
            </>
          }
        />
      </motion.div>

      {/* The band reports counts, so it may only appear once a read has come
          back. Drawing "Ongoing 0" off a failed fetch is the surface claiming
          all clear on the strength of an empty array. */}
      <motion.div variants={staggerItem}>
        {isLoading ? (
          <StatusBandSkeleton />
        ) : error !== null && events.length === 0 ? null : (
          <StatusBand tiles={tiles} />
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        <EventLogCard
          events={events}
          unresolved={unresolved}
          nowSec={nowSec}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
          timeAgo={timeAgo}
        />
      </motion.div>
    </motion.div>
  );
};

export default NetworkEventsComponent;

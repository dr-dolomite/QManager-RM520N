"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CheckIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import { computeUnresolved } from "@/lib/event-presentation";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ActivityCard } from "./network-events/activity-card";
import { useEventsCopy } from "./network-events/copy";
import { SERVED_EVENTS, type EventRun } from "./network-events/derive";
import {
  EventLogCard,
  type EventLogHandle,
} from "./network-events/event-log-card";
import { NowCard } from "./network-events/now-card";
import {
  FILTER_PILL_REST,
  PAGE_ROOT,
  PILL_GLYPH,
  TOP_GRID,
} from "./network-events/shapes";

const DAY_SEC = 86400;
/** The clock that ages rows and the freshness gate. One reading per render. */
const CLOCK_TICK_MS = 30_000;

type UpdateMode = "live" | "paused";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

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

/** Locale-aware relative time, on the dashboard's thresholds and shipped keys. */
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

const clockTime = (timestamp: number): string =>
  new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const NetworkEventsComponent = () => {
  const c = useEventsCopy();
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const nowSec = useNowSec();
  const timeAgo = useTimeAgo();
  const logRef = React.useRef<EventLogHandle>(null);

  const { events, isLoading, isRefreshing, error, refresh } =
    useRecentActivities({ maxEvents: SERVED_EVENTS, enabled: autoRefresh });

  // Computed over the FULL newest-first array; the set keys into it by index.
  const unresolved = React.useMemo(() => computeUnresolved(events), [events]);

  const updateOptions: readonly SegmentedOption<UpdateMode>[] = [
    { value: "live", label: c("networkEvents.actions.live") },
    { value: "paused", label: c("networkEvents.actions.paused") },
  ];

  const revealRun = React.useCallback((run: EventRun) => {
    logRef.current?.revealRun(run);
  }, []);

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
              <SegmentedField
                value={autoRefresh ? "live" : "paused"}
                onValueChange={(next) => setAutoRefresh(next === "live")}
                options={updateOptions}
                ariaLabel={c("networkEvents.actions.updates_aria")}
                breakpoint="never"
                glyph={renderCheckGlyph}
              />

              <Button
                type="button"
                variant="ghost"
                onClick={refresh}
                disabled={isRefreshing}
                size="action"
                className={FILTER_PILL_REST}
              >
                <RefreshCwIcon
                  className={cn(PILL_GLYPH, isRefreshing && "motion-safe:animate-spin")}
                />
                {c("networkEvents.actions.refresh")}
              </Button>
            </>
          }
        />
      </motion.div>

      {/* These cards report counts, so they appear only once a read has come back. */}
      <motion.div variants={staggerItem}>
        {error !== null && events.length === 0 ? null : (
          <div className={TOP_GRID}>
            <NowCard
              events={events}
              unresolved={unresolved}
              nowSec={nowSec}
              isLoading={isLoading}
              timeAgo={timeAgo}
              clockTime={clockTime}
              onRevealRun={revealRun}
            />
            <ActivityCard
              events={events}
              nowSec={nowSec}
              isLoading={isLoading}
              clockTime={clockTime}
            />
          </div>
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        <EventLogCard
          ref={logRef}
          events={events}
          unresolved={unresolved}
          nowSec={nowSec}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
          timeAgo={timeAgo}
          clockTime={clockTime}
        />
      </motion.div>
    </motion.div>
  );
};

export default NetworkEventsComponent;

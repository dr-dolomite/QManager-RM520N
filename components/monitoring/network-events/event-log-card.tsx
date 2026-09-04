"use client";

import * as React from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDownIcon,
  InboxIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EVENT_FILTERS,
  EVENT_TAB_CATEGORIES,
  type EventFilter,
} from "@/constants/network-events";
import {
  eventKey,
  isFresh,
  presentEvent,
} from "@/lib/event-presentation";
import {
  DUR,
  EASE_QUICK,
  rowCascadeDelay,
  transitionEmphasized,
  transitionStandard,
} from "@/lib/motion";
import type { NetworkEvent } from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import { useEventsCopy, type NetworkEventsKey } from "./copy";
import { EventRow } from "./event-row";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DAY,
  FILTER_COUNT,
  FILTER_PILL,
  FILTER_PILL_ACTIVE,
  FILTER_PILL_REST,
  CROSSFADE_STACK,
  LOG,
  LOG_STACK,
  NOTICE,
  NOTICE_GLYPH,
  RAIL,
  RING_CAP,
  ROW,
} from "./shapes";

type SortOrder = "newest" | "oldest";

/** The row cascade, capped at ten so a fifty-row log does not choreograph for
 *  four seconds. Both the curve and the cap come from `lib/motion`. */
const logRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

const FILTER_LABEL_KEY: Record<EventFilter, NetworkEventsKey> = {
  all: "networkEvents.filters.all",
  bandChanges: "networkEvents.filters.radio",
  dataConnection: "networkEvents.filters.connectivity",
  networkMode: "networkEvents.filters.mode",
};

function dayKey(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface DayGroup {
  key: string;
  label: string;
  rows: { event: NetworkEvent; index: number }[];
}

export interface EventLogCardProps {
  events: NetworkEvent[];
  unresolved: ReadonlySet<number>;
  nowSec: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Translated relative time, e.g. "12m ago". */
  timeAgo: (timestamp: number, nowSec: number) => string;
}

export function EventLogCard({
  events,
  unresolved,
  nowSec,
  isLoading,
  error,
  onRetry,
  timeAgo,
}: EventLogCardProps) {
  const { t } = useTranslation("dashboard");
  const c = useEventsCopy();
  const [filter, setFilter] = React.useState<EventFilter>("all");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("newest");

  const counts = React.useMemo(() => {
    const tally: Record<EventFilter, number> = {
      all: events.length,
      bandChanges: 0,
      dataConnection: 0,
      networkMode: 0,
    };
    for (const e of events) {
      const category = EVENT_TAB_CATEGORIES[e.type];
      if (category) tally[category] += 1;
    }
    return tally;
  }, [events]);

  // Indices are carried through filtering and sorting because `unresolved` is
  // computed over the FULL newest-first array and keys into it.
  const rows = React.useMemo(() => {
    const kept = events
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) =>
          filter === "all" || EVENT_TAB_CATEGORIES[event.type] === filter,
      );
    return sortOrder === "oldest" ? kept.reverse() : kept;
  }, [events, filter, sortOrder]);

  const dayLabel = React.useCallback(
    (timestamp: number): string => {
      const today = dayKey(Math.floor(Date.now() / 1000));
      const yesterday = dayKey(Math.floor(Date.now() / 1000) - 86400);
      const key = dayKey(timestamp);
      if (key === today) return c("networkEvents.day.today");
      if (key === yesterday) return c("networkEvents.day.yesterday");
      return new Date(timestamp * 1000).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },
    [c],
  );

  const groups = React.useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    for (const row of rows) {
      const key = dayKey(row.event.timestamp);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, label: dayLabel(row.event.timestamp), rows: [row] });
    }
    return out;
  }, [rows, dayLabel]);

  // A head that post-dates the mount is one that arrived while the user was
  // looking, which is the whole condition the slide is for. Same two-clock
  // subtraction the freshness gate already makes, so they can only be wrong
  // together.
  const [mountedAtSec] = React.useState(() => Math.floor(Date.now() / 1000));
  const head = events[0];
  const hasArrival = head !== undefined && head.timestamp > mountedAtSec;

  // The cascade is a mount event, not a filter event, so touching the rail
  // retires it for good rather than re-choreographing fifty rows per press.
  const [cascade, setCascade] = React.useState(true);
  const chooseFilter = (next: EventFilter) => {
    setCascade(false);
    setFilter(next);
  };
  const chooseSort = (next: SortOrder) => {
    setCascade(false);
    setSortOrder(next);
  };

  // A confident "0 of 0" is a claim the device never made. Counts appear only
  // once a read has actually come back.
  const unreadable = error !== null && events.length === 0;
  const countsReadable = !isLoading && !unreadable;
  const description = isLoading
    ? c("networkEvents.log.description_loading")
    : unreadable
      ? c("networkEvents.log.description_unreadable")
      : c("networkEvents.log.description", {
          shown: rows.length,
          held: events.length,
          cap: RING_CAP,
        });

  const clockTime = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const renderRow = (event: NetworkEvent, absoluteIndex: number) => {
    const isUnresolved = unresolved.has(absoluteIndex);
    const presentation = presentEvent(
      event,
      isUnresolved,
      isFresh(event, nowSec),
      "card",
    );
    return (
      <EventRow
        event={event}
        presentation={presentation}
        typeLabel={t(`activities.events.${event.type}`, {
          defaultValue: event.type,
        })}
        severityWord={t(presentation.srSeverityKey)}
        ongoingLabel={c("networkEvents.row.ongoing")}
        unresolved={isUnresolved}
        timeAgo={timeAgo(event.timestamp, nowSec)}
        clockTime={clockTime(event.timestamp)}
      />
    );
  };

  let body: React.ReactNode;
  if (error && events.length === 0) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon={UnplugIcon}
        title={c("networkEvents.error.title")}
        description={c("networkEvents.error.description", { message: error })}
        actionLabel={c("networkEvents.error.retry")}
        actionIcon={RefreshCwIcon}
        onAction={onRetry}
      />
    );
  } else if (!isLoading && rows.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={InboxIcon}
        title={
          filter === "all"
            ? c("networkEvents.empty.title")
            : c("networkEvents.empty.filtered_title")
        }
        description={
          filter === "all"
            ? c("networkEvents.empty.description")
            : c("networkEvents.empty.filtered_description")
        }
      />
    );
  } else {
    let rendered = -1;
    body = (
      <div className={cn(LOG_STACK, "overflow-hidden")}>
        {groups.map((group, groupIndex) => (
          <div key={group.key} className={LOG}>
            <div className={DAY.ROOT}>
              <span className={DAY.LABEL}>{group.label}</span>
              {groupIndex > 0 ? (
                <span aria-hidden className={DAY.RULE} />
              ) : null}
            </div>
            {group.rows.map(({ event, index }) => {
              rendered += 1;
              const position = rendered;
              const isHead =
                position === 0 && sortOrder === "newest" && hasArrival;
              return (
                <motion.div
                  key={eventKey(event)}
                  custom={position}
                  variants={isHead ? undefined : logRowItem}
                  initial={
                    isHead
                      ? { opacity: 0, x: "100%" }
                      : cascade
                        ? "hidden"
                        : false
                  }
                  animate={isHead ? { opacity: 1, x: 0 } : "visible"}
                  transition={isHead ? transitionEmphasized : undefined}
                >
                  {renderRow(event, index)}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {c("networkEvents.log.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{description}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={RAIL}>
          {EVENT_FILTERS.map((option) => {
            const active = option === filter;
            return (
              <Button
                key={option}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => chooseFilter(option)}
                className={cn(
                  FILTER_PILL,
                  active ? FILTER_PILL_ACTIVE : FILTER_PILL_REST,
                )}
              >
                {c(FILTER_LABEL_KEY[option])}
                {countsReadable ? (
                  <span className={FILTER_COUNT}>{counts[option]}</span>
                ) : null}
              </Button>
            );
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(FILTER_PILL, FILTER_PILL_REST, "ml-auto")}
              >
                <ArrowUpDownIcon className="size-3.5" />
                {sortOrder === "newest"
                  ? c("networkEvents.sort.newest")
                  : c("networkEvents.sort.oldest")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {c("networkEvents.sort.label")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortOrder === "newest"}
                onCheckedChange={() => chooseSort("newest")}
              >
                {c("networkEvents.sort.newest")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortOrder === "oldest"}
                onCheckedChange={() => chooseSort("oldest")}
              >
                {c("networkEvents.sort.oldest")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* A stale list beats a blank card: with data in hand the error is a
            notice above the transcript, never a replacement for it. */}
        {error && events.length > 0 ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {c("networkEvents.notice.stale", { message: error })}
          </div>
        ) : null}

        {/* Skeleton and content share one grid cell, so the swap costs no layout
            shift. The ternary unmounts the skeleton outright; only the filter
            swap below animates, and it is sync rather than `wait`, so nothing
            here is gated on an exit completing in a throttled background tab. */}
        <div className={CROSSFADE_STACK}>
          {isLoading ? (
            <LogSkeleton />
          ) : (
            <AnimatePresence>
              <motion.div
                key={`${filter}-${sortOrder}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Skeleton rows read the SAME pinned height constant the real rows do. */
export function LogSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className={LOG} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn(ROW.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

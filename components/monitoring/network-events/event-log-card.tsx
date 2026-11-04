"use client";

import * as React from "react";
import { flushSync } from "react-dom";
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
import { eventKey, isFresh, presentEvent } from "@/lib/event-presentation";
import {
  DUR,
  EASE_QUICK,
  rowCascadeDelay,
  transitionEmphasized,
  transitionStandard,
} from "@/lib/motion";
import { isMotionReduced } from "@/lib/motion-preference";
import type { NetworkEvent } from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  useEventsCopy,
  useEventsPlural,
  useSpanText,
  type NetworkEventsKey,
} from "./copy";
import {
  groupRuns,
  runMemberKeys,
  runProbe,
  type EventRun,
  type IndexedEvent,
  type LogItem,
} from "./derive";
import { EventRow, MemberRow, RunRow } from "./event-row";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CROSSFADE_STACK,
  DAY,
  FILTER_COUNT,
  FILTER_PILL,
  FILTER_PILL_ACTIVE,
  FILTER_PILL_REST,
  LOG,
  LOG_SCROLL,
  LOG_STACK,
  NOTICE,
  NOTICE_GLYPH,
  RAIL,
  ROW,
} from "./shapes";

type SortOrder = "newest" | "oldest";

/** The row cascade, capped at ten; curve and cap come from `lib/motion`. */
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

/** The DOM id of a run row; scoped by filter so an exiting view never answers. */
function runDomId(filter: EventFilter, key: string): string {
  return `ne-run-${filter}-${key}`;
}

const itemTimestamp = (item: LogItem): number =>
  item.kind === "run" ? item.newest.event.timestamp : item.row.event.timestamp;

interface DayGroup {
  key: string;
  label: string;
  items: LogItem[];
}

export interface EventLogHandle {
  /** Switch to All, open the run and scroll it into view. */
  revealRun: (run: EventRun) => void;
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
  clockTime: (timestamp: number) => string;
  ref?: React.Ref<EventLogHandle>;
}

export function EventLogCard({
  events,
  unresolved,
  nowSec,
  isLoading,
  error,
  onRetry,
  timeAgo,
  clockTime,
  ref,
}: EventLogCardProps) {
  const { t } = useTranslation("dashboard");
  const c = useEventsCopy();
  const p = useEventsPlural();
  const spanText = useSpanText();
  const [filter, setFilter] = React.useState<EventFilter>("all");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("newest");
  // Member eventKeys of opened runs, so a run stays open while it grows or loses its tail.
  const [openKeys, setOpenKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

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

  // Indices ride along because `unresolved` keys into the full newest-first array.
  const items = React.useMemo<LogItem[]>(() => {
    const kept: IndexedEvent[] = events
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) =>
          filter === "all" || EVENT_TAB_CATEGORIES[event.type] === filter,
      );
    return groupRuns(sortOrder === "oldest" ? kept.reverse() : kept);
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

  // A run's React identity outlives its key, which moves when the served 50 evicts its oldest member.
  const [runIds, setRunIds] = React.useState<{
    items: LogItem[];
    ids: ReadonlyMap<string, string>;
  }>({ items: [], ids: new Map() });
  if (runIds.items !== items) {
    // Keyed by run key and by member eventKey; a surviving member carries the id forward.
    const ids = new Map<string, string>();
    for (const item of items) {
      if (item.kind !== "run") continue;
      const prior = item.members
        .map((m) => runIds.ids.get(eventKey(m.event)))
        .find((id) => id !== undefined);
      const id = prior ?? item.key;
      ids.set(item.key, id);
      for (const m of item.members) ids.set(eventKey(m.event), id);
    }
    setRunIds({ items, ids });
  }
  const runReactKey = (run: EventRun) => runIds.ids.get(run.key) ?? run.key;

  const groups = React.useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    for (const item of items) {
      const ts = itemTimestamp(item);
      const key = dayKey(ts);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, label: dayLabel(ts), items: [item] });
    }
    return out;
  }, [items, dayLabel]);

  // A head newer than the mount arrived while the user was looking: that is what the slide is for.
  const [mountedAtSec] = React.useState(() => Math.floor(Date.now() / 1000));
  const head = events[0];
  const hasArrival = head !== undefined && head.timestamp > mountedAtSec;

  // The cascade is a mount event; touching the rail retires it for good.
  const [cascade, setCascade] = React.useState(true);
  const chooseFilter = (next: EventFilter) => {
    setCascade(false);
    setFilter(next);
  };
  const chooseSort = (next: SortOrder) => {
    setCascade(false);
    setSortOrder(next);
  };

  const isOpen = React.useCallback(
    (run: EventRun) =>
      run.members.some((m) => openKeys.has(eventKey(m.event))),
    [openKeys],
  );

  const toggleRun = (run: EventRun) => {
    const memberKeys = runMemberKeys(run);
    const live = new Set(events.map(eventKey));
    setOpenKeys((prev) => {
      const wasOpen = memberKeys.some((k) => prev.has(k));
      const next = new Set([...prev].filter((k) => live.has(k)));
      for (const k of memberKeys) {
        if (wasOpen) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  React.useImperativeHandle(
    ref,
    () => ({
      revealRun: (run: EventRun) => {
        // Commit synchronously so the row exists before it is scrolled to.
        flushSync(() => {
          setCascade(false);
          setFilter("all");
          setOpenKeys((prev) => new Set([...prev, ...runMemberKeys(run)]));
        });
        document.getElementById(runDomId("all", run.key))?.scrollIntoView({
          block: "center",
          behavior: isMotionReduced() ? "auto" : "smooth",
        });
      },
    }),
    [],
  );

  // A confident count is a claim the device never made; counts wait for a real read.
  const unreadable = error !== null && events.length === 0;
  const countsReadable = !isLoading && !unreadable;
  const description = isLoading
    ? c("networkEvents.log.description_loading")
    : unreadable
      ? c("networkEvents.log.description_unreadable")
      : c("networkEvents.log.description");

  const typeLabel = (event: NetworkEvent) =>
    t(`activities.events.${event.type}`, { defaultValue: event.type });

  const renderEvent = ({ event, index }: IndexedEvent) => {
    const isUnresolved = unresolved.has(index);
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
        typeLabel={typeLabel(event)}
        severityWord={t(presentation.srSeverityKey)}
        ongoingLabel={c("networkEvents.row.ongoing")}
        unresolved={isUnresolved}
        timeAgo={timeAgo(event.timestamp, nowSec)}
        clockTime={clockTime(event.timestamp)}
      />
    );
  };

  const renderRun = (run: EventRun) => {
    const anyUnresolved = run.members.some((m) => unresolved.has(m.index));
    const presentation = presentEvent(
      runProbe(run),
      anyUnresolved,
      isFresh(run.newest.event, nowSec),
      "card",
    );
    const open = isOpen(run);
    const id = runDomId(filter, run.key);
    const count = run.members.length;
    return (
      <>
        <RunRow
          id={id}
          membersId={`${id}-members`}
          presentation={presentation}
          severityWord={t(presentation.srSeverityKey)}
          title={c("networkEvents.run.title", {
            label: typeLabel(run.newest.event),
          })}
          meta={p("networkEvents.run.meta", count, {
            span: spanText(run.spanSec),
          })}
          timeAgo={timeAgo(run.newest.event.timestamp, nowSec)}
          clockTime={clockTime(run.newest.event.timestamp)}
          open={open}
          toggleLabel={
            open
              ? c("networkEvents.run.hide")
              : c("networkEvents.run.show", { count })
          }
          onToggle={() => toggleRun(run)}
        />
        {open ? (
          <motion.div
            id={`${id}-members`}
            className={cn(ROW.MEMBERS, "mt-0.5")}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionStandard}
          >
            {run.members.map(({ event }) => {
              const member = presentEvent(event, false, false, "card");
              return (
                <MemberRow
                  key={eventKey(event)}
                  event={event}
                  presentation={member}
                  severityWord={t(member.srSeverityKey)}
                  clockTime={clockTime(event.timestamp)}
                />
              );
            })}
          </motion.div>
        ) : null}
      </>
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
  } else if (!isLoading && items.length === 0) {
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
      <div className={LOG_STACK}>
        {groups.map((group, groupIndex) => (
          <div key={group.key} className={LOG}>
            <div className={DAY.ROOT}>
              <span className={DAY.LABEL}>{group.label}</span>
              {groupIndex > 0 ? (
                <span aria-hidden className={DAY.RULE} />
              ) : null}
            </div>
            {group.items.map((item) => {
              rendered += 1;
              const position = rendered;
              const isHead =
                position === 0 && sortOrder === "newest" && hasArrival;
              return (
                <motion.div
                  key={
                    item.kind === "run"
                      ? `run-${runReactKey(item)}`
                      : eventKey(item.row.event)
                  }
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
                  {item.kind === "run"
                    ? renderRun(item)
                    : renderEvent(item.row)}
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

        {/* With data in hand the error is a notice above the list, never a replacement. */}
        {error && events.length > 0 ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {c("networkEvents.notice.stale", { message: error })}
          </div>
        ) : null}

        <div
          className={LOG_SCROLL}
          tabIndex={0}
          role="region"
          aria-label={c("networkEvents.log.scroll_aria")}
        >
          {/* Skeleton and content share one grid cell; the filter swap is sync, not `wait`. */}
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

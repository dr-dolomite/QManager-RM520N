"use client";

import * as React from "react";
import Link from "next/link";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  InboxIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import type { UseRecentActivitiesReturn } from "@/hooks/use-recent-activities";
import {
  computeUnresolved,
  eventKey,
  isFresh,
  presentEvent,
  splitEventMessage,
  type EventPresentation,
  type EventTone,
} from "@/lib/event-presentation";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { NetworkEvent, NetworkEventType } from "@/types/modem-status";

import { CLOCK_PLAUSIBLE_AFTER, useTimeAgo } from "./derive";
import {
  ABSOLUTE_INK,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  DAY,
  LOG,
  LOG_LIMIT,
  LOG_LINK,
  LOG_STACK,
  PILL_GLYPH,
  ROW,
  SKELETON,
  type ConditionTone,
} from "./shapes";

/** The two types the watchdog writes. Everything else belongs to another page. */
const WATCHDOG_TYPES: ReadonlySet<NetworkEventType> = new Set([
  "watchcat_recovery",
  "sim_failover",
]);

const TYPE_KEY: Record<string, string> = {
  watchcat_recovery: "watchdog.activity.type.recovery",
  sim_failover: "watchdog.activity.type.failover",
};

/** Four tones, four distinct glyphs. Two rows never share one. */
const TONE_GLYPH = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: XCircleIcon,
  routine: ArrowRightLeftIcon,
} satisfies Record<EventTone, LucideIcon>;

const DAY_SEC = 86_400;

const NO_REBOOTS: readonly number[] = [];

/** How far apart the log's own restart row and the recorded restart may sit. */
const REBOOT_MATCH_SEC = 120;

/** The event ring's own row for a Tier 4 restart, so the two are drawn once. */
function isRebootEvent(event: NetworkEvent, epoch: number): boolean {
  return (
    event.type === "watchcat_recovery" &&
    /reboot/i.test(event.message) &&
    Math.abs(event.timestamp - epoch) <= REBOOT_MATCH_SEC
  );
}

/** 80ms per row, capped by `rowCascadeDelay` so a long feed cannot choreograph. */
const rowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

function useNowSec(): number {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface RowView {
  key: string;
  event: NetworkEvent;
  presentation: EventPresentation;
  unresolved: boolean;
  typeLabel: string;
  severityWord: string;
  timeAgo: string;
  clockTime: string;
}

interface DayGroup {
  key: string;
  label: string;
  rows: RowView[];
}

/**
 * Recovery activity: the same 52px event row the dashboard and Network Events
 * render. The newest five; "All events" links to the full log.
 */
export function RecoveryActivityCard({
  activities,
  recentReboots = NO_REBOOTS,
}: {
  activities: UseRecentActivitiesReturn;
  /** Epoch seconds of the watchdog's own restarts, newest first. */
  recentReboots?: readonly number[];
}) {
  const { t, i18n } = useTranslation("common");
  const { events, isLoading, error, refresh } = activities;
  const nowSec = useNowSec();
  const timeAgo = useTimeAgo();

  const dayLabel = React.useCallback(
    (ms: number): string => {
      const nowMs = Date.now();
      if (dayKey(ms) === dayKey(nowMs)) return t("watchdog.activity.day.today");
      if (dayKey(ms) === dayKey(nowMs - DAY_SEC * 1000))
        return t("watchdog.activity.day.yesterday");
      // The app's locale, not the browser's: the two disagree by design here.
      return new Date(ms).toLocaleDateString(i18n.language, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },
    [i18n.language, t],
  );

  const groups = React.useMemo<DayGroup[]>(() => {
    // Resolution is judged against the WHOLE feed, then filtered: an internet
    // recovery that closes a watchdog row is not itself a watchdog row.
    const unresolved = computeUnresolved(events);
    const out: DayGroup[] = [];

    // The hook only REVERSES the file, and file order is not timestamp order on
    // this platform: with no RTC the modem boots at Jan 1970, so rows appended
    // after a SIM-less reboot pre-date the ones already in the ring. Sort, or
    // the card contradicts its own "newest first" description. Indices are
    // carried through because `unresolved` keys into the unfiltered array.
    const fromLog = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => WATCHDOG_TYPES.has(event.type));

    // The watchdog's own restarts survive the reboot they cause, which the
    // event ring does not always. A restart the ring still holds is not drawn
    // twice. Index -1: a synthetic row is never "unresolved".
    const fromReboots = recentReboots
      .filter(
        (epoch) =>
          epoch > CLOCK_PLAUSIBLE_AFTER &&
          !fromLog.some(({ event }) => isRebootEvent(event, epoch)),
      )
      .map((epoch) => ({
        index: -1,
        event: {
          timestamp: epoch,
          type: "watchcat_recovery",
          message: t("watchdog.activity.tier4Reboot"),
          severity: "error",
        } satisfies NetworkEvent,
      }));

    const kept = [...fromLog, ...fromReboots]
      .sort((a, b) => b.event.timestamp - a.event.timestamp)
      .slice(0, LOG_LIMIT);

    kept.forEach(({ event, index }) => {
      const ms = event.timestamp * 1000;
      const isUnresolved = unresolved.has(index);
      const presentation = presentEvent(
        event,
        isUnresolved,
        isFresh(event, nowSec),
        "card",
      );
      const row: RowView = {
        key: eventKey(event),
        event,
        presentation,
        unresolved: isUnresolved,
        typeLabel: t(TYPE_KEY[event.type] ?? "watchdog.activity.type.recovery"),
        severityWord: t(presentation.srSeverityKey, { ns: "dashboard" }),
        timeAgo: timeAgo(event.timestamp),
        clockTime: new Date(ms).toLocaleTimeString(i18n.language, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      const key = dayKey(ms);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, label: dayLabel(ms), rows: [row] });
    });

    return out;
  }, [events, recentReboots, nowSec, t, i18n.language, timeAgo, dayLabel]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // One counter across every day block: assuming three rows per group ran the
  // cascade backwards the moment a day held more than three.
  const order = React.useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const g of groups) for (const r of g.rows) map.set(r.key, i++);
    return map;
  }, [groups]);
  const unreadable = !isLoading && error !== null && total === 0;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("watchdog.activity.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.activity.description")}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" className={LOG_LINK}>
            <Link href="/monitoring/events/">
              {t("watchdog.activity.allEvents")}
              <ChevronRightIcon className={PILL_GLYPH} aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col")}>
        {isLoading ? (
          <ActivityRows aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className={SKELETON.ROW} />
            ))}
          </ActivityRows>
        ) : unreadable ? (
          <ActivityCondition
            tone="destructive"
            glyph={WifiOffIcon}
            title={t("watchdog.activity.error.title")}
            description={error ?? ""}
            actionLabel={t("watchdog.activity.error.retry")}
            onAction={() => refresh()}
          />
        ) : total === 0 ? (
          <ActivityCondition
            tone="muted"
            glyph={InboxIcon}
            title={t("watchdog.activity.empty.title")}
            description={t("watchdog.activity.empty.description")}
          />
        ) : (
          <div className={LOG_STACK}>
            {groups.map((group) => (
              <div key={group.key} className={LOG}>
                <div className={DAY.ROOT}>
                  <span className={DAY.LABEL}>{group.label}</span>
                  <span aria-hidden className={DAY.RULE} />
                </div>
                {group.rows.map((row) => (
                  <motion.div
                    key={row.key}
                    custom={order.get(row.key) ?? 0}
                    variants={rowItem}
                    initial="hidden"
                    animate="visible"
                  >
                    <ActivityRow row={row} />
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRows({
  children,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div className={LOG_STACK} {...rest}>
      <div className={LOG}>{children}</div>
    </div>
  );
}

function ActivityRow({ row }: { row: RowView }) {
  const { presentation } = row;
  const Glyph = TONE_GLYPH[presentation.tone];
  // The daemon writes these messages; they arrive as backend English and are
  // the one untranslated text on this surface, as on every other event feed.
  const { text, identifiers } = splitEventMessage(row.event.message);
  const { chromatic } = presentation;

  return (
    <div className={cn(ROW.ROOT, ROW.TRANSITION, presentation.containerClass)}>
      <span
        aria-hidden
        className={cn(ROW.DISC, ROW.TRANSITION, presentation.discClass)}
      >
        <Glyph className={ROW.GLYPH} />
      </span>

      <div className={ROW.BODY}>
        <span className="sr-only">{row.severityWord}</span>
        <span
          className={cn(ROW.MESSAGE, presentation.messageClass)}
          title={text}
        >
          {text}
        </span>
        <div className={ROW.META}>
          <Tag
            variant="neutral"
            className={cn(ROW.META_CHIP, chromatic && ROW.META_CHIP_ON_TONAL)}
          >
            {row.typeLabel}
          </Tag>
          {identifiers.map((id) => (
            <span
              key={id}
              className={chromatic ? ROW.META_ID_ON_TONAL : ROW.META_ID}
            >
              {id}
            </span>
          ))}
        </div>
      </div>

      <div className={ROW.WHEN}>
        <span className={cn(ROW.RELATIVE, presentation.messageClass)}>
          {row.timeAgo}
        </span>
        <span
          className={cn(ROW.ABSOLUTE, chromatic ? "opacity-80" : ABSOLUTE_INK)}
        >
          {row.clockTime}
        </span>
      </div>
    </div>
  );
}

/** The condition IS the state, so it replaces the list rather than emptying it. */
function ActivityCondition({
  tone,
  glyph: Glyph,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: ConditionTone;
  glyph: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div role="status" className={cn(CONDITION.ROOT, skin.ROOT)}>
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <Glyph className={CONDITION.GLYPH} />
      </span>
      <p className={CONDITION.TITLE}>{title}</p>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAction}
          className={cn(CONDITION.ACTION, skin.ACTION)}
        >
          <RefreshCcwIcon className={PILL_GLYPH} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowRightLeftIcon,
  CheckCircle2Icon,
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
import { useRecentActivities } from "@/hooks/use-recent-activities";
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

import { useTimeAgo } from "./derive";
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
  LOG_STACK,
  PILL_ACTION,
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
 * Recovery activity — the same 52px event row the dashboard and the Monitoring
 * log render, because it is the same feed. A full-width band, so the list runs
 * its own length exactly as the Network Events log does.
 */
export function RecoveryActivityCard() {
  const { t, i18n } = useTranslation("common");
  const { events, isLoading, isRefreshing, error, refresh } =
    useRecentActivities({ maxEvents: 50 });
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

    events.forEach((event, index) => {
      if (!WATCHDOG_TYPES.has(event.type)) return;
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
  }, [events, nowSec, t, i18n.language, timeAgo, dayLabel]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const unreadable = !isLoading && error !== null && total === 0;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader>
        <CardTitle className={CARD_TITLE}>
          {t("watchdog.activity.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("watchdog.activity.description")}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            onClick={() => refresh()}
            disabled={isLoading || isRefreshing}
            className={cn(
              PILL_ACTION,
              "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
            )}
          >
            <RefreshCcwIcon
              className={cn(
                PILL_GLYPH,
                isRefreshing && "animate-spin motion-reduce:animate-none",
              )}
            />
            {t("watchdog.activity.refresh")}
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
            {groups.map((group, gi) => (
              <div key={group.key} className={LOG}>
                <div className={DAY.ROOT}>
                  <span className={DAY.LABEL}>{group.label}</span>
                  <span aria-hidden className={DAY.RULE} />
                </div>
                {group.rows.map((row, ri) => (
                  <motion.div
                    key={row.key}
                    custom={gi * 3 + ri}
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
    <div className={cn(CONDITION.ROOT, skin.ROOT)}>
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

"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BellOffIcon,
  PowerIcon,
  RefreshCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UnplugIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import type {
  AlertChannel,
  AlertLogEntry,
  RebootCause,
  RebootHistoryEntry,
} from "@/types/alerts";

import { ActivityRow } from "./activity-row";
import {
  CARD_DESC,
  CARD_FILL,
  CARD_FILL_REGION,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  CROSSFADE_STACK,
  DAY,
  LOG,
  LOG_STACK,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_GLYPH,
  PILL_ICON,
  SKELETON,
  type ConditionTone,
  type RowTone,
} from "./shapes";

// -----------------------------------------------------------------------------
// Activity — one time-ordered feed of alert deliveries + recorded reboots.
// -----------------------------------------------------------------------------
// The two shapes interleave by time onto ONE 52px row. A reboot record simply
// has no recipient, so that element is omitted rather than placeheld: a row is
// not a table and has no empty cells to fill.
// -----------------------------------------------------------------------------

const DAY_SEC = 86_400;
const CLOCK_TICK_MS = 30_000;

type FeedRow =
  | { kind: "delivery"; key: string; time: number; entry: AlertLogEntry }
  | { kind: "reboot"; key: string; time: number; reboot: RebootHistoryEntry };

/** Delivery timestamps are device-local "YYYY-MM-DD HH:MM:SS"; reboots are
 *  epoch seconds. Normalize both to a comparable ms key for one desc sort. */
function deliveryTime(ts: string): number {
  const parsed = Date.parse(ts.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** A reboot is not an alert, so it keeps a neutral ground; the disc carries
 *  whether it was something to notice. Glyphs separate all three causes. */
const REBOOT_TONE: Record<RebootCause, RowTone> = {
  unplanned: "notable",
  watchdog: "notable",
  user: "neutral",
};

const REBOOT_GLYPH: Record<RebootCause, LucideIcon> = {
  unplanned: TriangleAlertIcon,
  watchdog: ShieldCheckIcon,
  user: PowerIcon,
};

const REBOOT_CAUSE_KEY: Record<RebootCause, string> = {
  unplanned: "alerts.activity.cause.unexpected",
  watchdog: "alerts.activity.cause.watchdog",
  user: "alerts.activity.cause.planned",
};

const REBOOT_CAUSE_EN: Record<RebootCause, string> = {
  unplanned: "Unexpected",
  watchdog: "Watchdog",
  user: "Planned",
};

const CHANNEL_KEY: Record<AlertChannel, string> = {
  sms: "alerts.activity.channel.sms",
  email: "alerts.activity.channel.email",
  discord: "alerts.activity.channel.discord",
};

const CHANNEL_EN: Record<AlertChannel, string> = {
  sms: "SMS",
  email: "Email",
  discord: "Discord",
};

/** The backend can name a cause we have no presentation for; fall back rather
 *  than render a row with no glyph at all. */
function knownCause(value: RebootCause): RebootCause {
  return value in REBOOT_GLYPH ? value : "unplanned";
}

function knownChannel(value: AlertChannel): AlertChannel {
  return value in CHANNEL_EN ? value : "sms";
}

/** The row cascade, capped by `rowCascadeDelay` so a long feed does not
 *  choreograph for seconds. 80ms per row, standard curve, no spring. */
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
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      CLOCK_TICK_MS,
    );
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
  tone: RowTone;
  icon: LucideIcon;
  severityWord: string;
  message: string;
  tagLabel: string;
  identifier?: string;
  timeAgo: string;
  clockTime?: string;
}

interface DayGroup {
  key: string;
  label: string;
  rows: RowView[];
}

// The shell owns the log fetch, so the newest delivery can also feed the status
// band. One `useAlertsLog` instance on the page, never two.
export interface AlertsLogCardProps {
  entries: AlertLogEntry[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  reboots: RebootHistoryEntry[];
}

export function AlertsLogCard({
  entries,
  isLoading,
  isRefreshing,
  error,
  onRefresh,
  reboots,
}: AlertsLogCardProps) {
  const { t } = useTranslation("common");
  const nowSec = useNowSec();

  const feed = React.useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [
      ...entries.map(
        (entry, i): FeedRow => ({
          kind: "delivery",
          key: `d-${entry.timestamp}-${entry.channel}-${i}`,
          time: deliveryTime(entry.timestamp),
          entry,
        }),
      ),
      ...reboots.map(
        (reboot, i): FeedRow => ({
          kind: "reboot",
          key: `r-${reboot.epoch}-${i}`,
          time: Number.isFinite(reboot.epoch) ? reboot.epoch * 1000 : 0,
          reboot,
        }),
      ),
    ];
    return rows.sort((a, b) => b.time - a.time);
  }, [entries, reboots]);

  const timeAgo = React.useCallback(
    (ms: number): string => {
      const diff = Math.max(0, nowSec - Math.floor(ms / 1000));
      if (diff < 60)
        return t("alerts.activity.time.just_now", { defaultValue: "Just now" });
      if (diff < 3600)
        return t("alerts.activity.time.minutes", {
          count: Math.floor(diff / 60),
          defaultValue: "{{count}}m ago",
        });
      if (diff < DAY_SEC)
        return t("alerts.activity.time.hours", {
          count: Math.floor(diff / 3600),
          defaultValue: "{{count}}h ago",
        });
      return t("alerts.activity.time.days", {
        count: Math.floor(diff / DAY_SEC),
        defaultValue: "{{count}}d ago",
      });
    },
    [nowSec, t],
  );

  const dayLabel = React.useCallback(
    (ms: number): string => {
      const nowMs = Date.now();
      if (dayKey(ms) === dayKey(nowMs))
        return t("alerts.activity.day.today", { defaultValue: "Today" });
      if (dayKey(ms) === dayKey(nowMs - DAY_SEC * 1000))
        return t("alerts.activity.day.yesterday", {
          defaultValue: "Yesterday",
        });
      return new Date(ms).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },
    [t],
  );

  const present = React.useCallback(
    (row: FeedRow): RowView => {
      const dated = row.time > 0;
      const when = {
        timeAgo: dated
          ? timeAgo(row.time)
          : t("alerts.activity.time.unknown", { defaultValue: "Unknown" }),
        clockTime: dated
          ? new Date(row.time).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })
          : undefined,
      };

      if (row.kind === "reboot") {
        const cause = knownCause(row.reboot.cause);
        return {
          key: row.key,
          tone: REBOOT_TONE[cause],
          icon: REBOOT_GLYPH[cause],
          severityWord: t("alerts.activity.sr.reboot", {
            defaultValue: "Reboot recorded",
          }),
          message: t("alerts.activity.event.reboot", {
            defaultValue: "Modem rebooted",
          }),
          tagLabel: t(REBOOT_CAUSE_KEY[cause], {
            defaultValue: REBOOT_CAUSE_EN[cause],
          }),
          ...when,
        };
      }

      const { entry } = row;
      const sent = entry.status === "sent";
      const channel = knownChannel(entry.channel);
      return {
        key: row.key,
        tone: sent ? "sent" : "failed",
        icon: sent ? SendIcon : XCircleIcon,
        severityWord: sent
          ? t("alerts.activity.sr.sent", { defaultValue: "Alert sent" })
          : t("alerts.activity.sr.failed", { defaultValue: "Alert failed" }),
        message: entry.trigger,
        tagLabel: t(CHANNEL_KEY[channel], {
          defaultValue: CHANNEL_EN[channel],
        }),
        identifier: entry.recipient || undefined,
        ...when,
      };
    },
    [t, timeAgo],
  );

  const groups = React.useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    for (const row of feed) {
      const key = row.time > 0 ? dayKey(row.time) : "undated";
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(present(row));
      else
        out.push({
          key,
          label:
            row.time > 0
              ? dayLabel(row.time)
              : t("alerts.activity.day.undated", {
                  defaultValue: "No recorded time",
                }),
          rows: [present(row)],
        });
    }
    return out;
  }, [feed, present, dayLabel, t]);

  // A stale feed beats a blank card: with rows in hand the read failure is a
  // notice above the transcript, never a replacement for it.
  const unreadable = error !== null && feed.length === 0;

  let body: React.ReactNode;
  if (unreadable) {
    body = (
      <ConditionPanel
        tone="destructive"
        icon={UnplugIcon}
        title={t("alerts.activity.error.title", {
          defaultValue: "Could not load activity",
        })}
        description={error}
        actionLabel={t("alerts.activity.error.retry", {
          defaultValue: "Try again",
        })}
        actionIcon={RefreshCcwIcon}
        onAction={onRefresh}
      />
    );
  } else if (feed.length === 0) {
    body = (
      <ConditionPanel
        tone="muted"
        icon={BellOffIcon}
        title={t("alerts.activity.empty.title", {
          defaultValue: "Nothing has happened yet",
        })}
        description={t("alerts.activity.empty.description", {
          defaultValue:
            "Alerts appear here once a channel sends one, and reboots are recorded automatically with their cause.",
        })}
      />
    );
  } else {
    let rendered = -1;
    body = (
      <div
        // A scroll container is only reachable by keyboard once it is focusable,
        // and a focusable region needs a name (WCAG 2.1.1 / 4.1.2).
        tabIndex={0}
        role="region"
        aria-label={t("alerts.activity.transcript_label")}
        className={cn(
          LOG_STACK,
          CARD_FILL_REGION,
          "overflow-y-auto rounded-tile outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        )}
        aria-live="polite"
        aria-relevant="additions"
      >
        {groups.map((group) => (
          <div key={group.key} className={LOG}>
            <div className={DAY.ROOT}>
              <span className={DAY.LABEL}>{group.label}</span>
              <span aria-hidden className={DAY.RULE} />
            </div>
            {group.rows.map(({ key, ...row }) => {
              rendered += 1;
              return (
                <motion.div
                  key={key}
                  custom={rendered}
                  variants={rowItem}
                  initial="hidden"
                  animate="visible"
                >
                  <ActivityRow {...row} />
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className={cn(CARD_SHELL, CARD_FILL)}>
      <CardHeader className={CARD_PAD}>
        <div className={CARD_HEAD}>
          <div className="min-w-0">
            <CardTitle className={CARD_TITLE}>
              {t("alerts.activity.title", { defaultValue: "Activity" })}
            </CardTitle>
            <CardDescription className={CARD_DESC}>
              {t("alerts.activity.description", {
                defaultValue:
                  "Alerts sent and reboots recorded, newest first.",
              })}
            </CardDescription>
          </div>
          <div className={CARD_HEAD_ACTIONS}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("alerts.activity.refresh", {
                defaultValue: "Refresh activity",
              })}
              disabled={isRefreshing}
              onClick={onRefresh}
              className={cn(
                PILL_ICON,
                "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
              )}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isRefreshing && "animate-spin")}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent
        className={cn(CARD_PAD, CARD_FILL_REGION, "flex flex-col gap-4")}
      >
        {error && feed.length > 0 ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {t("alerts.activity.notice.stale", {
              message: error,
              defaultValue:
                "Showing the last activity we managed to read. {{message}}",
            })}
          </div>
        ) : null}

        {/* Skeleton and feed share ONE grid cell, so the swap costs no layout
            shift and the fill region measures the taller of the two. */}
        <div className={cn(CROSSFADE_STACK, CARD_FILL_REGION)}>
          {isLoading ? (
            <ActivityFeedSkeleton className="min-h-0" />
          ) : (
            <div className="flex min-h-0 flex-col">{body}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// The condition block. The block IS the state, and it fills the card's slack
// rather than sitting short with a void beneath it.
// -----------------------------------------------------------------------------

function ConditionPanel({
  tone,
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
}: {
  tone: ConditionTone;
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div
      role="status"
      className={cn(CONDITION.ROOT, skin.ROOT, CARD_FILL_REGION, "justify-center")}
    >
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        <Icon className={CONDITION.GLYPH} />
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAction}
          className={cn(CONDITION.ACTION, skin.ACTION)}
        >
          {ActionIcon ? <ActionIcon className={PILL_GLYPH} /> : null}
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ActivityFeedSkeleton — placeholder rows read the SAME pinned height the real
// rows do, and the block clips rather than ending short of the card's floor.
// -----------------------------------------------------------------------------

export function ActivityFeedSkeleton({
  rows = 12,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(LOG, CARD_FILL_REGION, "overflow-hidden", className)}
    >
      <div className={cn(DAY.ROOT, "flex-none")}>
        <Skeleton className={cn("h-3 w-16", SKELETON.LINE)} />
        <span aria-hidden className={DAY.RULE} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn(SKELETON.ROW, "flex-none")} />
      ))}
    </div>
  );
}

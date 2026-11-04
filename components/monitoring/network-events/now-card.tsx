"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  FRESH_WINDOW_SEC,
  eventKey,
  isFresh,
  presentEvent,
} from "@/lib/event-presentation";
import type { NetworkEvent } from "@/types/modem-status";

import { useEventsCopy, useEventsPlural, useSpanText } from "./copy";
import { groupRuns, runProbe, type EventRun } from "./derive";
import { EventRow, JumpRow } from "./event-row";
import {
  CARD_DESC,
  CARD_FILL,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  NOW,
  ROW,
  SECTION_LABEL,
} from "./shapes";

export interface NowCardProps {
  events: NetworkEvent[];
  unresolved: ReadonlySet<number>;
  nowSec: number;
  isLoading: boolean;
  timeAgo: (timestamp: number, nowSec: number) => string;
  clockTime: (timestamp: number) => string;
  onRevealRun: (run: EventRun) => void;
}

/** What is still standing, then what keeps repeating within the last hour. */
export function NowCard({
  events,
  unresolved,
  nowSec,
  isLoading,
  timeAgo,
  clockTime,
  onRevealRun,
}: NowCardProps) {
  const { t } = useTranslation("dashboard");
  const c = useEventsCopy();
  const p = useEventsPlural();
  const spanText = useSpanText();

  const ongoing = React.useMemo(
    () => [...unresolved].sort((a, b) => a - b),
    [unresolved],
  );

  const runs = React.useMemo(
    () =>
      groupRuns(events.map((event, index) => ({ event, index }))).filter(
        (item): item is EventRun =>
          item.kind === "run" &&
          nowSec - item.newest.event.timestamp < FRESH_WINDOW_SEC,
      ),
    [events, nowSec],
  );

  const shell = (body: React.ReactNode) => (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{c("networkEvents.now.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {c("networkEvents.now.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_FILL)}>{body}</CardContent>
    </Card>
  );

  if (isLoading) {
    return shell(
      <div className={NOW.BODY} aria-hidden>
        <div className={NOW.VERDICT}>
          <Skeleton className={NOW.DISC} />
          <div className={NOW.STACK}>
            <Skeleton className={cn(NOW.TITLE_LINE, "w-36")} />
            <Skeleton className={cn(NOW.CAPTION_LINE, "w-48")} />
          </div>
        </div>
        <div className={NOW.LIST}>
          <Skeleton className={cn(ROW.HEIGHT, "rounded-tile")} />
        </div>
      </div>,
    );
  }

  let title: string;
  let caption: string;
  if (ongoing.length > 0) {
    const oldest = events[ongoing[ongoing.length - 1]];
    title = p("networkEvents.now.ongoing", ongoing.length);
    caption = c("networkEvents.now.oldest_started", {
      age: timeAgo(oldest.timestamp, nowSec),
    });
  } else {
    const lastProblem = events.find((e) => e.severity !== "info");
    title = c("networkEvents.now.clear");
    caption = lastProblem
      ? c("networkEvents.now.last_problem", {
          age: timeAgo(lastProblem.timestamp, nowSec),
        })
      : events.length > 0
        ? c("networkEvents.now.no_problems")
        : c("networkEvents.now.no_events");
  }
  const alert = ongoing.length > 0;
  const VerdictGlyph = alert ? TriangleAlertIcon : CheckCircle2Icon;

  return shell(
    <div className={NOW.BODY}>
      <div className={NOW.VERDICT}>
        <span
          aria-hidden
          className={cn(NOW.DISC, ROW.TRANSITION, alert ? NOW.DISC_WARN : NOW.DISC_OK)}
        >
          <VerdictGlyph className={NOW.DISC_GLYPH} />
        </span>
        <div className={NOW.STACK}>
          <span className={NOW.TITLE}>{title}</span>
          <span className={NOW.CAPTION}>{caption}</span>
        </div>
      </div>

      <div className={NOW.LIST}>
        {ongoing.map((index) => {
          const event = events[index];
          const presentation = presentEvent(
            event,
            true,
            isFresh(event, nowSec),
            "card",
          );
          return (
            <EventRow
              key={eventKey(event)}
              event={event}
              presentation={presentation}
              typeLabel={t(`activities.events.${event.type}`, {
                defaultValue: event.type,
              })}
              severityWord={t(presentation.srSeverityKey)}
              ongoingLabel={c("networkEvents.row.ongoing")}
              unresolved
              timeAgo={timeAgo(event.timestamp, nowSec)}
              clockTime={clockTime(event.timestamp)}
            />
          );
        })}

        {runs.length > 0 ? (
          <>
            <span className={SECTION_LABEL}>
              {c("networkEvents.now.repeating")}
            </span>
            {runs.map((run) => {
              // The repeat itself is the warning here, whatever its members' severity.
              const presentation = presentEvent(
                { ...runProbe(run), severity: "warning" },
                false,
                false,
                "card",
              );
              return (
                <JumpRow
                  key={run.key}
                  presentation={presentation}
                  title={t(`activities.events.${run.newest.event.type}`, {
                    defaultValue: run.newest.event.type,
                  })}
                  meta={p("networkEvents.now.repeat_meta", run.members.length, {
                    span: spanText(run.spanSec),
                  })}
                  timeAgo={timeAgo(run.newest.event.timestamp, nowSec)}
                  clockTime={clockTime(run.newest.event.timestamp)}
                  onSelect={() => onRevealRun(run)}
                />
              );
            })}
          </>
        ) : events.length > 0 ? (
          <p className={NOW.QUIET}>{c("networkEvents.now.nothing_repeating")}</p>
        ) : null}
      </div>
    </div>,
  );
}

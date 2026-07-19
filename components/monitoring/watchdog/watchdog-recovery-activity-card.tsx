"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  TbAlertTriangleFilled,
  TbCircleCheckFilled,
  TbCircleXFilled,
} from "react-icons/tb";
import { cn } from "@/lib/utils";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import { EVENT_LABELS } from "@/constants/network-events";
import type { NetworkEvent, EventSeverity } from "@/types/modem-status";

const MotionTableRow = motion.create(TableRow);

const PAGE_SIZE = 6;

// Watchdog writes its recovery lifecycle to the shared Network Events feed using
// the existing event-type strings — no new types. We reuse that feed's hook and
// filter client-side to the two that are watchdog-relevant.
const WATCHDOG_EVENT_TYPES = new Set<NetworkEvent["type"]>([
  "watchcat_recovery",
  "sim_failover",
]);

function SeverityIcon({ severity }: { severity: EventSeverity }) {
  if (severity === "error") {
    return <TbCircleXFilled className="text-destructive size-5" />;
  }
  if (severity === "warning") {
    return <TbAlertTriangleFilled className="text-warning size-5" />;
  }
  return <TbCircleCheckFilled className="text-success size-5" />;
}

function formatEventDateTime(timestamp: number) {
  const dt = new Date(timestamp * 1000);
  return { date: dt.toLocaleDateString(), time: dt.toLocaleTimeString() };
}

export function WatchdogRecoveryActivityCard() {
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(0);

  const { events, isLoading, isRefreshing, error, refresh } =
    useRecentActivities({ maxEvents: 50 });

  const recoveryEvents = useMemo(
    () => events.filter((e) => WATCHDOG_EVENT_TYPES.has(e.type)),
    [events],
  );

  const pageCount = Math.max(1, Math.ceil(recoveryEvents.length / PAGE_SIZE));
  // Clamp the page during render (state-only adjust) rather than syncing in an
  // effect — cheaper and lint-clean.
  const safePage = Math.min(page, pageCount - 1);
  const pageEvents = recoveryEvents.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <Card className="@container/card flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle>Recovery Activity</CardTitle>
        <CardDescription>
          Recent recovery actions and SIM failover events.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label="Refresh recovery activity"
          >
            <RefreshCwIcon
              className={cn(
                "size-4",
                isRefreshing && "animate-spin motion-reduce:animate-none",
              )}
            />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon className="size-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>Couldn&apos;t load recovery activity.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={isRefreshing}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="hidden @md/card:table-cell">
                    Event
                  </TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right @md/card:text-left">
                    Time
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && recoveryEvents.length === 0 ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="hidden @md/card:table-cell">
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ml-auto h-4 w-24 @md/card:ml-0" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : recoveryEvents.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="py-12">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <HistoryIcon className="text-muted-foreground size-8" />
                        <p className="text-sm font-medium">
                          No recovery activity yet
                        </p>
                        <p className="text-muted-foreground max-w-sm text-xs">
                          Recovery actions and SIM failover events will appear
                          here when the watchdog acts on an outage.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pageEvents.map((event, index) => {
                    const { date, time } = formatEventDateTime(event.timestamp);
                    const label = EVENT_LABELS[event.type] ?? event.type;
                    return (
                      <MotionTableRow
                        key={`${event.timestamp}-${event.type}-${index}`}
                        initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.2,
                          delay: reduceMotion ? 0 : Math.min(index * 0.04, 0.4),
                          ease: "easeOut",
                        }}
                      >
                        {/* Event type — its own column on wide, folded into the
                            detail cell on narrow. */}
                        <TableCell className="hidden align-top font-medium @md/card:table-cell">
                          <div className="flex items-center gap-2">
                            <SeverityIcon severity={event.severity} />
                            <span className="text-muted-foreground text-xs">
                              {label}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {/* Folded type label — visible only when the Event
                              column is hidden. */}
                          <span className="mb-1 flex items-center gap-1.5 @md/card:hidden">
                            <SeverityIcon severity={event.severity} />
                            <span className="text-muted-foreground text-xs">
                              {label}
                            </span>
                          </span>
                          <span className="text-sm">{event.message}</span>
                        </TableCell>
                        <TableCell className="align-top text-right whitespace-nowrap @md/card:text-left">
                          <div className="flex flex-col @md/card:items-start">
                            <span className="text-sm tabular-nums">{date}</span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {time}
                            </span>
                          </div>
                        </TableCell>
                      </MotionTableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {!error && recoveryEvents.length > PAGE_SIZE && (
        <CardFooter className="justify-between gap-3 border-t pt-4">
          <span className="text-muted-foreground text-xs tabular-nums">
            Page {safePage + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 pointer-coarse:size-11"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 pointer-coarse:size-11"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

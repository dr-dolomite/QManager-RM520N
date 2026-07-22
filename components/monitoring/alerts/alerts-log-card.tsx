"use client";

import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCcwIcon,
  Clock,
  BellIcon,
  AlertCircle,
  CheckCircle2Icon,
  XCircleIcon,
  RotateCcwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlertsLog } from "@/hooks/use-alerts-log";
import type { AlertLogEntry, RebootHistoryEntry } from "@/types/alerts";
import { CHANNEL_META, REBOOT_CAUSE_META, REBOOT_TONE_BADGE } from "./constants";

const MotionTableRow = motion.create(TableRow);

// -----------------------------------------------------------------------------
// Activity — one time-ordered feed of alert deliveries + recorded reboots.
// -----------------------------------------------------------------------------
// Deliveries (sent/failed SMS/email/Discord) come from the pollable
// `useAlertsLog` hook; reboots are read-only telemetry passed down from the
// page's single `useAlerts` GET. The two shapes are interleaved by time: a
// delivery row keeps the full channel/status/recipient columns, while a reboot
// row is an *event* row — it fills the columns it owns (timestamp, label,
// cause) and leaves the delivery-only columns as muted em-dashes, so a reader
// can tell at a glance that it is something that happened, not something sent.
// -----------------------------------------------------------------------------

type FeedRow =
  | { kind: "delivery"; key: string; time: number; entry: AlertLogEntry }
  | { kind: "reboot"; key: string; time: number; reboot: RebootHistoryEntry };

/** Delivery timestamps are device-local "YYYY-MM-DD HH:MM:SS"; reboots are
 *  epoch seconds. Normalize both to a comparable ms key for one desc sort. */
function deliveryTime(ts: string): number {
  const parsed = Date.parse(ts.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Render an epoch as the same "YYYY-MM-DD HH:MM:SS" shape delivery rows use,
 *  so the timestamp column stays homogeneous. */
function formatEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function AlertsLogCard({
  refreshKey,
  reboots,
}: {
  refreshKey?: number;
  reboots: RebootHistoryEntry[];
}) {
  const {
    entries,
    total,
    isLoading,
    isRefreshing,
    error,
    lastFetched,
    refresh,
    silentRefresh,
  } = useAlertsLog();

  useEffect(() => {
    if (refreshKey) silentRefresh();
  }, [refreshKey, silentRefresh]);

  const feed = useMemo<FeedRow[]>(() => {
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

  const totalCount = total + reboots.length;

  const header = (
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Sent alerts and recorded reboots, newest first.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh activity"
          disabled={isRefreshing}
          onClick={refresh}
        >
          <RefreshCcwIcon className={cn("size-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className="@container/card min-h-0 flex-1">
        {header}
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <AlertsActivityTableSkeleton />
        </CardContent>
      </Card>
    );
  }

  // Only hard-block on error when there is genuinely nothing to show. If reboots
  // (from the page GET) are present, the feed is still useful even if the
  // delivery-log fetch failed.
  if (error && feed.length === 0) {
    return (
      <Card className="@container/card min-h-0 flex-1">
        {header}
        <CardContent className="flex min-h-0 flex-1 flex-col justify-center">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load activity</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={refresh}
              >
                <RefreshCcwIcon className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card min-h-0 flex-1">
      {header}
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-[12rem] flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-card sticky top-0 z-10">
              <TableRow>
                <TableHead scope="col" className="whitespace-nowrap">
                  Timestamp
                </TableHead>
                <TableHead scope="col">Event</TableHead>
                <TableHead scope="col" className="hidden @sm/card:table-cell">
                  Channel
                </TableHead>
                <TableHead scope="col" className="whitespace-nowrap">
                  Status
                </TableHead>
                <TableHead scope="col" className="hidden @md/card:table-cell">
                  Recipient
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-live="polite" aria-relevant="additions">
              {feed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <BellIcon className="text-muted-foreground size-8" />
                      <p className="text-muted-foreground text-sm">
                        No activity yet
                      </p>
                      <div className="grid gap-1">
                        <p className="text-muted-foreground/70 text-xs">
                          Sent alerts appear here when your connection drops past
                          the configured threshold.
                        </p>
                        <p className="text-muted-foreground/70 text-xs">
                          Reboots are recorded automatically, tagged with their
                          cause.
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                feed.map((row, index) => {
                  const entrance = {
                    initial: { opacity: 0, x: -8 },
                    animate: { opacity: 1, x: 0 },
                    transition: {
                      duration: 0.2,
                      delay: Math.min(index * 0.03, 0.3),
                      ease: "easeOut" as const,
                    },
                  };

                  if (row.kind === "reboot") {
                    const meta =
                      REBOOT_CAUSE_META[row.reboot.cause] ??
                      REBOOT_CAUSE_META.unplanned;
                    const CauseIcon = meta.icon;
                    const valid =
                      Number.isFinite(row.reboot.epoch) && row.reboot.epoch > 0;
                    return (
                      <MotionTableRow
                        key={row.key}
                        className="bg-muted/25"
                        {...entrance}
                      >
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {valid ? formatEpoch(row.reboot.epoch) : "Unknown time"}
                        </TableCell>
                        <TableCell className="min-w-0 text-sm">
                          <span className="flex items-center gap-1.5">
                            <RotateCcwIcon className="text-muted-foreground size-3.5 shrink-0" />
                            <span className="truncate">Modem rebooted</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground/40 hidden @sm/card:table-cell">
                          —
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-1 whitespace-nowrap",
                              REBOOT_TONE_BADGE[meta.tone],
                            )}
                          >
                            <CauseIcon className="size-3" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground/40 hidden @md/card:table-cell">
                          —
                        </TableCell>
                      </MotionTableRow>
                    );
                  }

                  const { entry } = row;
                  const ChannelIcon = CHANNEL_META[entry.channel]?.icon ?? BellIcon;
                  const channelShort =
                    CHANNEL_META[entry.channel]?.short ?? entry.channel;
                  return (
                    <MotionTableRow key={row.key} {...entrance}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {entry.timestamp}
                      </TableCell>
                      <TableCell className="min-w-0 text-sm">
                        <span className="block truncate">{entry.trigger}</span>
                        <span className="text-muted-foreground block truncate font-mono text-xs @md/card:hidden">
                          {entry.recipient}
                        </span>
                      </TableCell>
                      <TableCell className="hidden @sm/card:table-cell">
                        <Badge
                          variant="outline"
                          className="text-muted-foreground gap-1"
                        >
                          <ChannelIcon className="size-3" />
                          {channelShort}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.status === "sent" ? (
                          <Badge
                            variant="outline"
                            className="bg-success/15 text-success hover:bg-success/20 border-success/30 gap-1 whitespace-nowrap"
                          >
                            <CheckCircle2Icon className="size-3" />
                            Sent
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30 gap-1 whitespace-nowrap"
                          >
                            <XCircleIcon className="size-3" />
                            Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden @md/card:table-cell text-sm">
                        <span className="block truncate font-mono text-xs">
                          {entry.recipient}
                        </span>
                      </TableCell>
                    </MotionTableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {feed.length > 0 && (
        <CardFooter className="flex flex-col gap-1 @xs/card:flex-row @xs/card:items-center @xs/card:justify-between">
          <div className="text-muted-foreground text-xs">
            Showing {feed.length} of {totalCount}{" "}
            {totalCount === 1 ? "event" : "events"}
          </div>
          {lastFetched && (
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <Clock className="size-3 shrink-0" />
              Last updated: {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// AlertsActivityTableSkeleton — mirrors the real 5-column feed (Timestamp /
// Event / Channel / Status / Recipient) at the same responsive breakpoints as
// the loaded table above. Shared by this card's own `isLoading` state and the
// page-level skeleton in `alerts.tsx` so the two can never drift out of sync
// with each other, or with the real thing, and land with zero reflow.
// -----------------------------------------------------------------------------
export function AlertsActivityTableSkeleton() {
  return (
    <div className="min-h-[12rem] flex-1 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="bg-card sticky top-0 z-10">
          <TableRow>
            <TableHead scope="col" className="whitespace-nowrap">
              Timestamp
            </TableHead>
            <TableHead scope="col">Event</TableHead>
            <TableHead scope="col" className="hidden @sm/card:table-cell">
              Channel
            </TableHead>
            <TableHead scope="col" className="whitespace-nowrap">
              Status
            </TableHead>
            <TableHead scope="col" className="hidden @md/card:table-cell">
              Recipient
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="whitespace-nowrap">
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell className="hidden @sm/card:table-cell">
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-14 rounded-full" />
              </TableCell>
              <TableCell className="hidden @md/card:table-cell">
                <Skeleton className="h-4 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

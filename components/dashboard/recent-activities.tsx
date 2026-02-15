"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TbCircleCheckFilled, TbCircleXFilled } from "react-icons/tb";
import type {
  NetworkEvent,
  NetworkEventType,
  EventSeverity,
} from "@/types/modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import { useRecentActivities } from "@/hooks/use-recent-activities";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CalendarX2Icon } from "lucide-react";

// --- Event type to human-readable label mapping ---
const EVENT_LABELS: Record<NetworkEventType, string> = {
  network_mode: "Mode Change",
  band_change: "Band Change",
  pci_change: "Cell Handoff",
  ca_change: "Carrier Aggregation",
  nr_anchor: "5G Anchor",
  signal_lost: "Signal Lost",
  signal_restored: "Signal Restored",
  internet_lost: "Internet Lost",
  internet_restored: "Internet Restored",
};

// --- Severity icon component ---
function SeverityIcon({ severity }: { severity: EventSeverity }) {
  // Two categories: positive (info → check) and negative (warning/error → X)
  if (severity === "warning" || severity === "error") {
    return <TbCircleXFilled className="h-5 w-5 shrink-0 text-red-500" />;
  }
  return (
    <TbCircleCheckFilled className="h-5 w-5 shrink-0 text-green-500" />
  );
}

// --- Single event row ---
function EventRow({ event }: { event: NetworkEvent }) {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const timeAgo = formatTimeAgo(event.timestamp);

  return (
    <>
      <Separator />
      <div className="flex items-start gap-2">
        <SeverityIcon severity={event.severity} />
        <div className="flex flex-1 flex-col gap-y-0.5 min-w-0">
          <Label className="text-muted-foreground text-xs">
            {label} — {timeAgo}
          </Label>
          <p className="text-sm font-medium leading-snug">{event.message}</p>
        </div>
      </div>
    </>
  );
}

// --- Loading skeleton ---
function EventSkeleton() {
  return (
    <>
      <Separator />
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-5 rounded-full shrink-0" />
        <div className="flex flex-1 flex-col gap-y-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    </>
  );
}

// --- Main component ---
const RecentActivitiesComponent = () => {
  const { events, isLoading } = useRecentActivities();

  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold tabular-nums">
          Recent Activities
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {isLoading ? (
            // Loading state: show 3 skeleton rows
            <>
              <EventSkeleton />
              <EventSkeleton />
              <EventSkeleton />
            </>
          ) : events.length === 0 ? (
            // Empty state
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarX2Icon />
                </EmptyMedia>
                <EmptyTitle>No Events</EmptyTitle>
                <EmptyDescription className="max-w-xs text-pretty">
                  No recent network events detected. Your device is likely
                  stable and not experiencing any significant changes in network
                  conditions.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            // Event list (newest first, max 5 visible)
            events
              .slice(0, 5)
              .map((event, i) => (
                <EventRow
                  key={`${event.timestamp}-${event.type}-${i}`}
                  event={event}
                />
              ))
              
          )}
    
        </div>
      </CardContent>
    </Card>
  );
};

export default RecentActivitiesComponent;

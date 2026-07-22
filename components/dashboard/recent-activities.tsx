"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TbCircleCheckFilled, TbCircleXFilled } from "react-icons/tb";
import type { NetworkEvent, EventSeverity } from "@/types/modem-status";
import { formatTimeAgo } from "@/types/modem-status";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import { EVENT_LABELS } from "@/constants/network-events";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CalendarX2Icon } from "lucide-react";

// --- Severity icon component ---
function SeverityIcon({ severity }: { severity: EventSeverity }) {
  // Two categories: positive (info → check) and negative (warning/error → X)
  if (severity === "warning" || severity === "error") {
    return <TbCircleXFilled className="size-5 shrink-0 text-destructive" />;
  }
  return <TbCircleCheckFilled className="size-5 shrink-0 text-success" />;
}

// Stagger variants for event list
const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};
const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0 },
};

// --- Single event row ---
function EventRow({ event }: { event: NetworkEvent }) {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const timeAgo = formatTimeAgo(event.timestamp);

  return (
    <motion.div
      variants={rowVariants}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <Separator />
      <div className="flex items-start gap-2 pt-3">
        <SeverityIcon severity={event.severity} />
        <div className="flex flex-1 flex-col gap-y-0.5 min-w-0">
          <Label className="text-muted-foreground text-xs">
            {label} — {timeAgo}
          </Label>
          <p className="text-sm font-medium leading-snug">{event.message}</p>
        </div>
      </div>
    </motion.div>
  );
}

// --- Loading skeleton ---
function EventSkeleton() {
  return (
    <>
      <Separator />
      <div className="flex items-start gap-2">
        <Skeleton className="size-5 rounded-full shrink-0" />
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
  const { t } = useTranslation("dashboard");
  const { events, isLoading } = useRecentActivities();

  return (
    <Card className="@container/card">
      <CardHeader className="-mb-4">
        <CardTitle className="text-lg font-semibold">
          {t("activities.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {isLoading ? (
            // Loading state: show 6 skeleton rows (matches max visible)
            <>
              <EventSkeleton />
              <EventSkeleton />
              <EventSkeleton />
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
                <EmptyTitle>{t("activities.empty_title")}</EmptyTitle>
                <EmptyDescription className="max-w-xs text-pretty">
                  {t("activities.empty_description")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            // Event list (newest first, max 6 visible) — stagger in on mount
            <motion.div
              className="grid gap-3"
              variants={listVariants}
              initial="hidden"
              animate="visible"
            >
              {events.slice(0, 6).map((event, i) => (
                <EventRow
                  key={`${event.timestamp}-${event.type}-${i}`}
                  event={event}
                />
              ))}
            </motion.div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default RecentActivitiesComponent;

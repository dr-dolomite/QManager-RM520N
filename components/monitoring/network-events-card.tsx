"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Activity,
  Wifi,
  Radio,
  Signal,
  AlertCircle,
  BellOff,
  Clock,
  ArrowUpDown,
  ListFilter,
} from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TbAlertTriangleFilled, TbCircleCheckFilled, TbCircleXFilled } from "react-icons/tb";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

import { useRecentActivities } from "@/hooks/use-recent-activities";
import { EVENT_LABELS, EVENT_TAB_CATEGORIES } from "@/constants/network-events";
import type { NetworkEvent, EventSeverity } from "@/types/modem-status";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";

// --- Constants ---------------------------------------------------------------

type SortOrder = "newest" | "oldest" | "type";

const LIMIT_OPTIONS = [
  { label: "All Events", value: 50 },
  { label: "10 Events", value: 10 },
  { label: "25 Events", value: 25 },
] as const;

// --- Local helpers -----------------------------------------------------------

function SeverityIcon({ severity }: { severity: EventSeverity }) {
  if (severity === "error") {
    return <TbCircleXFilled className="size-6 shrink-0 text-destructive" />;
  }
  if (severity === "warning") {
    return <TbAlertTriangleFilled className="size-6 shrink-0 text-warning" />;
  }
  return <TbCircleCheckFilled className="size-6 shrink-0 text-success" />;
}

function formatEventDateTime(timestamp: number) {
  const dt = new Date(timestamp * 1000);
  return {
    date: dt.toLocaleDateString(),
    time: dt.toLocaleTimeString(),
  };
}

// --- Shared table sub-component ----------------------------------------------

interface EventsTableProps {
  events: NetworkEvent[];
  isLoading: boolean;
  emptyIcon: ReactNode;
  emptyMessage: string;
  totalCount: number;
  lastUpdate: Date | null;
}

function EventsTable({
  events,
  isLoading,
  emptyIcon,
  emptyMessage,
  totalCount,
  lastUpdate,
}: EventsTableProps) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden @md/card:table-cell">Event Type</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Date & Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && events.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="hidden @md/card:table-cell">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
              </TableRow>
            ))
          ) : events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center py-8">
                <div className="flex flex-col items-center gap-2">
                  {emptyIcon}
                  <p className="text-sm text-muted-foreground">
                    {emptyMessage}
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            events.map((event, index) => {
              const { date, time } = formatEventDateTime(event.timestamp);
              const label = EVENT_LABELS[event.type] ?? event.type;
              return (
                <MotionTableRow
                  key={`${event.timestamp}-${event.type}-${index}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: DUR.standard, delay: rowCascadeDelay(index), ease: EASE_STANDARD }}
                >
                  <TableCell className="font-medium hidden @md/card:table-cell">
                    <div className="flex items-center gap-2">
                      <SeverityIcon severity={event.severity} />
                      <span className="text-xs text-muted-foreground">
                        {label}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[12rem] @sm/card:max-w-[20rem] @md/card:max-w-md whitespace-normal break-words">
                    {event.message}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm">{date}</span>
                      <span className="text-xs text-muted-foreground">
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
      <div className="flex flex-col @sm/card:flex-row @sm/card:justify-between @sm/card:items-center gap-1 pt-4">
        <div className="text-xs text-muted-foreground">
          Showing <strong>{events.length}</strong> of{" "}
          <strong>{totalCount}</strong> event{totalCount !== 1 ? "s" : ""}
        </div>
        {lastUpdate && (
          <div className="flex items-center text-xs text-muted-foreground">
            <Clock className="h-3 w-3 mr-1 shrink-0" />
            <span className="truncate">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

// --- Main component ----------------------------------------------------------

const NetworkEventsCard = () => {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [maxEvents, setMaxEvents] = useState<number>(50);
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const { events, isLoading, isRefreshing, error, refresh } =
    useRecentActivities({
      maxEvents: 50,
      enabled: monitoringEnabled,
    });

  // Track last successful fetch completion (falling edge of in-flight, no error).
  // Catches empty-payload fetches too, so the "paused" timestamp stays accurate
  // when monitoring is toggled off after a successful but empty refresh.
  const wasFetchingRef = useRef(false);
  useEffect(() => {
    const fetching = isLoading || isRefreshing;
    if (wasFetchingRef.current && !fetching && !error) {
      setLastUpdate(new Date());
    }
    wasFetchingRef.current = fetching;
  }, [isLoading, isRefreshing, error]);

  // Filter by tab category
  const filteredEvents = useMemo(() => {
    if (activeTab === "all") return events;
    return events.filter((e) => EVENT_TAB_CATEGORIES[e.type] === activeTab);
  }, [events, activeTab]);

  // Sort
  const sortedEvents = useMemo(() => {
    const arr = [...filteredEvents];
    switch (sortOrder) {
      case "oldest":
        return arr.reverse();
      case "type":
        return arr.sort((a, b) => a.type.localeCompare(b.type));
      case "newest":
      default:
        return arr;
    }
  }, [filteredEvents, sortOrder]);

  // Apply display limit
  const displayedEvents = sortedEvents.slice(0, maxEvents);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Network Events</CardTitle>
        <CardDescription>
          Recent network events including band changes, connection drops, and
          signal changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <form className="grid gap-4">
            <FieldSet>
              <FieldGroup>
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="event-monitoring-setting">
                    Auto-refresh
                  </FieldLabel>
                  <Switch
                    id="event-monitoring-setting"
                    checked={monitoringEnabled}
                    onCheckedChange={setMonitoringEnabled}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </form>

          {!monitoringEnabled && (
            <Alert>
              <BellOff className="size-4" />
              <AlertTitle>
                Auto-refresh paused — displaying events as of{" "}
                {lastUpdate ? lastUpdate.toLocaleTimeString() : "last fetch"}.
              </AlertTitle>
            </Alert>
          )}

          <div className="flex flex-col sm:py-4">
            <div className="grid flex-1 items-start gap-4 sm:py-0 md:gap-8">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex flex-wrap items-center gap-2">
                  <TabsList className="h-11 @md/card:h-9">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="bandChanges" aria-label="Band Changes">
                      <span className="hidden @md/card:inline">Band Changes</span>
                      <Radio className="@md/card:hidden" />
                    </TabsTrigger>
                    <TabsTrigger value="networkMode" aria-label="Network Mode">
                      <span className="hidden @md/card:inline">Network Mode</span>
                      <Signal className="@md/card:hidden" />
                    </TabsTrigger>
                    <TabsTrigger value="dataConnection" aria-label="Data Connection">
                      <span className="hidden @md/card:inline">Data Connection</span>
                      <Wifi className="@md/card:hidden" />
                    </TabsTrigger>
                  </TabsList>
                  <div className="ml-auto flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1"
                        >
                          <ArrowUpDown className="h-3.5 w-3.5" />
                          <span className="sr-only @sm/card:not-sr-only @sm/card:whitespace-nowrap">
                            Sort
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                          checked={sortOrder === "newest"}
                          onCheckedChange={() => setSortOrder("newest")}
                        >
                          Newest first
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={sortOrder === "oldest"}
                          onCheckedChange={() => setSortOrder("oldest")}
                        >
                          Oldest first
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={sortOrder === "type"}
                          onCheckedChange={() => setSortOrder("type")}
                        >
                          Event type
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1"
                        >
                          <ListFilter className="h-3.5 w-3.5" />
                          <span className="sr-only @sm/card:not-sr-only @sm/card:whitespace-nowrap">
                            Limit
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Max Events</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {LIMIT_OPTIONS.map((opt) => (
                          <DropdownMenuCheckboxItem
                            key={opt.value}
                            checked={maxEvents === opt.value}
                            onCheckedChange={() => setMaxEvents(opt.value)}
                          >
                            {opt.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1"
                      onClick={refresh}
                      disabled={isRefreshing || !monitoringEnabled}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                      />
                      <span className="sr-only @sm/card:not-sr-only @sm/card:whitespace-nowrap">
                        Refresh
                      </span>
                    </Button>
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive" className="my-4">
                    <div className="flex items-center gap-x-2">
                      <AlertCircle className="size-4 shrink-0" />
                      <AlertTitle>
                        Failed to load network events: {error}
                      </AlertTitle>
                    </div>
                  </Alert>
                )}

                <TabsContent value="all">
                  <EventsTable
                    events={displayedEvents}
                    isLoading={isLoading}
                    emptyIcon={
                      <Activity className="h-8 w-8 text-muted-foreground" />
                    }
                    emptyMessage="No network events found"
                    totalCount={filteredEvents.length}
                    lastUpdate={lastUpdate}
                  />
                </TabsContent>

                <TabsContent value="bandChanges">
                  <div className="grid gap-1.5 mb-4">
                    <h3 className="text-sm font-medium">Band Changes</h3>
                    <p className="text-sm text-muted-foreground">
                      Band changes, cell handoffs, 5G anchor transitions, and
                      carrier aggregation events.
                    </p>
                  </div>
                  <EventsTable
                    events={displayedEvents}
                    isLoading={isLoading}
                    emptyIcon={
                      <Radio className="h-8 w-8 text-muted-foreground" />
                    }
                    emptyMessage="No band change events found"
                    totalCount={filteredEvents.length}
                    lastUpdate={lastUpdate}
                  />
                </TabsContent>

                <TabsContent value="networkMode">
                  <div className="grid gap-1.5 mb-4">
                    <h3 className="text-sm font-medium">Network Mode</h3>
                    <p className="text-sm text-muted-foreground">
                      Signal quality changes and network mode transitions.
                    </p>
                  </div>
                  <EventsTable
                    events={displayedEvents}
                    isLoading={isLoading}
                    emptyIcon={
                      <Signal className="h-8 w-8 text-muted-foreground" />
                    }
                    emptyMessage="No network mode events found"
                    totalCount={filteredEvents.length}
                    lastUpdate={lastUpdate}
                  />
                </TabsContent>

                <TabsContent value="dataConnection">
                  <div className="grid gap-1.5 mb-4">
                    <h3 className="text-sm font-medium">Data Connection</h3>
                    <p className="text-sm text-muted-foreground">
                      Internet connectivity, latency, and packet loss events.
                    </p>
                  </div>
                  <EventsTable
                    events={displayedEvents}
                    isLoading={isLoading}
                    emptyIcon={
                      <Wifi className="h-8 w-8 text-muted-foreground" />
                    }
                    emptyMessage="No data connection events found"
                    totalCount={filteredEvents.length}
                    lastUpdate={lastUpdate}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NetworkEventsCard;

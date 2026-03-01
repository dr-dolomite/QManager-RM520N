"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCcwIcon,
  Loader2,
  Clock,
  SearchIcon,
  Trash2Icon,
  LogsIcon,
} from "lucide-react";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/logs.sh";

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  pid: string;
  message: string;
}

interface LogStats {
  current_size_kb: number;
  current_lines: number;
  rotated_files: number;
}

interface LogsResponse {
  success: boolean;
  entries: LogEntry[];
  total: number;
  stats: LogStats;
  available_components: string[];
  error?: string;
  detail?: string;
}

const getLevelBadgeVariant = (
  level: string
): "default" | "secondary" | "destructive" | "outline" => {
  switch (level) {
    case "ERROR":
      return "destructive";
    case "WARN":
      return "outline";
    case "INFO":
      return "default";
    case "DEBUG":
      return "secondary";
    default:
      return "secondary";
  }
};

const getLevelBadgeClass = (level: string) => {
  switch (level) {
    case "WARN":
      return "border-amber-500 text-amber-600 dark:text-amber-400";
    case "INFO":
      return "bg-blue-500 text-white border-blue-500";
    default:
      return "";
  }
};

const SystemLogsCard = () => {
  // Data state
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [availableComponents, setAvailableComponents] = useState<string[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);

  // Filter state
  const [level, setLevel] = useState<string>("all");
  const [component, setComponent] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [lines, setLines] = useState<string>("100");
  const [includeRotated, setIncludeRotated] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Refs
  const mountedRef = useRef(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch logs from backend
  // ---------------------------------------------------------------------------
  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("lines", lines);
        if (level !== "all") params.set("level", level);
        if (component !== "all") params.set("component", component);
        if (search.trim()) params.set("search", search.trim());
        if (includeRotated) params.set("include_rotated", "1");

        const resp = await fetch(`${CGI_ENDPOINT}?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: LogsResponse = await resp.json();
        if (!mountedRef.current) return;

        if (data.success) {
          setEntries(data.entries);
          setTotalEntries(data.total);
          setStats(data.stats);
          setAvailableComponents(data.available_components);
          setLastFetched(new Date());
        }
      } catch {
        if (mountedRef.current && !silent) {
          toast.error("Failed to load system logs");
        }
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [level, component, search, lines, includeRotated]
  );

  // Initial fetch + re-fetch on filter change
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10s (silent)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // ---------------------------------------------------------------------------
  // Search debounce
  // ---------------------------------------------------------------------------
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
    }, 400);
  };

  // ---------------------------------------------------------------------------
  // Clear logs
  // ---------------------------------------------------------------------------
  const handleClearLogs = async () => {
    setIsClearing(true);

    try {
      const resp = await fetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success("Log files cleared");
        setShowClearDialog(false);
        await fetchLogs(true);
      } else {
        toast.error(data.detail || "Failed to clear logs");
      }
    } catch {
      if (mountedRef.current) {
        toast.error("Failed to clear logs");
      }
    } finally {
      if (mountedRef.current) {
        setIsClearing(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Logs</CardTitle>
          <CardDescription>
            QManager application logs from all components.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-9" />
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Logs</CardTitle>
          <CardDescription>
            QManager application logs from all components.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Level filter */}
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All Levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="DEBUG">DEBUG</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
                <SelectItem value="WARN">WARN</SelectItem>
                <SelectItem value="ERROR">ERROR</SelectItem>
              </SelectContent>
            </Select>

            {/* Component filter */}
            <Select value={component} onValueChange={setComponent}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Components" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Components</SelectItem>
                {availableComponents.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Search input */}
            <div className="relative flex-1 min-w-48">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* Lines limit */}
            <Select value={lines} onValueChange={setLines}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>

            {/* Include rotated switch */}
            <div className="flex items-center gap-2">
              <Switch
                id="include-rotated"
                checked={includeRotated}
                onCheckedChange={setIncludeRotated}
              />
              <label
                htmlFor="include-rotated"
                className="text-sm text-muted-foreground whitespace-nowrap"
              >
                Include rotated
              </label>
            </div>

            {/* Refresh button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => fetchLogs()}
            >
              <RefreshCcwIcon className="h-4 w-4" />
            </Button>

            {/* Clear button */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowClearDialog(true)}
            >
              <Trash2Icon className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>

          {/* Log table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Timestamp</TableHead>
                  <TableHead className="w-20">Level</TableHead>
                  <TableHead className="w-32 hidden md:table-cell">
                    Component
                  </TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <LogsIcon className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          No log entries found
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {entry.timestamp}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getLevelBadgeVariant(entry.level)}
                          className={getLevelBadgeClass(entry.level)}
                        >
                          {entry.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {entry.component}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-lg break-words text-sm">
                        {entry.message}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="text-xs text-muted-foreground">
            Showing <strong>{entries.length}</strong> of{" "}
            <strong>{totalEntries}</strong> entries
            {stats && (
              <span className="ml-2">
                ({stats.current_size_kb}KB, {stats.rotated_files} rotated file
                {stats.rotated_files !== 1 ? "s" : ""})
              </span>
            )}
          </div>
          {lastFetched && (
            <div className="flex items-center text-xs text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" />
              Last updated: {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Clear confirmation dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear System Logs</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all log entries including rotated
              files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              onClick={handleClearLogs}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Clearing...
                </>
              ) : (
                "Clear All Logs"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SystemLogsCard;

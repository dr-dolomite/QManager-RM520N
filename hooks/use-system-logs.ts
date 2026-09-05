"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type {
  LevelFilter,
  LogEntry,
  LogStats,
  LogsResponse,
} from "@/types/system-logs";

// =============================================================================
// useSystemLogs — read, filter, poll and clear /tmp/qmanager.log
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/system/logs.sh
//
// `lines`, `component`, `search` and `include_rotated` are server-side. `level`
// is NOT: the backend's `level` is a minimum-severity FLOOR, so a filtered
// window cannot report the rail's other counts and picking WARN also showed
// ERROR. One unfiltered window is fetched and the level is applied in the view.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/logs.sh";

/** The silent refresh cadence, unchanged from the surface this replaces. */
export const POLL_INTERVAL_MS = 10_000;

/** How long the search field waits before it becomes a request. */
const SEARCH_DEBOUNCE_MS = 400;

export const LINE_BUDGETS = ["50", "100", "200", "500"] as const;

/**
 * What the feed is actually doing, with real referents.
 *
 * `live`    — the interval is armed and the last read landed.
 * `paused`  — deliberately suspended: the tab is hidden, or a dialog is open.
 * `stopped` — the last read failed, so the feed is not delivering.
 */
export type FeedState = "live" | "paused" | "stopped";

export interface UseSystemLogsOptions {
  /** Suspend the poll — the clear-confirmation dialog sets this. */
  paused?: boolean;
}

export interface UseSystemLogsReturn {
  entries: LogEntry[];
  stats: LogStats | null;
  availableComponents: string[];
  isLoading: boolean;
  /** Non-null when the most recent read failed, background or foreground. */
  error: string | null;
  isRefreshing: boolean;
  isClearing: boolean;
  feedState: FeedState;
  /** Epoch seconds of the last read that landed. */
  lastReadAtSec: number | null;

  level: LevelFilter;
  setLevel: (next: LevelFilter) => void;
  component: string;
  setComponent: (next: string) => void;
  /** The field's live text — the request follows it after a debounce. */
  searchInput: string;
  setSearchInput: (next: string) => void;
  lines: string;
  setLines: (next: string) => void;
  includeRotated: boolean;
  setIncludeRotated: (next: boolean) => void;
  /** True when any filter is narrowing the view. */
  filtersActive: boolean;
  clearFilters: () => void;

  /** User-initiated read. Resolves false when it failed. */
  refresh: () => Promise<boolean>;
  clear: () => Promise<boolean>;
}

export function useSystemLogs({
  paused = false,
}: UseSystemLogsOptions = {}): UseSystemLogsReturn {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [availableComponents, setAvailableComponents] = useState<string[]>([]);

  const [level, setLevel] = useState<LevelFilter>("all");
  const [component, setComponent] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState("100");
  const [includeRotated, setIncludeRotated] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReadAtSec, setLastReadAtSec] = useState<number | null>(null);
  const [tabHidden, setTabHidden] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = () => setTabHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // The search field drives a debounced request rather than a keystroke each.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchLogs = useCallback(
    async (silent: boolean): Promise<boolean> => {
      if (!silent) setIsRefreshing(true);

      try {
        const params = new URLSearchParams();
        params.set("lines", lines);
        if (component !== "all") params.set("component", component);
        if (search.trim()) params.set("search", search.trim());
        if (includeRotated) params.set("include_rotated", "1");

        const resp = await authFetch(`${CGI_ENDPOINT}?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: LogsResponse = await resp.json();
        if (!mountedRef.current) return false;
        if (!data.success) {
          throw new Error(data.detail || data.error || "read_failed");
        }

        setEntries(data.entries ?? []);
        setStats(data.stats ?? null);
        setAvailableComponents(data.available_components ?? []);
        setLastReadAtSec(Math.floor(Date.now() / 1000));
        setError(null);
        return true;
      } catch (err) {
        // A failed background poll is NOT silent any more: it sets the error
        // that drives the stale notice. Only the toast is foreground-only.
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "read_failed");
        return false;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          if (!silent) setIsRefreshing(false);
        }
      }
    },
    [lines, component, search, includeRotated],
  );

  // First read, and one on every server-side filter change.
  useEffect(() => {
    void fetchLogs(true);
  }, [fetchLogs]);

  // The poll. Deliberately torn down while suspended, which is exactly what
  // `paused` reports — the interval and the face cannot disagree.
  const pollSuspended = paused || tabHidden;
  useEffect(() => {
    if (pollSuspended) return;
    const id = setInterval(() => void fetchLogs(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollSuspended, fetchLogs]);

  const refresh = useCallback(() => fetchLogs(false), [fetchLogs]);

  const clear = useCallback(async (): Promise<boolean> => {
    setIsClearing(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: { success?: boolean } = await resp.json();
      if (!mountedRef.current) return false;
      if (!data.success) return false;
      await fetchLogs(true);
      return true;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  }, [fetchLogs]);

  const clearFilters = useCallback(() => {
    setLevel("all");
    setComponent("all");
    setSearchInput("");
    setSearch("");
  }, []);

  const filtersActive =
    level !== "all" || component !== "all" || searchInput.trim() !== "";

  const feedState: FeedState = error
    ? "stopped"
    : pollSuspended
      ? "paused"
      : "live";

  return {
    entries,
    stats,
    availableComponents,
    isLoading,
    error,
    isRefreshing,
    isClearing,
    feedState,
    lastReadAtSec,
    level,
    setLevel,
    component,
    setComponent,
    searchInput,
    setSearchInput,
    lines,
    setLines,
    includeRotated,
    setIncludeRotated,
    filtersActive,
    clearFilters,
    refresh,
    clear,
  };
}

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { AlertLogEntry } from "@/types/alerts";

// =============================================================================
// useAlertsLog — merged SMS + email + Discord alert history
// =============================================================================
// Posts { action: "get_log" } to the unified CGI, which merges every channel's
// delivery log, tags each entry with its channel, and returns newest-first.
//
// Backend: POST /cgi-bin/quecmanager/monitoring/alerts.sh { action: "get_log" }
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/alerts.sh";

interface AlertsLogResponse {
  success: boolean;
  entries: AlertLogEntry[];
  total: number;
  error?: string;
}

export interface UseAlertsLogReturn {
  entries: AlertLogEntry[];
  total: number;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastFetched: Date | null;
  refresh: () => void;
  silentRefresh: () => void;
}

export function useAlertsLog(): UseAlertsLogReturn {
  const { t } = useTranslation("errors");
  // Read through a ref so a language switch does not refetch the log.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [entries, setEntries] = useState<AlertLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchLog = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "initial") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === "initial") setIsLoading(true);
      if (mode === "refresh") setIsRefreshing(true);
      setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_log" }),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: AlertsLogResponse = await resp.json();
        if (controller.signal.aborted) return;

        if (data.success) {
          setEntries(data.entries);
          setTotal(data.total);
          setLastFetched(new Date());
        } else {
          const msg = resolveErrorMessage(
            tRef.current,
            data.error,
            undefined,
            "Failed to load alert log",
          );
          setError(msg);
          // A failed load on mount shows in the card; only a user's refresh toasts.
          if (mode === "refresh") toast.error(msg);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load alert log";
        setError(msg);
        if (mode === "refresh") toast.error(msg);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    fetchLog("initial");
  }, [fetchLog]);

  return {
    entries,
    total,
    isLoading,
    isRefreshing,
    error,
    lastFetched,
    refresh: useCallback(() => fetchLog("refresh"), [fetchLog]),
    silentRefresh: useCallback(() => fetchLog("silent"), [fetchLog]),
  };
}

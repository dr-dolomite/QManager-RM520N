"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  HealthCheckJob,
  RunResponse,
  TestOutputResponse,
} from "@/types/system-health-check";

const CGI_BASE = "/cgi-bin/quecmanager/system/health-check";
const POLL_INTERVAL_MS = 500;
/**
 * Right after a POST the status file can still hold the PREVIOUS job. Polls reading
 * another job id are ignored this many times; after that the file wins.
 */
const STALE_READ_BUDGET = 10;
/** Safari has cancelled downloads whose object URL is revoked in the same task. */
const REVOKE_DELAY_MS = 1000;

/** `status.sh` returns the LAST 4096 bytes, so the flag rides with the text. */
export interface TestOutput {
  output: string;
  truncated: boolean;
}

export type FetchTestOutput = (testId: string) => Promise<TestOutput>;

/** A backend refusal: the envelope's code and detail, kept apart for `resolveErrorMessage`. */
class HealthCheckError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly detail: string | undefined,
  ) {
    super(detail || code || "");
  }
}

export interface UseSystemHealthCheckReturn {
  job: HealthCheckJob | null;
  /** True until the FIRST status read settles, success or failure. */
  isLoading: boolean;
  isRunning: boolean;
  isStarting: boolean;
  isClearing: boolean;
  isDownloading: boolean;
  error: string | null;
  start: () => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
  fetchTestOutput: FetchTestOutput;
  downloadBundle: () => Promise<void>;
}

export function useSystemHealthCheck(): UseSystemHealthCheckReturn {
  const { t } = useTranslation("system-health-check");
  const { t: tErrors } = useTranslation("errors");
  const [job, setJob] = useState<HealthCheckJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aborted = useRef(false);
  /** The job id this tab just started, until the status file shows it. */
  const awaitedJobId = useRef<string | null>(null);
  const staleReads = useRef(0);

  /**
   * `t` changes identity on every language switch, and this hook's poll effect
   * is keyed on a callback — putting `t` in a dep array would tear the interval
   * down and never re-arm it. The ref keeps the wording fresh instead.
   */
  const tRef = useRef(t);
  tRef.current = t;
  const tErrorsRef = useRef(tErrors);
  tErrorsRef.current = tErrors;

  /** The failure reason for a toast, from THIS call's own error. */
  const describe = useCallback((e: unknown): string => {
    if (e instanceof HealthCheckError) {
      return resolveErrorMessage(tErrorsRef.current, e.code, e.detail, tErrorsRef.current("unknown"));
    }
    return tErrorsRef.current("unknown");
  }, []);

  const fetchStatus = useCallback(async (): Promise<HealthCheckJob | null> => {
    const res = await authFetch(`${CGI_BASE}/status.sh`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data?.status === "none") return null;
    return data as HealthCheckJob;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchStatus();
      if (aborted.current) return;
      const awaited = awaitedJobId.current;
      if (awaited && next?.job_id !== awaited && staleReads.current < STALE_READ_BUDGET) {
        staleReads.current += 1;
        // A fresh object re-arms the poll effect without adopting the old job.
        setJob((prev) => (prev ? { ...prev } : prev));
        return;
      }
      awaitedJobId.current = null;
      setJob(next);
      setError(null);
    } catch (e) {
      if (aborted.current) return;
      setError(describe(e));
    } finally {
      // Latches false on the first settle. A later poll must never flip it back,
      // or a refresh would redraw the whole surface as skeletons.
      if (!aborted.current) setIsLoading(false);
    }
  }, [fetchStatus, describe]);

  // Initial fetch on mount.
  useEffect(() => {
    aborted.current = false;
    void refresh();
    return () => {
      aborted.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  // Polling loop while job is running.
  useEffect(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (!job || job.status !== "running") return;
    pollTimer.current = setTimeout(async () => {
      if (aborted.current) return;
      await refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [job, refresh]);

  const start = useCallback(async () => {
    setIsStarting(true);
    try {
      const res = await authFetch(`${CGI_BASE}/run.sh`, { method: "POST" });
      const data = (await res.json()) as RunResponse;
      if (aborted.current) return;
      if (!data.success || !data.job_id) {
        throw new HealthCheckError(data.error, data.detail);
      }
      // Seed a synthetic "running" job so the polling effect starts. A resumed
      // run is already in the file; a fresh one waits until the file shows its id.
      awaitedJobId.current = data.resumed ? null : data.job_id;
      staleReads.current = 0;
      setJob({
        job_id: data.job_id,
        status: "running",
        started_at: data.started_at ?? Math.floor(Date.now() / 1000),
        finished_at: null,
        pid: 0,
        summary: { pass: 0, fail: 0, warn: 0, skip: 0, total: 0 },
        tests: [],
        tarball_path: null,
        tarball_size: null,
        error: null,
      });
    } catch (e) {
      if (aborted.current) return;
      // Toast only: `error` tells the view the JOB is unreachable; a refused start does not.
      toast.error(tRef.current("toast.run_failed"), { description: describe(e) });
    } finally {
      if (!aborted.current) setIsStarting(false);
    }
  }, [describe]);

  const clear = useCallback(async () => {
    setIsClearing(true);
    try {
      const res = await authFetch(`${CGI_BASE}/clear.sh`, { method: "POST" });
      const data = await res.json();
      if (aborted.current) return;
      if (!data?.success) {
        throw new HealthCheckError(data?.error, data?.detail);
      }
      awaitedJobId.current = null;
      setJob(null);
      toast.success(tRef.current("toast.cleared"));
    } catch (e) {
      if (aborted.current) return;
      toast.error(tRef.current("toast.clear_failed"), { description: describe(e) });
    } finally {
      if (!aborted.current) setIsClearing(false);
    }
  }, [describe]);

  const fetchTestOutput = useCallback<FetchTestOutput>(
    async (testId: string): Promise<TestOutput> => {
      const res = await authFetch(
        `${CGI_BASE}/status.sh?test_id=${encodeURIComponent(testId)}`,
      );
      // The panel shows the message as is, so throw an already-localized one.
      if (!res.ok) throw new Error(describe(new HealthCheckError(undefined, undefined)));
      const data = (await res.json()) as TestOutputResponse;
      if (!data.success) {
        throw new Error(describe(new HealthCheckError(data.error, data.detail)));
      }
      return { output: data.output ?? "", truncated: data.truncated === true };
    },
    [describe],
  );

  /**
   * `download.sh` answers a missing or malformed bundle with a JSON error body,
   * so navigating to it would leave the app and render that JSON as page text.
   * Fetch it instead, and only hand the browser a Blob once it is really gzip.
   *
   * It reports through its toast alone: `error` is the channel the view reads to
   * decide the JOB is unreachable, and a failed download says nothing about that.
   */
  const downloadBundle = useCallback(async () => {
    const jobId = job?.job_id;
    if (!jobId || !job?.tarball_path) return;
    setIsDownloading(true);
    try {
      const res = await authFetch(
        `${CGI_BASE}/download.sh?job_id=${encodeURIComponent(jobId)}`,
      );
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || contentType.includes("application/json")) {
        let code: string | undefined;
        let detail: string | undefined;
        try {
          const body = (await res.json()) as { error?: string; detail?: string };
          code = body.error;
          detail = body.detail ?? detail;
        } catch {
          // A non-JSON failure body tells us nothing the status did not.
        }
        throw new HealthCheckError(code, detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `qmanager-health-check-${jobId}.tar.gz`;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, REVOKE_DELAY_MS);
    } catch (e) {
      if (aborted.current) return;
      toast.error(tRef.current("toast.download_failed"), { description: describe(e) });
    } finally {
      if (!aborted.current) setIsDownloading(false);
    }
  }, [job, describe]);

  const isRunning = job?.status === "running";

  return {
    job,
    isLoading,
    isRunning: !!isRunning,
    isStarting,
    isClearing,
    isDownloading,
    error,
    start,
    clear,
    refresh,
    fetchTestOutput,
    downloadBundle,
  };
}

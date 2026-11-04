"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type { MutationResult } from "@/types/mutation-result";
import type {
  SitesConfig,
  SitesFailure,
  SitesRange,
  SitesResponse,
} from "@/types/sites";

// Sites monitor: polls the sites CGI, faster while a sweep runs or a check is pending.

const ENDPOINT = "/cgi-bin/quecmanager/monitoring/sites.sh";
const IDLE_POLL_MS = 30_000;
const BUSY_POLL_MS = 3_000;
/** Each "now" read renews the daemon's live lease, so it polls only while the tab is visible. */
const LIVE_POLL_MS = 2_000;
/** A check the daemon never picked up stops counting as pending after this. */
const PENDING_TIMEOUT_MS = 90_000;

interface PendingCheck {
  sinceMs: number;
  baseline: number | null;
  sawChecking: boolean;
}

export interface UseSitesReturn {
  data: SitesResponse | null;
  /** The range `data` was read for; it lags `range` until the new read lands. */
  dataRange: SitesRange | null;
  isLoading: boolean;
  error: string | null;
  /** True from a successful check-now until the sweep it asked for lands. */
  checkPending: boolean;
  refresh: () => void;
  checkNow: () => Promise<MutationResult>;
  save: (config: SitesConfig) => Promise<MutationResult>;
}

async function postSites(body: object): Promise<MutationResult> {
  try {
    const res = await authFetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as SitesResponse | SitesFailure;
    if (!json.success) {
      return { ok: false, error: json.detail ?? json.reason ?? json.error ?? null };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : null };
  }
}

export function useSites(range: SitesRange): UseSitesReturn {
  const [data, setData] = useState<SitesResponse | null>(null);
  const [dataRange, setDataRange] = useState<SitesRange | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkPending, setCheckPending] = useState(false);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const rangeRef = useRef(range);
  const checkedAtRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingCheck | null>(null);

  const fetchSites = useCallback(async (r: SitesRange) => {
    // Only the newest request may land, so a slow 7 d read never overwrites 1 h.
    const seq = ++seqRef.current;
    try {
      const res = await authFetch(`${ENDPOINT}?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SitesResponse | SitesFailure;
      if (!mountedRef.current || seq !== seqRef.current) return;
      if (!json.success) throw new Error(json.detail ?? json.error);

      setData(json);
      setDataRange(r);
      setError(null);
      checkedAtRef.current = json.checked_at;

      const pending = pendingRef.current;
      if (pending) {
        if (json.checking) pending.sawChecking = true;
        const landed =
          !json.checking &&
          (pending.sawChecking || json.checked_at !== pending.baseline);
        if (landed || Date.now() - pending.sinceMs > PENDING_TIMEOUT_MS) {
          pendingRef.current = null;
          setCheckPending(false);
        }
      }
    } catch (err) {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read sites");
    } finally {
      if (mountedRef.current && seq === seqRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rangeRef.current = range;
    // A hidden tab on "now" leaves the first read to the visibility handler, so no lease renews.
    if (range === "now" && document.visibilityState !== "visible") return;
    void fetchSites(range);
  }, [range, fetchSites]);

  const busy = (data?.checking ?? false) || checkPending;
  // A disabled monitor has nothing live to show, so "now" drops to the idle cadence.
  const live = range === "now" && data?.enabled !== false;
  const cadence = live ? "live" : busy ? BUSY_POLL_MS : IDLE_POLL_MS;
  useEffect(() => {
    if (cadence !== "live") {
      const id = window.setInterval(() => void fetchSites(rangeRef.current), cadence);
      return () => window.clearInterval(id);
    }

    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const start = () => {
      if (id === null) id = window.setInterval(() => void fetchSites("now"), LIVE_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchSites("now");
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [cadence, fetchSites]);

  const refresh = useCallback(() => {
    void fetchSites(rangeRef.current);
  }, [fetchSites]);

  const checkNow = useCallback(async () => {
    const result = await postSites({ action: "check_now" });
    if (result.ok && mountedRef.current) {
      pendingRef.current = {
        sinceMs: Date.now(),
        baseline: checkedAtRef.current,
        sawChecking: false,
      };
      setCheckPending(true);
      void fetchSites(rangeRef.current);
    }
    return result;
  }, [fetchSites]);

  const save = useCallback(
    async (config: SitesConfig) => {
      const result = await postSites({ action: "save", ...config });
      if (result.ok && mountedRef.current) void fetchSites(rangeRef.current);
      return result;
    },
    [fetchSites],
  );

  return { data, dataRange, isLoading, error, checkPending, refresh, checkNow, save };
}

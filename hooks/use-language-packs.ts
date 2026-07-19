"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageCode, LanguagePackInstallState } from "@/types/i18n";
import {
  cancelLanguagePackInstall,
  fetchLanguagePackList,
  getLanguagePackInstallStatus,
  removeLanguagePack,
  startLanguagePackInstall,
  type LanguagePackListResponse,
  type MutationResult,
} from "@/lib/i18n/language-pack-client";
import { DEFAULT_MANIFEST_URL } from "@/lib/i18n/language-pack-manifest";
import { resolveInstallError } from "@/lib/i18n/resolve-error";
import { syncInstalledPacks } from "@/lib/i18n/installed-store";

const STATUS_POLL_INTERVAL_MS = 1500;

// Non-terminal install states keep the poller alive; anything else stops it.
const ACTIVE_STATES = new Set<LanguagePackInstallState["state"]>([
  "pending",
  "downloading",
  "verifying",
  "extracting",
  "validating",
  "installing",
  "cancelling",
]);

function isTerminal(state: LanguagePackInstallState["state"]): boolean {
  return !ACTIVE_STATES.has(state);
}

export interface UseLanguagePacksReturn {
  list: LanguagePackListResponse | null;
  isLoading: boolean;
  isRefetching: boolean;
  listError: string | null;
  install: LanguagePackInstallState;
  startInstall: (code: LanguageCode) => Promise<MutationResult>;
  cancelInstall: () => Promise<void>;
  remove: (code: LanguageCode) => Promise<MutationResult>;
  refetch: () => Promise<void>;
  manifestUrl: string;
}

export function useLanguagePacks(
  manifestUrl: string = DEFAULT_MANIFEST_URL,
): UseLanguagePacksReturn {
  const [list, setList] = useState<LanguagePackListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [install, setInstall] = useState<LanguagePackInstallState>({
    state: "idle",
    progress: 0,
  });

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const fetchList = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      else setIsRefetching(true);
      setListError(null);
      try {
        const result = await fetchLanguagePackList(manifestUrl);
        if (!mountedRef.current) return;
        setList(result);
        // Mirror installed downloaded packs so the NavUser switcher can list
        // them without its own network round-trip.
        syncInstalledPacks(result.installed);
      } catch (err) {
        if (!mountedRef.current) return;
        setListError(err instanceof Error ? err.message : "Failed to load packs");
      } finally {
        if (mountedRef.current) {
          if (!silent) setIsLoading(false);
          else setIsRefetching(false);
        }
      }
    },
    [manifestUrl],
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Poll install status ONLY while an install is active. Started by startInstall,
  // stopped on any terminal state.
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await getLanguagePackInstallStatus();
        if (!mountedRef.current) return;
        setInstall(status);
        if (isTerminal(status.state)) {
          stopPolling();
          // A new pack may now be on disk (done) or gone (cancelled/failed).
          await fetchList(true);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setInstall({
          state: "failed",
          progress: 100,
          message: err instanceof Error ? err.message : "Status poll failed",
        });
        stopPolling();
      }
    }, STATUS_POLL_INTERVAL_MS);
  }, [fetchList, stopPolling]);

  const startInstall = useCallback(
    async (code: LanguageCode) => {
      setInstall({ state: "pending", code, progress: 0, message: "" });
      const res = await startLanguagePackInstall(code, manifestUrl);
      if (!res.ok) {
        setInstall({
          state: "failed",
          code,
          progress: 100,
          message: resolveInstallError(
            res.error,
            undefined,
            "Couldn't start the install.",
          ),
        });
        return res;
      }
      startPolling();
      return res;
    },
    [manifestUrl, startPolling],
  );

  const cancelInstall = useCallback(async () => {
    setInstall((prev) => ({ ...prev, state: "cancelling" }));
    try {
      await cancelLanguagePackInstall();
    } catch {
      // Swallow — the poller surfaces the eventual failed/cancelled state.
    }
  }, []);

  const remove = useCallback(
    async (code: LanguageCode) => {
      const res = await removeLanguagePack(code);
      if (res.ok) await fetchList(true);
      return res;
    },
    [fetchList],
  );

  return {
    list,
    isLoading,
    isRefetching,
    listError,
    install,
    startInstall,
    cancelInstall,
    remove,
    refetch: () => fetchList(true),
    manifestUrl,
  };
}

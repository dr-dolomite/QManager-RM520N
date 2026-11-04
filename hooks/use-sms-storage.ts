"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// useSmsStorage — where incoming SMS are stored (modem or SIM)
// =============================================================================
// Reads the saved choice plus per-storage counts, and saves a new choice. The
// backend applies it on the modem and reads it back before answering, so a
// success means new messages already land in the chosen storage. Existing
// messages never move: the inbox keeps reading both storages.
//
// Backend: GET/POST /cgi-bin/quecmanager/cellular/sms_storage.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms_storage.sh";
const K = "sms.storage";

export type SmsStorageChoice = "ME" | "SM";

export interface SmsStorageUsage {
  storage: SmsStorageChoice;
  used: number;
  total: number;
}

export interface SmsStorageData {
  /** The saved choice. */
  storage: SmsStorageChoice;
  /** Per-storage counts; a storage that could not be read is absent. */
  usage: Partial<Record<SmsStorageChoice, SmsStorageUsage>>;
}

/** A mutation's outcome; `error` is already resolved for display. */
export type SmsStorageResult = { ok: true } | { ok: false; error: string };

export interface UseSmsStorageReturn {
  data: SmsStorageData | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Why the last read failed (translated). Saves return theirs. */
  error: string | null;
  save: (storage: SmsStorageChoice) => Promise<SmsStorageResult>;
  refresh: () => void;
}

const isChoice = (v: unknown): v is SmsStorageChoice => v === "ME" || v === "SM";

export function useSmsStorage(): UseSmsStorageReturn {
  const { t } = useTranslation("cellular");
  // Read through a ref: `t` in the callbacks' deps would rebuild them on a
  // language switch and re-arm the poll.
  const tRef = useRef(t);
  tRef.current = t;
  const [data, setData] = useState<SmsStorageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const resp = await authFetch(CGI_ENDPOINT);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!mountedRef.current) return;
        if (!json.success) {
          if (!silent) {
            setError(resolveErrorMessage(
              tRef.current, json.error, json.detail, tRef.current(`${K}.load_failed`)));
          }
          return;
        }
        const usage: SmsStorageData["usage"] = {};
        if (Array.isArray(json.storages)) {
          for (const s of json.storages as Array<Record<string, unknown>>) {
            const name = s?.storage;
            if (isChoice(name) && typeof s.used === "number" && typeof s.total === "number") {
              usage[name] = { storage: name, used: s.used, total: s.total };
            }
          }
        }
        setData({ storage: isChoice(json.storage) ? json.storage : "ME", usage });
      } catch {
        if (mountedRef.current && !silent) setError(tRef.current(`${K}.load_failed`));
      } finally {
        if (mountedRef.current && !silent) setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const save = useCallback(
    async (storage: SmsStorageChoice): Promise<SmsStorageResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storage }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              tRef.current, json.error, json.detail, tRef.current(`${K}.save_failed`)),
          };
        }
        if (mountedRef.current) await fetchData(true);
        return { ok: true };
      } catch {
        return { ok: false, error: tRef.current(`${K}.save_failed`) };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchData],
  );

  const refresh = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  return { data, isLoading, isSaving, error, save, refresh };
}

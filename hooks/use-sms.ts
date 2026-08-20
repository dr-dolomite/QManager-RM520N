"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  SmsMessage,
  SmsStorage,
  SmsInboxResponse,
  SmsActionResponse,
} from "@/types/sms";

// =============================================================================
// useSms — SMS Inbox Fetch & Mutation Hook
// =============================================================================
// Fetches inbox messages + storage status on mount.
// Provides sendSms, deleteSms, deleteAllSms for mutations.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/sms.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms.sh";

export interface SmsData {
  messages: SmsMessage[];
  storage: SmsStorage;
}

export interface UseSmsReturn {
  /** Current SMS data (null before first fetch) */
  data: SmsData | null;
  /**
   * Epoch ms of the last GET that actually returned an inbox, or `null` before
   * the first one lands. Set on the success branch and deliberately PRESERVED
   * on the error branch, so the staleness chip can say how old the rows on
   * screen are rather than blanking them.
   *
   * This is the CLIENT's own clock, not a field from the CGI, and that is the
   * point: a server-side stamp would report when the shell script ran, which is
   * not the same question as "when did this browser last see good data". It is
   * also why nothing derives it from `Date.now()` during render — the value is
   * captured inside the fetch callback and read back as data, which keeps
   * `react-hooks/purity` satisfied at every consumer.
   */
  lastSuccessfulFetch: number | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /**
   * True while ANY inbox GET is in flight, silent ones included.
   *
   * `isLoading` cannot answer that question — it is deliberately scoped to the
   * first, non-silent load, because it is what swaps the whole card for a
   * skeleton. A refresh is silent by design (see `refresh`), so before this flag
   * existed nothing on the refresh path was observable at all: the Retry button
   * was wired to `isSaving`, which only send/delete ever sets, so its spinner
   * could never fire.
   */
  isFetching: boolean;
  /** True while a send/delete operation is in progress */
  isSaving: boolean;
  /** Error message if any operation failed */
  error: string | null;
  /** Send an SMS message. Returns true on success. */
  sendSms: (phone: string, message: string) => Promise<boolean>;
  /** Delete a message by its storage indexes. Returns true on success.
   *  `storage` selects which modem memory (ME / SM) the indexes live in;
   *  the backend deletes one storage per call. */
  deleteSms: (indexes: number[], storage: "ME" | "SM") => Promise<boolean>;
  /** Delete all messages. Returns true on success. */
  deleteAllSms: () => Promise<boolean>;
  /** Re-fetch inbox data. Pass true for silent (no loading skeleton). */
  refresh: (silent?: boolean) => void;
}

export function useSms(): UseSmsReturn {
  const [data, setData] = useState<SmsData | null>(null);
  const [lastSuccessfulFetch, setLastSuccessfulFetch] = useState<number | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  /**
   * The in-flight guard, and why this hook needs one.
   *
   * ONE inbox GET takes the shared AT lock SIX times and returned 13 KB on the
   * live device. Concurrent GETs do not go faster — they queue behind each
   * other on `/tmp/qmanager_at.lock`, contending with the status poller and the
   * connection watchdog for the same lock, so a burst of Refresh clicks starves
   * unrelated subsystems for the duration.
   *
   * `queuedRef` is the other half, and it is not optional. A re-fetch requested
   * while another is in flight is usually a POST-MUTATION refresh, whose entire
   * job is to replace rows the in-flight GET was issued *before* the delete or
   * send happened. Dropping it outright would leave a deleted message on screen
   * until the next manual refresh. So a coincident request is remembered and run
   * once, silently, after the current one lands.
   */
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch inbox messages + storage status
  // ---------------------------------------------------------------------------
  const fetchInbox = useCallback(async function runFetch(
    silent = false,
  ): Promise<void> {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    inFlightRef.current = true;

    setIsFetching(true);
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsInboxResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.detail || json.error || "Failed to fetch SMS inbox");
        return;
      }

      setData({
        messages: json.messages || [],
        storage: json.storage || { used: 0, total: 0 },
      });
      // Stamped only here, on the branch that actually produced an inbox. The
      // error branches below leave it untouched on purpose — that is what makes
      // "Stale, 09:14:02" a true statement about the rows still on screen.
      setLastSuccessfulFetch(Date.now());
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch SMS inbox"
      );
    } finally {
      // Released unconditionally — an unmount must not strand the guard, or a
      // remounted card would refuse to fetch for the life of the page.
      inFlightRef.current = false;
      if (mountedRef.current) {
        setIsFetching(false);
        if (!silent) setIsLoading(false);
      }
    }

    if (queuedRef.current && mountedRef.current) {
      queuedRef.current = false;
      await runFetch(true);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------
  const sendSms = useCallback(
    async (phone: string, message: string): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", phone, message }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsActionResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to send SMS");
          return false;
        }

        // Delayed silent re-fetch — modem needs a moment to process the sent message
        setTimeout(() => {
          if (mountedRef.current) fetchInbox(true);
        }, 1000);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Failed to send SMS");
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchInbox]
  );

  // ---------------------------------------------------------------------------
  // Delete single message
  // ---------------------------------------------------------------------------
  const deleteSms = useCallback(
    async (indexes: number[], storage: "ME" | "SM"): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", indexes, storage }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsActionResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to delete message");
          return false;
        }

        // Silent re-fetch to update inbox
        await fetchInbox(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to delete message"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchInbox]
  );

  // ---------------------------------------------------------------------------
  // Delete all messages
  // ---------------------------------------------------------------------------
  const deleteAllSms = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsSaving(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_all" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsActionResponse = await resp.json();
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(
          json.detail || json.error || "Failed to delete all messages"
        );
        return false;
      }

      // Silent re-fetch to update inbox
      await fetchInbox(true);
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(
        err instanceof Error ? err.message : "Failed to delete all messages"
      );
      return false;
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [fetchInbox]);

  return {
    data,
    lastSuccessfulFetch,
    isLoading,
    isFetching,
    isSaving,
    error,
    sendSms,
    deleteSms,
    deleteAllSms,
    refresh: fetchInbox,
  };
}

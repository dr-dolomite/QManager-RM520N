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
  /** True while initial fetch is in progress */
  isLoading: boolean;
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

  // ---------------------------------------------------------------------------
  // Fetch inbox messages + storage status
  // ---------------------------------------------------------------------------
  const fetchInbox = useCallback(async (silent = false) => {
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
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch SMS inbox"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
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
    isLoading,
    isSaving,
    error,
    sendSms,
    deleteSms,
    deleteAllSms,
    refresh: fetchInbox,
  };
}

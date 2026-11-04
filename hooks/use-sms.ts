"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { useSmsReadState } from "@/hooks/use-sms-read-state";
import type {
  SmsMessage,
  SmsThread,
  SmscConfig,
  SmsStorage,
  SmsInboxResponse,
  SmsThreadDetailResponse,
  SmsActionResponse,
} from "@/types/sms";

// =============================================================================
// useSms — SMS Inbox, Threads & Mutation Hook
// =============================================================================
// Fetches inbox messages, conversation threads, the provider number (SMSC) and
// storage on mount, on explicit refresh and after a mutation. No timer: an
// inbox GET reads the SIM store too (docs/reference/sms.md > The GET is not free). Supports sendSms,
// deleteSms, deleteThread, deleteAllSms, fetchThread, updateSmsc,
// markThreadRead, markMessageUnread and an optimistic outbound send queue.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/sms.sh
//
// -----------------------------------------------------------------------------
// `addr` is a KEY, never a label
// -----------------------------------------------------------------------------
// Every address this hook passes to the backend (the thread-fetch query, the
// delete payload, the send destination) is the RAW stored address the modem
// gave us. `display_name` is a rendered title and must never reach any of them.
// See `types/sms.ts`.
//
// -----------------------------------------------------------------------------
// Unread is a client-side overlay
// -----------------------------------------------------------------------------
// The backend never reports unread, so `useSmsReadState` keeps a per-browser
// read set; this hook stamps
// `unread = 1` on inbound messages whose fingerprint is not in it and rolls the
// count up onto the threads. "Mark as read" and "Mark as unread" are therefore
// local and never POST.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms.sh";

/**
 * Mutation outcome. `error` is the backend error CODE (or undefined when the
 * request itself failed), to be resolved through `smsErrorMessage` /
 * `resolveErrorMessage` at the call site, never shown raw.
 */
export interface SmsActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
  /** Send failure only: total parts, and how many went out before it failed. */
  parts?: number;
  sentParts?: number;
  /** Send only: the number the backend filed the message under (normalized). */
  addr?: string;
}

/** A queued send's outcome: the result, and the thread the message landed in. */
export interface SmsSendOutcome {
  result: SmsActionResult;
  addr: string;
}

const OK: SmsActionResult = { ok: true };

/** Turn a failed result into a sentence, falling back to `fallback`. */
export function smsErrorMessage(
  t: TFunction,
  result: SmsActionResult,
  fallback: string,
): string {
  // Some parts already went out: a resend repeats them, so say so.
  if (result.sentParts && result.sentParts > 0 && result.parts) {
    return t("sms.compose.toast.partial", {
      ns: "cellular",
      sent: result.sentParts,
      parts: result.parts,
    });
  }
  return resolveErrorMessage(t, result.error, result.detail, fallback);
}

/** Lifecycle of one optimistic outbound message. */
export type SmsSendState = "queued" | "sending" | "sent" | "failed";

export interface PendingSmsSend {
  /**
   * Stable for the life of the entry, including across retries. A retry reuses
   * this id rather than enqueuing a second entry, so a failed-then-retried
   * message can never render as two bubbles.
   */
  clientId: string;
  /** Destination. THE RAW STORED ADDRESS, never a display name. */
  addr: string;
  /** Body as typed. Retried verbatim. */
  text: string;
  state: SmsSendState;
  /** Epoch ms the entry was queued, used for ordering against server messages. */
  createdAt: number;
  /** Epoch ms the send was acknowledged. Only set when `sent`. */
  settledAt?: number;
  /** Backend error code, for `resolveErrorMessage`. Only set when `failed`. */
  errorCode?: string;
  /** Backend detail string, for `resolveErrorMessage`. Only set when `failed`. */
  errorDetail?: string;
  /** Parts already sent before a multi-part send failed. Only set when `failed`. */
  sentParts?: number;
  parts?: number;
}

export interface SmsData {
  messages: SmsMessage[];
  threads: SmsThread[];
  storage: SmsStorage;
  smsc: SmscConfig | null;
  unreadTotal: number;
}

/** The inbox exactly as the backend sent it, before the unread overlay. */
interface RawInbox {
  messages: SmsMessage[];
  threads: SmsThread[];
  storage: SmsStorage;
  smsc: SmscConfig | null;
  /** A store could not be read, so the list is missing its messages. */
  incomplete: boolean;
}

export interface UseSmsReturn {
  /** Current SMS data (null before first fetch) */
  data: SmsData | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while any inbox GET is in flight, silent ones included. */
  isFetching: boolean;
  /** True while a send/delete/save operation is in progress */
  isSaving: boolean;
  /** Translated message for a failed list read, or null. */
  error: string | null;
  /** Epoch ms of the last successful list read, or null before the first one. */
  lastSyncedAt: number | null;
  /** Optimistic outbound messages that have not yet settled into the thread. */
  pendingSends: PendingSmsSend[];
  /** Send an SMS message. Resolves with the outcome. */
  sendSms: (phone: string, message: string) => Promise<SmsActionResult>;
  /**
   * Optimistically queue an outbound message to a RAW stored address and start
   * sending. `done` resolves when the send settles; null when the entry is gone.
   */
  queueSend: (
    addr: string,
    text: string,
  ) => { clientId: string; done: Promise<SmsSendOutcome | null> };
  /** Retry a failed queued send, reusing its client id. */
  retrySend: (clientId: string) => Promise<SmsSendOutcome | null>;
  /** Drop a queued send from the optimistic list. */
  dismissSend: (clientId: string) => void;
  /** Delete one message (received from the modem, or a sent record). */
  deleteSms: (message: SmsMessage) => Promise<SmsActionResult>;
  /** Delete an entire contact conversation thread. */
  deleteThread: (addr: string) => Promise<SmsActionResult>;
  /** Delete all messages. */
  deleteAllSms: () => Promise<SmsActionResult>;
  /**
   * Fetch a thread's full history, oldest first, and mark its received
   * messages read.
   */
  fetchThread: (addr: string) => Promise<SmsMessage[]>;
  /** Update the provider number (SMSC). */
  updateSmsc: (addr: string) => Promise<SmsActionResult>;
  /** Mark every received message in a thread as read (local only). */
  markThreadRead: (addr: string) => SmsActionResult;
  /** Mark ONE received message unread again (local only). */
  markMessageUnread: (addr: string, identity: string) => SmsActionResult;
  /** Re-fetch inbox data. Pass true for silent (no loading skeleton). */
  refresh: (silent?: boolean) => void;
}

let clientIdSeq = 0;
function nextClientId(): string {
  clientIdSeq += 1;
  return `snd-${Date.now().toString(36)}-${clientIdSeq}`;
}

/**
 * Accept a collection from the envelope only if it really is an array. The
 * backend builds these fields in shell + jq, where an empty collection could in
 * principle arrive as `{}`; `for...of` over that throws in a render-path memo
 * and would turn the error panel into a blank screen.
 */
function coerceCollection<T>(value: unknown, field: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value !== undefined && value !== null) {
    console.warn(
      `useSms: sms.sh returned a non-array \`${field}\` (${typeof value}); treating it as empty.`,
      value,
    );
  }
  return [];
}

function isInboundMessage(msg: SmsMessage): boolean {
  if (msg.direction) return msg.direction === "inbound";
  if (typeof msg.type === "number") return msg.type === 1;
  return msg.storage !== "SENT";
}

function keyOf(msg: SmsMessage): string {
  return msg.addr || msg.sender;
}

export function useSms(): UseSmsReturn {
  const { t } = useTranslation("cellular");
  // Read through a ref so a language switch does not rebuild fetchInbox and
  // re-run the mount fetch.
  const tRef = useRef(t);
  tRef.current = t;
  const [raw, setRaw] = useState<RawInbox | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingSends, setPendingSends] = useState<PendingSmsSend[]>([]);

  const mountedRef = useRef(true);
  /** One inbox GET at a time; a request made meanwhile runs once after it. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  /**
   * Authoritative copy of the optimistic queue. `pendingSends` mirrors it for
   * rendering; the ref exists because `runSend` has to find its own entry on
   * the same tick it was queued, before React has re-rendered. Written only
   * through `commitPending`, never during render.
   */
  const pendingRef = useRef<PendingSmsSend[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Unread overlay
  // ---------------------------------------------------------------------------
  const inbound = useMemo(
    () => (raw ? raw.messages.filter(isInboundMessage) : []),
    [raw],
  );
  const readState = useSmsReadState(inbound, !raw?.incomplete);
  const { isRead, markManyRead, markUnread } = readState;

  const data = useMemo<SmsData | null>(() => {
    if (!raw) return null;

    const unreadByAddr = new Map<string, number>();
    const messages = raw.messages.map((msg) => {
      if (!isInboundMessage(msg) || isRead(msg)) return msg;
      const key = keyOf(msg);
      unreadByAddr.set(key, (unreadByAddr.get(key) ?? 0) + 1);
      return { ...msg, unread: 1 };
    });
    const threads = raw.threads.map((th) => ({
      ...th,
      unreadCount: unreadByAddr.get(th.addr) ?? 0,
    }));
    let unreadTotal = 0;
    for (const n of unreadByAddr.values()) unreadTotal += n;

    return {
      messages,
      threads,
      storage: raw.storage,
      smsc: raw.smsc,
      unreadTotal,
    };
  }, [raw, isRead]);

  // The mark-read callbacks must stay referentially stable (the surface fetches
  // a thread from an effect keyed on `fetchThread`), yet they need the CURRENT
  // list. A ref, refreshed after every commit, bridges the two.
  const listed = raw?.messages;
  const latestRef = useRef({ inbound, listed, markManyRead, markUnread });
  useEffect(() => {
    latestRef.current = { inbound, listed, markManyRead, markUnread };
  });
  /** Settles when the inbox GET in flight lands; thread opens wait on it. */
  const inFlightDoneRef = useRef<Promise<void>>(Promise.resolve());

  // ---------------------------------------------------------------------------
  // The optimistic queue's single writer
  // ---------------------------------------------------------------------------
  const commitPending = useCallback((next: PendingSmsSend[]) => {
    pendingRef.current = next;
    setPendingSends(next);
  }, []);

  const patchPending = useCallback(
    (clientId: string, patch: Partial<PendingSmsSend>) => {
      commitPending(
        pendingRef.current.map((p) =>
          p.clientId === clientId ? { ...p, ...patch } : p,
        ),
      );
    },
    [commitPending],
  );

  // ---------------------------------------------------------------------------
  // POST helper: one place that turns an envelope into a result
  // ---------------------------------------------------------------------------
  const post = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{ result: SmsActionResult; json: SmsActionResponse | null }> => {
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json: SmsActionResponse = await resp.json();
        if (!json.success) {
          return {
            result: {
              ok: false,
              error: json.error,
              detail: json.detail,
              parts: json.parts,
              sentParts: json.sent_parts,
              addr: json.addr,
            },
            json,
          };
        }
        return { result: json.addr ? { ok: true, addr: json.addr } : OK, json };
      } catch {
        return { result: { ok: false }, json: null };
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Fetch inbox overview (threads, flat messages, storage, smsc)
  // ---------------------------------------------------------------------------
  // `silent` suppresses the loading skeleton; `quiet` additionally suppresses
  // the error state, so a post-mutation re-read never blanks a populated list.
  const fetchInbox = useCallback(
    async function runFetch(silent = false, quiet = false): Promise<boolean> {
      if (inFlightRef.current) {
        // Usually a post-mutation refresh: it must still run, after this one.
        queuedRef.current = true;
        return false;
      }
      inFlightRef.current = true;
      let release = () => {};
      inFlightDoneRef.current = new Promise<void>((r) => {
        release = r;
      });
      setIsFetching(true);
      if (!silent) setIsLoading(true);
      if (!quiet) setError(null);
      const startedAt = Date.now();
      let ok = false;

      try {
        const resp = await authFetch(CGI_ENDPOINT);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsInboxResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          if (!quiet) {
            setError(
              resolveErrorMessage(
                tRef.current,
                json.error,
                json.detail,
                tRef.current("sms.errors.fetch"),
              ),
            );
          }
          return false;
        }

        const listedNow = coerceCollection<SmsMessage>(json.messages, "messages");
        // Visible to a waiting fetchThread before React commits.
        latestRef.current = { ...latestRef.current, listed: listedNow };
        setRaw({
          messages: listedNow,
          threads: coerceCollection<SmsThread>(json.threads, "threads"),
          storage: json.storage || { used: 0, total: 0 },
          smsc: json.smsc ?? null,
          incomplete:
            !!json.storage_errors && Object.keys(json.storage_errors).length > 0,
        });
        setLastSyncedAt(Date.now());
        if (quiet) setError(null);

        // A send acknowledged BEFORE this read started is in this list as a
        // real message now, so its optimistic bubble can go.
        if (
          pendingRef.current.some(
            (p) =>
              p.state === "sent" &&
              p.settledAt !== undefined &&
              p.settledAt <= startedAt,
          )
        ) {
          commitPending(
            pendingRef.current.filter(
              (p) =>
                !(
                  p.state === "sent" &&
                  p.settledAt !== undefined &&
                  p.settledAt <= startedAt
                ),
            ),
          );
        }
        ok = true;
      } catch {
        if (!mountedRef.current) return false;
        if (!quiet) setError(tRef.current("sms.errors.fetch"));
      } finally {
        // Released unconditionally, or a remounted page could never fetch.
        inFlightRef.current = false;
        release();
        if (mountedRef.current) {
          setIsFetching(false);
          if (!silent) setIsLoading(false);
        }
      }
      if (queuedRef.current && mountedRef.current) {
        queuedRef.current = false;
        return runFetch(true, true);
      }
      return ok;
    },
    [commitPending],
  );

  // Fetch on mount
  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  // ---------------------------------------------------------------------------
  // Thread detail: once per deliberate open
  // ---------------------------------------------------------------------------
  const fetchThread = useCallback(
    async (addr: string): Promise<SmsMessage[]> => {
      // One read at a time: wait for a list GET in flight, then answer from the
      // list when it already holds this thread (it carries every message).
      await inFlightDoneRef.current;
      const fromList = (latestRef.current.listed ?? []).filter(
        (m) => keyOf(m) === addr,
      );
      if (fromList.length > 0) {
        latestRef.current.markManyRead(fromList.filter(isInboundMessage));
        return [...fromList].sort((x, y) => (x.time ?? 0) - (y.time ?? 0));
      }

      // A deep link the list does not hold: read it, holding the same guard.
      // A loop: a queued re-read can take the guard again before this resumes.
      while (inFlightRef.current) await inFlightDoneRef.current;
      inFlightRef.current = true;
      let release = () => {};
      inFlightDoneRef.current = new Promise<void>((r) => {
        release = r;
      });
      try {
        // `addr` is the RAW stored address; a display name fetches nothing.
        const resp = await authFetch(
          `${CGI_ENDPOINT}?addr=${encodeURIComponent(addr)}`,
        );
        if (!resp.ok) return [];
        const json: SmsThreadDetailResponse = await resp.json();
        if (!json.success || !Array.isArray(json.messages)) return [];
        latestRef.current.markManyRead(json.messages.filter(isInboundMessage));
        return json.messages;
      } catch {
        return [];
      } finally {
        inFlightRef.current = false;
        release();
        if (queuedRef.current && mountedRef.current) {
          queuedRef.current = false;
          void fetchInbox(true, true);
        }
      }
    },
    [fetchInbox],
  );

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const withSaving = useCallback(
    async <R,>(run: () => Promise<R>): Promise<R> => {
      setIsSaving(true);
      try {
        return await run();
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [],
  );

  const sendSms = useCallback(
    (phone: string, message: string): Promise<SmsActionResult> =>
      withSaving(async () => {
        const { result } = await post({ action: "send", phone, message });
        if (mountedRef.current) void fetchInbox(true, true);
        return result;
      }),
    [fetchInbox, post, withSaving],
  );

  // ---------------------------------------------------------------------------
  // Optimistic send queue: queued -> sending -> sent | failed
  // ---------------------------------------------------------------------------
  // The conversation renders these bubbles immediately at `queued`, dims them
  // while `sending`, and settles them to `sent` (never "delivered": the modem
  // acknowledging a submission is not a delivery receipt) or `failed` with a
  // retry. Retry reuses the same `clientId`, so the bubble transitions in place
  // rather than a second one appearing beside it. A `sent` entry is dropped by
  // the first list read that starts after it was acknowledged (see
  // `fetchInbox`), so the real message replaces it.
  const runSend = useCallback(
    async (clientId: string): Promise<SmsSendOutcome | null> => {
      const entry = pendingRef.current.find((p) => p.clientId === clientId);
      if (!entry) return null;

      patchPending(clientId, {
        state: "sending",
        errorCode: undefined,
        errorDetail: undefined,
        sentParts: undefined,
        parts: undefined,
      });

      // THE KEY: the raw stored address the thread is filed under, which is
      // also the destination the modem dials. Never `display_name`.
      const { result } = await post({
        action: "send",
        phone: entry.addr,
        message: entry.text,
      });
      if (!mountedRef.current) return null;

      if (!result.ok) {
        patchPending(clientId, {
          state: "failed",
          errorCode: result.error,
          errorDetail: result.detail,
          sentParts: result.sentParts,
          parts: result.parts,
        });
        return { result, addr: entry.addr };
      }

      // The backend files the record under the normalized number; the bubble
      // moves with it so it lands in the thread the list will show.
      const addr = result.addr || entry.addr;
      patchPending(clientId, { state: "sent", settledAt: Date.now(), addr });
      void fetchInbox(true, true);
      return { result, addr };
    },
    [fetchInbox, patchPending, post],
  );

  const queueSend = useCallback(
    (addr: string, text: string) => {
      const clientId = nextClientId();
      const entry: PendingSmsSend = {
        clientId,
        addr,
        text,
        state: "queued",
        createdAt: Date.now(),
      };
      // Commit synchronously so `runSend` can find the entry on the same tick.
      commitPending([...pendingRef.current, entry]);
      return { clientId, done: runSend(clientId) };
    },
    [commitPending, runSend],
  );

  const retrySend = useCallback(
    (clientId: string): Promise<SmsSendOutcome | null> => {
      const entry = pendingRef.current.find((p) => p.clientId === clientId);
      if (!entry || entry.state === "sending") return Promise.resolve(null);
      return runSend(clientId);
    },
    [runSend],
  );

  const dismissSend = useCallback(
    (clientId: string) => {
      commitPending(pendingRef.current.filter((p) => p.clientId !== clientId));
    },
    [commitPending],
  );

  // A delete may have removed some items even when it reports a failure
  // (partial_failure), so the list is re-read either way.
  const deleteSms = useCallback(
    (message: SmsMessage): Promise<SmsActionResult> =>
      withSaving(async () => {
        const body: Record<string, unknown> =
          message.storage === "SENT"
            ? {
                action: "delete",
                storage: "SENT",
                identities: message.identity ? [message.identity] : [],
              }
            : {
                action: "delete",
                indexes: message.indexes,
                storage: message.storage,
              };
        const { result } = await post(body);
        if (mountedRef.current) await fetchInbox(true, true);
        return result;
      }),
    [fetchInbox, post, withSaving],
  );

  const deleteThread = useCallback(
    (addr: string): Promise<SmsActionResult> =>
      withSaving(async () => {
        // `addr` is the RAW stored address.
        const { result } = await post({ action: "delete", addr, index: "ALL" });
        if (mountedRef.current) await fetchInbox(true, true);
        return result;
      }),
    [fetchInbox, post, withSaving],
  );

  const deleteAllSms = useCallback(
    (): Promise<SmsActionResult> =>
      withSaving(async () => {
        const { result } = await post({ action: "delete_all" });
        if (mountedRef.current) await fetchInbox(true, true);
        return result;
      }),
    [fetchInbox, post, withSaving],
  );

  const updateSmsc = useCallback(
    (smscAddr: string): Promise<SmsActionResult> =>
      withSaving(async () => {
        const { result, json } = await post({
          action: "set_smsc",
          addr: smscAddr,
        });
        if (result.ok && json?.smsc && mountedRef.current) {
          const smsc = json.smsc;
          setRaw((prev) => (prev ? { ...prev, smsc } : prev));
        }
        return result;
      }),
    [post, withSaving],
  );

  // ---------------------------------------------------------------------------
  // Read state: local only, no request
  // ---------------------------------------------------------------------------
  const markThreadRead = useCallback((addr: string): SmsActionResult => {
    const { inbound: listed, markManyRead: markMany } = latestRef.current;
    markMany(listed.filter((m) => keyOf(m) === addr));
    return OK;
  }, []);

  const markMessageUnread = useCallback(
    (addr: string, identity: string): SmsActionResult => {
      const { inbound: listed, markUnread: markOne } = latestRef.current;
      const msg = listed.find(
        (m) => m.identity === identity && keyOf(m) === addr,
      );
      if (!msg) return { ok: false };
      markOne(msg);
      return OK;
    },
    [],
  );

  const refresh = useCallback(
    (silent = false) => {
      void fetchInbox(silent);
    },
    [fetchInbox],
  );

  return {
    data,
    isLoading,
    isFetching,
    isSaving,
    error,
    lastSyncedAt,
    pendingSends,
    sendSms,
    queueSend,
    retrySend,
    dismissSend,
    deleteSms,
    deleteThread,
    deleteAllSms,
    fetchThread,
    updateSmsc,
    markThreadRead,
    markMessageUnread,
    refresh,
  };
}

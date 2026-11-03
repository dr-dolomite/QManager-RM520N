"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SmsMessage } from "@/types/sms";

// =============================================================================
// useSmsReadState — client-side read/unread tracking for SMS messages
// =============================================================================
// The modem cannot be the source of truth for read/unread:
//   1. The CGI's multi-part merge drops the listing's per-message `stat`, so
//      the UI never sees REC READ / REC UNREAD.
//   2. Every inbox GET issues `AT+CMGL=4`, which the modem treats as "mark all
//      read" — so any unread state self-erases on each fetch.
// We therefore track "has THIS browser opened this message" locally. "Unread"
// means the message's fingerprint is absent from the persisted read-set. New
// incoming messages are unread by default. `useSms` overlays the result onto
// the inbox it hands the surface.
//
// Trade-off (accepted): read-state is per-browser. It does not sync across
// devices and resets if the browser's localStorage is cleared.
// =============================================================================

const STORAGE_KEY = "qmanager.sms.read.v1";

/**
 * Stable fingerprint for a message. There is no backend message ID, so we
 * derive one from immutable fields. A djb2 hash keeps the persisted set compact
 * regardless of body length, and folds multi-part bodies + storage + sender +
 * timestamp into a single collision-resistant-enough token for this volume.
 *
 * Do not change the inputs: doing so marks every message unread again.
 */
export function smsFingerprint(msg: SmsMessage): string {
  const raw = `${msg.storage}|${msg.sender}|${msg.timestamp}|${msg.content}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    // h * 33 + c, kept inside 32 bits via | 0
    h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  }
  // Unsigned, base-36 for a short token.
  return (h >>> 0).toString(36);
}

function loadReadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export interface UseSmsReadStateReturn {
  /** True if this message has been opened in this browser. */
  isRead: (msg: SmsMessage) => boolean;
  /** Mark a single message read. */
  markRead: (msg: SmsMessage) => void;
  /** Mark several messages read in one update. */
  markManyRead: (msgs: SmsMessage[]) => void;
  /** Make one message unread again. */
  markUnread: (msg: SmsMessage) => void;
  /** Mark every currently-present message read. */
  markAllRead: () => void;
  /** Number of currently-present messages that are unread. */
  unreadCount: number;
}

/**
 * @param messages the full (unfiltered) INBOUND message list: used both to
 *   count unread and to prune dead fingerprints from the persisted set.
 */
export function useSmsReadState(messages: SmsMessage[]): UseSmsReadStateReturn {
  const [readSet, setReadSet] = useState<Set<string>>(loadReadSet);

  // Fingerprints of messages currently in the inbox. Used to prune what is
  // written to storage so it can't grow unbounded as messages are deleted.
  const present = useMemo(
    () => new Set(messages.map(smsFingerprint)),
    [messages],
  );

  // One-way sync: persist whenever the read-set changes. This is a genuine
  // state -> localStorage side effect (no setState here), so it does not trip
  // the react-compiler setState-in-effect rule. Nothing is written while the
  // inbox is still empty (first load): the stored set must survive until there
  // is a list to prune it against.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (present.size === 0) return;
    try {
      const keep = [...readSet].filter((fp) => present.has(fp));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch {
      // Quota exceeded or storage disabled: read-state is best-effort.
    }
  }, [readSet, present]);

  const isRead = useCallback(
    (msg: SmsMessage) => readSet.has(smsFingerprint(msg)),
    [readSet],
  );

  const unreadCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => (readSet.has(smsFingerprint(m)) ? n : n + 1),
        0,
      ),
    [messages, readSet],
  );

  const markManyRead = useCallback((msgs: SmsMessage[]) => {
    if (msgs.length === 0) return;
    setReadSet((prev) => {
      let next: Set<string> | null = null;
      for (const msg of msgs) {
        const fp = smsFingerprint(msg);
        if (prev.has(fp) || next?.has(fp)) continue;
        next ??= new Set(prev);
        next.add(fp);
      }
      return next ?? prev;
    });
  }, []);

  const markRead = useCallback(
    (msg: SmsMessage) => markManyRead([msg]),
    [markManyRead],
  );

  const markUnread = useCallback((msg: SmsMessage) => {
    const fp = smsFingerprint(msg);
    setReadSet((prev) => {
      if (!prev.has(fp)) return prev;
      const next = new Set(prev);
      next.delete(fp);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    // Adding exactly the present set marks everything read.
    setReadSet((prev) => {
      if ([...present].every((x) => prev.has(x))) return prev;
      return new Set([...prev, ...present]);
    });
  }, [present]);

  return { isRead, markRead, markManyRead, markUnread, markAllRead, unreadCount };
}

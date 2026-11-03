"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SmsMessage } from "@/types/sms";

// =============================================================================
// useSmsReadState — client-side read/unread tracking for SMS messages
// =============================================================================
// The backend does not report read/unread, so we track "has THIS browser opened this message" locally. "Unread"
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
 * @param messages the full INBOUND list: counts unread, and bounds the stored set.
 * @param canPrune false while a store failed to read, so its marks are kept.
 */
export function useSmsReadState(
  messages: SmsMessage[],
  canPrune = true,
): UseSmsReadStateReturn {
  const [readSet, setReadSet] = useState<Set<string>>(loadReadSet);

  // Fingerprints of messages currently in the inbox. Used to prune what is
  // written to storage so it can't grow unbounded as messages are deleted.
  const present = useMemo(
    () => new Set(messages.map(smsFingerprint)),
    [messages],
  );

  // Persist as-is: pruning happens only on a user mark (below), so a list
  // that is briefly missing a store never erases that store's marks.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...readSet]));
    } catch {
      // Quota exceeded or storage disabled: read-state is best-effort.
    }
  }, [readSet]);

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

  const markManyRead = useCallback(
    (msgs: SmsMessage[]) => {
      if (msgs.length === 0) return;
      setReadSet((prev) => {
        const fresh = msgs.map(smsFingerprint).filter((fp) => !prev.has(fp));
        if (fresh.length === 0) return prev;
        // Prune to what is present, unless a store is missing or the list has not loaded
        // (a caller holding a pre-load closure sees an empty `present`).
        const prune = canPrune && present.size > 0;
        const next = new Set<string>();
        for (const x of prev) if (!prune || present.has(x)) next.add(x);
        for (const fp of fresh) next.add(fp);
        return next;
      });
    },
    [present, canPrune],
  );

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
    setReadSet((prev) => {
      if ([...present].every((x) => prev.has(x))) return prev;
      return canPrune ? new Set(present) : new Set([...prev, ...present]);
    });
  }, [present, canPrune]);

  return { isRead, markRead, markManyRead, markUnread, markAllRead, unreadCount };
}
